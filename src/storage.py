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
    """删会话 (messages 级联删;memory_vec 无 FK,同事务补删防孤儿向量——P2-20)。
    不用 FK cascade:引擎写入顺序是先写向量后建 sessions 行,级联 FK 会让新局首回合失败。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("delete from memory_vec where session_id = %s", (session_id,))
        cur.execute("delete from sessions where id = %s", (session_id,))
        return cur.rowcount > 0


def list_sessions(limit: int = 300, user_id: str | None = None,
                  unowned: bool = False) -> list[dict[str, Any]]:
    """列出会话: id + 更新时间 + 回合数 + 人话标签(故事名/玩家/最后一句)。按最近更新排序。
    unowned=True → 只列无主(user_id null)老存档(供分发);user_id 给定 → 只列该用户的;都不给 → 全部。"""
    if unowned:
        where, params = "where user_id is null ", (limit,)
    elif user_id:
        where, params = "where user_id = %s::uuid ", (user_id, limit)
    else:
        where, params = "", (limit,)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""select id, updated_at,
                      coalesce(jsonb_array_length(
                        case when jsonb_typeof(data->'turns')='array' then data->'turns' else '[]'::jsonb end), 0) as turns,
                      data->'artifacts'->'story'->>'title' as story,
                      data->'artifacts'->'player'->>'name' as player,
                      case when jsonb_typeof(data->'turns')='array' and jsonb_array_length(data->'turns') > 0
                           then left(data->'turns'->-1->>'player_input', 40) else null end as last_input
               from sessions {where}order by updated_at desc nulls last limit %s""",
            params,
        )
        return [{"id": r["id"],
                 "updated_at": str(r["updated_at"]) if r["updated_at"] else None,
                 "turns": r["turns"], "story": r["story"], "player": r["player"],
                 "last_input": r["last_input"]} for r in cur.fetchall()]


def assign_session_owner(session_id: str, user_id: str) -> bool:
    """运营者手动迁移:强制把某局存档归到某用户(账户系统迁移老存档用)。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update sessions set user_id = %s::uuid where id = %s", (user_id, session_id))
        return cur.rowcount > 0


# ---------------- 卡库 (cards) ----------------
# 账户系统:user_id 为 NULL = 官方公共卡(所有人只读可见);非 NULL = 该用户私有卡。
# 唯一性走部分索引:用户行 (user_id,kind,name) 唯一,官方行 (kind,name) 唯一(见 migration)。
# upsert 按 user_id 分支用 on conflict 对准对应部分索引(带 where 谓词)——单语句原子,
# 根治旧 update-then-insert 在并发首存时撞唯一索引 500(P2-19)。

def save_library(kind: str, name: str, payload: dict[str, Any], user_id: str | None = None) -> str:
    """保存卡。user_id=None 入官方公共库(AUTH 关时即旧全局行为);非 None 入该用户私有库。"""
    name_key = slug(name, kind)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if user_id is None:
            cur.execute(
                """insert into cards (kind, name, data) values (%s, %s, %s)
                   on conflict (kind, name) where user_id is null
                   do update set data = excluded.data, updated_at = now()""",
                (kind, name_key, Jsonb(payload)),
            )
        else:
            cur.execute(
                """insert into cards (kind, name, data, user_id) values (%s, %s, %s, %s::uuid)
                   on conflict (user_id, kind, name) where user_id is not null
                   do update set data = excluded.data, updated_at = now()""",
                (kind, name_key, Jsonb(payload), user_id),
            )
    return name_key


def list_library(kind: str, user_id: str | None = None, legacy_all: bool = False) -> list[dict[str, Any]]:
    """legacy_all → 全部(AUTH 关);否则官方(NULL)+ 该用户(user_id 给定时)。official 标记给前端区分。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if legacy_all:
            cur.execute("select name, data, user_id from cards where kind = %s order by updated_at desc", (kind,))
        elif user_id is None:
            cur.execute("select name, data, user_id from cards where kind = %s and user_id is null order by updated_at desc", (kind,))
        else:
            cur.execute(
                "select name, data, user_id from cards where kind = %s and (user_id is null or user_id = %s::uuid) "
                "order by (user_id is null), updated_at desc",
                (kind, user_id),
            )
        return [{"name": r["name"], "path": None, "data": r["data"],
                 "official": r["user_id"] is None} for r in cur.fetchall()]


