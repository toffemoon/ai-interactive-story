"""Phase 0 成本熔断 + 限流(账户系统路线图 Phase 0)。

见 decisions/2026-06-09-phase0-成本熔断与限流-提案.md。

目标:在还没有账户系统之前,先堵住「任何人都能直接打 /api/story_turn 烧 DeepSeek key」。
- 全局每日 USD 硬熔断:当天累计 >= GLOBAL_DAILY_USD_CAP(或被 kill)→ 整服务停调 LLM(503)。
- 按 IP 限流:单 IP 窗口内回合数上限(429)。
- 单来源每日回合上限(宽松,0=不限,靠全局兜底)。
- 用量记账:每回合 out.usage(src/llm.py collect_usage 累加)→ USD → usage_daily + spend_daily。

特性:
- **默认关闭**(COST_GUARD_ENABLED 未设/非真)→ preflight 返回惰性 reservation、record no-op,
  部署本代码不改变现有行为;迁移建表 + 翻 COST_GUARD_ENABLED=1 才生效(门控,可回退)。
- 计数全走 Postgres(无 Redis),多 worker / 多实例下正确。
- 热路径 spend_daily 单行用 pg_advisory_xact_lock 串行化,消除 read-modify-write 竞态
  (整个 with pool.connection() 块是一个事务)。
- 预扣对账(防并发越顶):preflight 先按 COST_RESERVE_USD 预扣,record 写回实际差值;
  失败回合 record(res, {}) → 退回预扣。
- guard 自身出错 → fail-open(放行)+ 记 log:计数 bug 不该让玩家玩不了;全局上限恢复后照样熔断。
- 价格永远从 .env 读(DeepSeek 价格多次漂移),代码内默认仅兜底,务必按现价配 .env。
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .db import get_pool

log = logging.getLogger("costguard")

# 国内/新加坡同为 UTC+8;按 +8 切「今天」,避免 Render(UTC)把跨日算错。
_TZ8 = timezone(timedelta(hours=8))


def _enabled() -> bool:
    return os.getenv("COST_GUARD_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def _today() -> str:
    return datetime.now(_TZ8).date().isoformat()


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


def _cap() -> float:
    return _f("GLOBAL_DAILY_USD_CAP", 5.0)


def _reserve() -> float:
    return _f("COST_RESERVE_USD", 0.01)


def _usage_to_usd(usage: dict | None) -> tuple[float, int]:
    """(usd, total_tokens)。Phase 0 用单一进价(prompt 全按未命中价、保守偏高)。"""
    u = usage or {}
    pt = int(u.get("prompt_tokens", 0) or 0)
    ct = int(u.get("completion_tokens", 0) or 0)
    tt = int(u.get("total_tokens", 0) or (pt + ct))
    in_rate = _f("COST_INPUT_USD_PER_MTOK", 0.3)   # USD / 1M tokens;务必按 DeepSeek 现价配 .env
    out_rate = _f("COST_OUTPUT_USD_PER_MTOK", 1.2)
    usd = pt / 1_000_000 * in_rate + ct / 1_000_000 * out_rate
    return usd, tt


def client_ip(request) -> str:
    """取真实客户端 IP。XFF 首段由客户端自报、可伪造(P1-3:伪造首段即绕过全部 per-IP 限流);
    可信的是最近一跳可信代理**追加**的那段 → 从右往左数第 TRUSTED_PROXY_HOPS 段。
    Render 单层反代 = 默认 1(取末段);本地直连无 XFF 时用 socket 对端。"""
    xff = request.headers.get("x-forwarded-for") if request is not None else None
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        hops = max(1, int(_f("TRUSTED_PROXY_HOPS", 1)))
        if parts:
            return parts[-hops] if hops <= len(parts) else parts[0]
    try:
        return request.client.host or "unknown"
    except Exception:
        return "unknown"


@dataclass
class Reservation:
    subject: str          # 'ip:<addr>'(Phase 1 起 'user:<uuid>')
    reserved_usd: float
    active: bool          # False = guard 关闭或 fail-open,record 时跳过对账


def preflight(ip: str) -> Reservation:
    """回合开始前的闸:全局熔断 + 限流 + 预扣。超限抛 HTTPException(503/429);放行返回 Reservation。

    在 api 端点的 try 之前调,503/429 不会被保底回合吞掉。
    """
    subject = f"ip:{ip}"
    if not _enabled():
        return Reservation(subject=subject, reserved_usd=0.0, active=False)

    day = _today()
    cap = _cap()
    reserve = _reserve()
    win = int(_f("RATE_WINDOW_SECONDS", 3600))
    max_turns = int(_f("RATE_MAX_TURNS_PER_WINDOW", 40))
    subj_cap = int(_f("SUBJECT_DAILY_TURN_CAP", 200))

    try:
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            # 串行化 spend_daily 单行的 read-modify-write(整块=一个事务,xact 锁随提交释放)。
            cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"spend_daily:{day}",))

            # 1) 全局熔断:确保今天有行 → 读 usd/tripped。
            cur.execute(
                "insert into spend_daily (day, usd, tripped) values (%s, 0, false) "
                "on conflict (day) do nothing",
                (day,),
            )
            cur.execute("select usd, tripped from spend_daily where day = %s", (day,))
            row = cur.fetchone()
            spent = float(row["usd"] or 0)
            if row["tripped"] or spent >= cap:
                raise HTTPException(503, "服务今日已达容量上限,请明天再来")

            # 2) 按 IP 限流(原子 upsert + 窗口重置;超限即 429,本事务回滚不持久化本次自增,
            #    稳态下计数停在 max、每个越限请求都被挡)。
            cur.execute(
                """insert into rate_limits (key, count, window_start)
                   values (%s, 1, now())
                   on conflict (key) do update set
                     count = case when rate_limits.window_start < now() - %s * interval '1 second'
                                  then 1 else rate_limits.count + 1 end,
                     window_start = case when rate_limits.window_start < now() - %s * interval '1 second'
                                  then now() else rate_limits.window_start end
                   returning count""",
                (f"ip:{ip}", win, win),
            )
            if int(cur.fetchone()["count"]) > max_turns:
                raise HTTPException(429, "操作太频繁,请稍后再试")

            # 3) 单来源每日回合上限(宽松,0=不限)。
            if subj_cap > 0:
                cur.execute(
                    "select turns from usage_daily where subject = %s and day = %s",
                    (subject, day),
                )
                r = cur.fetchone()
                if r and int(r["turns"] or 0) >= subj_cap:
                    raise HTTPException(429, "今日次数已用完,明天再来")

            # 4) 预扣:先把 reserve 记进 spend_daily,并发请求立刻看得到(防越顶)。
            cur.execute(
                "update spend_daily set usd = usd + %s, "
                "tripped = (tripped or (usd + %s) >= %s) where day = %s",
                (reserve, reserve, cap, day),
            )
        return Reservation(subject=subject, reserved_usd=reserve, active=True)
    except HTTPException:
        raise
    except Exception as e:  # guard 自身出错 → fail-open(放行)
        log.warning("costguard preflight fail-open: %s", e)
        return Reservation(subject=subject, reserved_usd=0.0, active=False)


def hit_rate(key: str, window_s: int, max_hits: int) -> bool:
    """通用窗口限流(login 撞库 / send_code 轰炸等非回合端点用,P1-4/P2-11)。True=放行。
    复用 rate_limits 表的原子 upsert;与 COST_GUARD_ENABLED 无关、常开;
    表缺失/DB 异常 fail-open(限流坏了不该把正常用户挡在门外)。"""
    try:
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """insert into rate_limits (key, count, window_start)
                   values (%s, 1, now())
                   on conflict (key) do update set
                     count = case when rate_limits.window_start < now() - %s * interval '1 second'
                                  then 1 else rate_limits.count + 1 end,
                     window_start = case when rate_limits.window_start < now() - %s * interval '1 second'
                                  then now() else rate_limits.window_start end
                   returning count""",
                (key, window_s, window_s),
            )
            return int(cur.fetchone()["count"]) <= max_hits
    except Exception as e:
        log.warning("hit_rate fail-open (%s): %s", key, e)
        return True


def record(res: Reservation, usage: dict | None) -> None:
    """回合结束后对账:实际 usage → USD,写 spend_daily(差值)+ usage_daily。失败回合传 {} 退预扣。"""
    if res is None or not res.active:
        return
    day = _today()
    cap = _cap()
    usd, tokens = _usage_to_usd(usage)
    delta = usd - res.reserved_usd   # 把预扣对账成实际
    try:
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"spend_daily:{day}",))
            cur.execute(
                "update spend_daily set usd = usd + %s, "
                "tripped = (tripped or (usd + %s) >= %s) where day = %s",
                (delta, delta, cap, day),
            )
            cur.execute(
                """insert into usage_daily (subject, day, turns, tokens, usd)
                   values (%s, %s, 1, %s, %s)
                   on conflict (subject, day) do update set
                     turns = usage_daily.turns + 1,
                     tokens = usage_daily.tokens + excluded.tokens,
                     usd = usage_daily.usd + excluded.usd""",
                (res.subject, day, tokens, usd),
            )
    except Exception as e:  # 对账失败不影响已出的回合
        log.warning("costguard record failed (subject=%s): %s", res.subject, e)


def stats() -> dict:
    """operator 观测:今日全局花费 + 是否熔断 + Top 来源。"""
    day = _today()
    out: dict = {"enabled": _enabled(), "day": day, "cap": _cap(),
                 "spend_usd": 0.0, "tripped": False, "top_subjects": []}
    try:
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute("select usd, tripped from spend_daily where day = %s", (day,))
            r = cur.fetchone()
            if r:
                out["spend_usd"] = float(r["usd"] or 0)
                out["tripped"] = bool(r["tripped"])
            cur.execute(
                "select subject, turns, tokens, usd from usage_daily "
                "where day = %s order by usd desc limit 10",
                (day,),
            )
            out["top_subjects"] = [
                {"subject": x["subject"], "turns": x["turns"],
                 "tokens": int(x["tokens"] or 0), "usd": float(x["usd"] or 0)}
                for x in cur.fetchall()
            ]
    except Exception as e:
        out["error"] = str(e)
    return out


def set_tripped(tripped: bool) -> dict:
    """运营者急停/恢复:翻今天的全局 kill 开关。"""
    day = _today()
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into spend_daily (day, usd, tripped) values (%s, 0, %s) "
            "on conflict (day) do update set tripped = excluded.tripped",
            (day, tripped),
        )
    return {"day": day, "tripped": tripped}
