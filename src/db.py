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
import threading

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

_pool: ConnectionPool | None = None
_lock = threading.Lock()


def _configure(conn) -> None:
    """每个新连接注册 pgvector 类型 + 默认 dict_row。"""
    from pgvector.psycopg import register_vector

    register_vector(conn)
    conn.row_factory = dict_row


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
        _pool = ConnectionPool(
            conninfo=dsn,
            min_size=1,
            max_size=int(os.getenv("DB_POOL_MAX", "10")),
            configure=_configure,
            open=True,
        )
        _pool.wait(timeout=10)
        return _pool


def get_pool() -> ConnectionPool:
    """取池;没 init 过就 lazy init (兼容脚本 / 测试直接用)。"""
    if _pool is None:
        return init_pool()
    return _pool


def close_pool() -> None:
    """FastAPI lifespan 关闭时调。"""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
