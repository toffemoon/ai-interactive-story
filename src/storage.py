"""持久化层 —— Supabase Postgres (psycopg3 连接池)。

v1 进程内 / v2 JSON 文件 / v3 (本版) Postgres 上云
(见 decisions/2026-05-30-db-supabase-postgres.md)。

设计要点:
- session 的结构化字段 (state / short_memory / long_memory / artifacts ...)
  整体存 sessions.data jsonb (不枚举字段, 避免丢字段);
- messages **append-only 行** —— 每回合 INSERT 新行, 不再像 JSON 那样全量重写
  整个 session blob (旧设计 O(n^2))。reroll/编辑改了尾部 → 回退到整段 resync。
- 函数签名跟旧文件版保持一致 (sync), 调用方基本不用改;
  故事回合 (async) 里的调用由 story.py / api.py 用 asyncio.to_thread 包。

库 / 预设的 "name" 沿用旧文件版语义 = slug(原名), 跟旧 path.stem 一致。
"""

from __future__ import annotations

import re
from typing import Any

from psycopg.types.json import Jsonb

from .db import get_pool


def slug(text: str, fallback: str = "item") -> str:
    """生成适合作文件名/ID 的短 slug。中文会保留。(纯字符串, 无 I/O)"""
    s = re.sub(r"[^\w一-鿿-]+", "-", text.strip(), flags=re.UNICODE)
    s = re.sub(r"-+", "-", s).strip("-_").lower()
    return s[:48] or fallback


# ---------------- sessions + messages ----------------

def _empty_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "messages": [],
        "short_memory": [],
        "long_memory": [],
        "state": None,
        "artifacts": {},
    }


def load_session(session_id: str) -> dict[str, Any]:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select data from sessions where id = %s", (session_id,))
        row = cur.fetchone()
        if not row:
            return _empty_session(session_id)
        blob = dict(row["data"] or {})
        cur.execute(
            "select data from messages where session_id = %s order by seq",
            (session_id,),
        )
        msgs = [r["data"] for r in cur.fetchall()]
    blob["session_id"] = session_id
    blob["messages"] = msgs
    blob.setdefault("short_memory", [])
    blob.setdefault("long_memory", [])
    blob.setdefault("state", None)
    blob.setdefault("artifacts", {})
    return blob


def _msg_eq(a: Any, b: Any) -> bool:
    if not isinstance(a, dict) or not isinstance(b, dict):
        return a == b
    return a.get("role") == b.get("role") and a.get("content") == b.get("content")


def save_session(session_id: str, data: dict[str, Any]) -> None:
    data = dict(data)
    data["session_id"] = session_id
    msgs = data.get("messages", []) or []
    blob = {k: v for k, v in data.items() if k != "messages"}

    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """insert into sessions (id, data, updated_at)
               values (%s, %s, now())
               on conflict (id) do update set data = excluded.data, updated_at = now()""",
            (session_id, Jsonb(blob)),
        )

        cur.execute("select count(*) as c from messages where session_id = %s", (session_id,))
        db_count = cur.fetchone()["c"]
        n = len(msgs)

        # 快路径: 纯追加 (历史前缀没动) → 只 INSERT 新增的几条
        append_ok = False
        if n >= db_count:
            if db_count == 0:
                append_ok = True
            else:
                cur.execute(
                    "select data from messages where session_id = %s and seq = %s",
                    (session_id, db_count - 1),
                )
                r = cur.fetchone()
                if r and _msg_eq(r["data"], msgs[db_count - 1]):
                    append_ok = True

        if append_ok:
            for seq in range(db_count, n):
                cur.execute(
                    """insert into messages (session_id, seq, data) values (%s, %s, %s)
                       on conflict (session_id, seq) do update set data = excluded.data""",
                    (session_id, seq, Jsonb(msgs[seq])),
                )
        else:
            # reroll / 编辑改了尾部 → 整段重写 (低频)
            cur.execute("delete from messages where session_id = %s", (session_id,))
            for seq in range(n):
                cur.execute(
                    "insert into messages (session_id, seq, data) values (%s, %s, %s)",
                    (session_id, seq, Jsonb(msgs[seq])),
                )


def delete_session(session_id: str) -> bool:
    """删会话 (messages 级联删)。替代旧 session_path(id).unlink()。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("delete from sessions where id = %s", (session_id,))
        return cur.rowcount > 0


def list_sessions(limit: int = 300) -> list[dict[str, Any]]:
    """列出会话 (后台控制台用): id + 更新时间 + 回合数。按最近更新排序。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """select id, updated_at,
                      coalesce(jsonb_array_length(
                        case when jsonb_typeof(data->'turns')='array' then data->'turns' else '[]'::jsonb end), 0) as turns
               from sessions order by updated_at desc nulls last limit %s""",
            (limit,),
        )
        return [{"id": r["id"],
                 "updated_at": str(r["updated_at"]) if r["updated_at"] else None,
                 "turns": r["turns"]} for r in cur.fetchall()]


# ---------------- 卡库 (cards) ----------------

def save_library(kind: str, name: str, payload: dict[str, Any]) -> str:
    """保存用户上传/识别出的卡。name 用 slug(原名) 作 key, 重名覆盖 (跟旧文件版一致)。"""
    name_key = slug(name, kind)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """insert into cards (kind, name, data, updated_at)
               values (%s, %s, %s, now())
               on conflict (kind, name) do update set data = excluded.data, updated_at = now()""",
            (kind, name_key, Jsonb(payload)),
        )
    return name_key


def list_library(kind: str) -> list[dict[str, Any]]:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select name, data from cards where kind = %s order by updated_at desc",
            (kind,),
        )
        return [{"name": r["name"], "path": None, "data": r["data"]} for r in cur.fetchall()]


def delete_library(kind: str, name: str) -> bool:
    name_key = slug(name, kind)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("delete from cards where kind = %s and name = %s", (kind, name_key))
        return cur.rowcount > 0


# ---------------- 故事预设 (presets) ----------------

def save_preset(name: str, payload: dict[str, Any]) -> str:
    name_key = slug(name, "preset")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """insert into presets (name, data, updated_at)
               values (%s, %s, now())
               on conflict (name) do update set data = excluded.data, updated_at = now()""",
            (name_key, Jsonb(payload)),
        )
    return name_key


def list_presets() -> list[dict[str, Any]]:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select name, data from presets order by updated_at desc")
        return [{"name": r["name"], "data": r["data"]} for r in cur.fetchall()]


def delete_preset(name: str) -> bool:
    name_key = slug(name, "preset")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("delete from presets where name = %s", (name_key,))
        return cur.rowcount > 0
