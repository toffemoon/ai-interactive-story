"""Postgres 连接池 (psycopg3) + pgvector 注册。

数据层从 JSON 文件 + chromadb 迁到 Supabase 托管 Postgres + pgvector
(见 decisions/2026-05-30-db-supabase-postgres.md)。

用 sync psycopg3 + ConnectionPool —— storage / memory 函数签名保持 sync,
故事回合 (async) 里的 DB 调用走 asyncio.to_thread 包 (跟 story.py 现有检索
调用对称)。FastAPI sync 端点本就在 threadpool 跑, 不阻塞 event loop。

连接串走 DATABASE_URL (session pooler, 见 .env.example)。
"""

from __future__ import annotations

import os
import logging
import math
import threading

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

_pool: ConnectionPool | None = None
_lock = threading.Lock()
log = logging.getLogger("db")


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} 必须是整数") from exc
    if value < minimum:
        raise RuntimeError(f"{name} 必须 >= {minimum}")
    return value


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.getenv(name, str(default))
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} 必须是数字") from exc
    if not math.isfinite(value) or value < minimum:
        raise RuntimeError(f"{name} 必须 >= {minimum}")
    return value


def _configure(conn) -> None:
    """每个新连接注册 pgvector，并给本服务设置有限事务/查询时长。"""
    from pgvector.psycopg import register_vector

    register_vector(conn)
    # 现场故障曾出现 10/10 连接长期 idle in transaction。只给本服务的 session
    # 加护栏，不改 Supabase role/global；SET 后必须 commit，让连接以 IDLE 状态入池。
    settings = {
        "idle_in_transaction_session_timeout": f"{_env_int('DB_IDLE_TX_TIMEOUT_MS', 60_000, minimum=1)}ms",
        "statement_timeout": f"{_env_int('DB_STATEMENT_TIMEOUT_MS', 30_000, minimum=1)}ms",
        "lock_timeout": f"{_env_int('DB_LOCK_TIMEOUT_MS', 5_000, minimum=1)}ms",
        "application_name": os.getenv("DB_APPLICATION_NAME", "ai-interactive-story"),
    }
    with conn.cursor() as cur:
        for key, value in settings.items():
            cur.execute("select set_config(%s, %s, false)", (key, value))
    conn.commit()
    conn.row_factory = dict_row


def _reconnect_failed(pool: ConnectionPool) -> None:
    """后台重连在限定时间内仍失败时记录非敏感池状态。"""
    log.critical("database pool reconnect failed: %s", _safe_stats(pool))


_PUBLIC_STAT_KEYS = (
    "pool_min",
    "pool_max",
    "pool_size",
    "pool_available",
    "requests_waiting",
)


def _public_stats(stats: dict[str, int]) -> dict[str, int]:
    return {key: int(stats[key]) for key in _PUBLIC_STAT_KEYS if key in stats}


def _safe_stats(pool: ConnectionPool) -> dict[str, int | bool]:
    """指标采集不得遮蔽原始数据库异常。"""
    try:
        return _public_stats(pool.get_stats())
    except Exception as exc:
        log.warning("database pool stats failed: %s", type(exc).__name__)
        return {"stats_error": True}