def delete_library(kind: str, name: str, user_id: str | None = None,
                   is_admin: bool = False, legacy_all: bool = False) -> bool:
    name_key = slug(name, kind)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if legacy_all:
            cur.execute("delete from cards where kind = %s and name = %s", (kind, name_key))
        elif user_id is None:
            # 无用户上下文(脚本/seed/admin 默认)→ 删官方行(user_id is null)。
            # 注:API 匿名写/删走 _write_scope 已挡(401),不会传到这里。
            cur.execute("delete from cards where kind = %s and name = %s and user_id is null", (kind, name_key))
        elif is_admin:
            cur.execute("delete from cards where kind = %s and name = %s and (user_id = %s::uuid or user_id is null)",
                        (kind, name_key, user_id))
        else:
            cur.execute("delete from cards where kind = %s and name = %s and user_id = %s::uuid",
                        (kind, name_key, user_id))
        return cur.rowcount > 0


def assign_card_owner(kind: str, name: str, user_id: str | None) -> bool:
    """分发:把某张(原全局/官方)卡归到某用户(或 None 设回官方)。"""
    name_key = slug(name, kind)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update cards set user_id = %s::uuid where kind = %s and name = %s and user_id is null",
                    (user_id, kind, name_key))
        return cur.rowcount > 0


def assign_preset_owner(name: str, user_id: str | None) -> bool:
    """分发:把某个(原全局/官方)预设归到某用户(或 None 设回官方)。"""
    name_key = slug(name, "preset")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update presets set user_id = %s::uuid where name = %s and user_id is null",
                    (user_id, name_key))
        return cur.rowcount > 0


# ---------------- 故事预设 (presets) ----------------
# 同卡库:user_id NULL = 官方公共预设;非 NULL = 用户私有。

def save_preset(name: str, payload: dict[str, Any], user_id: str | None = None) -> str:
    # 同 save_library:on conflict 对准部分唯一索引,单语句原子(P2-19)。
    name_key = slug(name, "preset")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if user_id is None:
            cur.execute(
                """insert into presets (name, data) values (%s, %s)
                   on conflict (name) where user_id is null
                   do update set data = excluded.data, updated_at = now()""",
                (name_key, Jsonb(payload)),
            )
        else:
            cur.execute(
                """insert into presets (name, data, user_id) values (%s, %s, %s::uuid)
                   on conflict (user_id, name) where user_id is not null
                   do update set data = excluded.data, updated_at = now()""",
                (name_key, Jsonb(payload), user_id),
            )
    return name_key


def list_presets(user_id: str | None = None, legacy_all: bool = False) -> list[dict[str, Any]]:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if legacy_all:
            cur.execute("select name, data, user_id from presets order by updated_at desc")
        elif user_id is None:
            cur.execute("select name, data, user_id from presets where user_id is null order by updated_at desc")
        else:
            cur.execute(
                "select name, data, user_id from presets where user_id is null or user_id = %s::uuid "
                "order by (user_id is null), updated_at desc",
                (user_id,),
            )
        return [{"name": r["name"], "data": r["data"], "official": r["user_id"] is None}
                for r in cur.fetchall()]


def delete_preset(name: str, user_id: str | None = None,
                  is_admin: bool = False, legacy_all: bool = False) -> bool:
    name_key = slug(name, "preset")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        if legacy_all:
            cur.execute("delete from presets where name = %s", (name_key,))
        elif user_id is None:
            # 无用户上下文(脚本/seed/admin 默认)→ 删官方行。API 匿名走 _write_scope 已挡。
            cur.execute("delete from presets where name = %s and user_id is null", (name_key,))
        elif is_admin:
            cur.execute("delete from presets where name = %s and (user_id = %s::uuid or user_id is null)",
                        (name_key, user_id))
        else:
            cur.execute("delete from presets where name = %s and user_id = %s::uuid", (name_key, user_id))
        return cur.rowcount > 0