def init_pool() -> ConnectionPool:
    """建全局连接池 (幂等)。FastAPI lifespan 启动时调。"""
    global _pool
    if _pool is not None:
        return _pool
    with _lock:
        if _pool is not None:
            return _pool
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError(
                "DATABASE_URL 没设。复制 .env.example → .env 填 Supabase 连接串。"
            )
        # autocommit=False (默认): 每个 `with pool.connection()` 块是一个事务,
        # 块正常退出时 pool 自动 commit, 出错 rollback。save_session 的
        # session blob + messages 多条写在同一块里 → 原子。
        min_size = _env_int("DB_POOL_MIN", 1, minimum=1)
        max_size = _env_int("DB_POOL_MAX", 10, minimum=1)
        if min_size > max_size:
            raise RuntimeError("DB_POOL_MIN 不能大于 DB_POOL_MAX")
        checkout_timeout = _env_float("DB_POOL_TIMEOUT_SECONDS", 5.0, minimum=0.1)
        pool = ConnectionPool(
            conninfo=dsn,
            name="ai-story-db",
            min_size=min_size,
            max_size=max_size,
            timeout=checkout_timeout,
            max_waiting=_env_int("DB_POOL_MAX_WAITING", 20, minimum=0),
            max_lifetime=_env_float("DB_POOL_MAX_LIFETIME_SECONDS", 1_800.0, minimum=1.0),
            max_idle=_env_float("DB_POOL_MAX_IDLE_SECONDS", 120.0, minimum=1.0),
            reconnect_timeout=_env_float("DB_POOL_RECONNECT_TIMEOUT_SECONDS", 30.0, minimum=1.0),
            reconnect_failed=_reconnect_failed,
            configure=_configure,
            check=ConnectionPool.check_connection,
            kwargs={
                "connect_timeout": _env_int("DB_CONNECT_TIMEOUT_SECONDS", 5, minimum=1),
                "keepalives": 1,
                "keepalives_idle": _env_int("DB_KEEPALIVE_IDLE_SECONDS", 30, minimum=1),
                "keepalives_interval": _env_int("DB_KEEPALIVE_INTERVAL_SECONDS", 10, minimum=1),
                "keepalives_count": _env_int("DB_KEEPALIVE_COUNT", 3, minimum=1),
                "tcp_user_timeout": _env_int("DB_TCP_USER_TIMEOUT_MS", 30_000, minimum=1),
                "application_name": os.getenv("DB_APPLICATION_NAME", "ai-interactive-story"),
            },
            open=True,
        )
        try:
            pool.wait(timeout=_env_float("DB_POOL_STARTUP_TIMEOUT_SECONDS", 10.0, minimum=0.1))
        except Exception:
            # wait() 失败会关闭池；全局必须继续保持 None，允许同进程修复环境后重试。
            try:
                pool.close(timeout=_env_float("DB_POOL_CLOSE_TIMEOUT_SECONDS", 5.0, minimum=0.1))
            except Exception:
                pass
            raise
        _pool = pool
        log.info(
            "database pool ready min=%s max=%s checkout_timeout=%ss",
            min_size,
            max_size,
            checkout_timeout,
        )
        return _pool


def get_pool() -> ConnectionPool:
    """取池;没 init 过就 lazy init (兼容脚本 / 测试直接用)。"""
    if _pool is None:
        return init_pool()
    return _pool


def pool_stats() -> dict[str, int | bool]:
    """给健康检查/日志用的非敏感池状态。"""
    pool = _pool
    if pool is None:
        return {"initialized": False}
    return {"initialized": True, **_safe_stats(pool)}


def ping(*, timeout: float = 1.0) -> bool:
    """池满时按 timeout 快速失败；半开连接由 checkout 探活 + TCP 超时兜底。"""
    try:
        pool = get_pool()
        with pool.connection(timeout=timeout) as conn, conn.cursor() as cur:
            cur.execute("select 1")
            cur.fetchone()
        return True
    except Exception as exc:
        # 不记录 DSN/异常正文，避免连接串随驱动异常进入日志。
        log.warning("database ping failed: %s stats=%s", type(exc).__name__, pool_stats())
        return False


def close_pool() -> None:
    """FastAPI lifespan 关闭时调。"""
    global _pool
    pool = _pool
    if pool is not None:
        try:
            pool.close(timeout=_env_float("DB_POOL_CLOSE_TIMEOUT_SECONDS", 5.0, minimum=0.1))
        finally:
            # 即使驱动关闭过程异常，也不能把已不可用的池继续暴露给同进程后续请求。
            _pool = None
