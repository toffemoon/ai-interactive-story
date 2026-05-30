"""长期记忆 —— 对话/世界书/故事书向量化 + 检索。

向量从 chromadb 迁到 **Supabase Postgres + pgvector**
(见 decisions/2026-05-30-db-supabase-postgres.md)。embedding 仍用本地
bge-small-zh-v1.5(轻、快、中文好,512 维),只是存/检索落到 pgvector。

三类向量统一放 memory_vec 表, 用 scope 区分:
- 'turn' —— 对话轮 (ext_id=f"{turn}-{role}", meta={turn, role})
- 'lm'   —— 结构化长期记忆 (ext_id=memory_id, meta={kind, importance})
- 'kb'   —— 世界书/故事书条目 (ext_id=sha1, meta={source,title,truth_status,visibility})

作用:长对话时不必把全部历史塞进 context —— 近期几轮发原文,更早的内容按
当前提问相关性检索回来,解决 context window 限制。

函数签名跟旧 chromadb 版一致 (sync)。故事回合 (async) 里的调用由 story.py
用 asyncio.to_thread 包。
"""

from __future__ import annotations

import hashlib
import os
import threading

from psycopg.types.json import Jsonb
from pgvector import Vector

from .db import get_pool

_model = None
_available = True
_load_lock = threading.Lock()
_loading = False
_load_failed = False


def embeddings_enabled() -> bool:
    """旧 env 开关,保留兼容;v2 改由「深度模式」按上下文长度驱动加载,不再依赖它。"""
    return os.getenv("ENABLE_EMBEDDINGS", "0").lower() in {"1", "true", "yes", "on"}


def _load_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    return _model


def ensure_loading() -> None:
    """后台异步加载 embedding 模型(幂等)。

    深度模式在上下文逼近阈值时调用:模型在后台线程加载(首次 ~100MB),加载完成前
    调用方按纯文本降级,完成后无缝接上召回 —— 避免「要召回那一刻才同步加载」的卡顿。
    """
    global _loading
    if _model is not None or _load_failed:
        return
    with _load_lock:
        if _loading or _model is not None:
            return
        _loading = True

    def _bg():
        global _loading, _load_failed
        try:
            _load_model()
        except Exception as e:  # 加载失败:本进程不再重试,调用方继续纯文本降级
            _load_failed = True
            print(f"[memory] embedding model load failed: {e}")
        finally:
            _loading = False

    threading.Thread(target=_bg, daemon=True).start()


def is_ready() -> bool:
    """embedding 模型已加载且向量层可用。所有读写以它为门控:未就绪即 no-op(纯文本降级)。"""
    return _model is not None and _available


def _mark_unavailable(exc: Exception) -> None:
    """向量检索只是增强项;pg 出错时本进程降级为纯文本,不影响主流程。"""
    global _available
    _available = False
    print(f"[memory] vector store disabled for this process: {exc}")


def _embed(texts: list[str]) -> list[list[float]]:
    return _load_model().encode(texts, normalize_embeddings=True).tolist()


def _upsert_many(rows: list[tuple]) -> None:
    """rows: [(session_id, scope, ext_id, content, embedding, meta_dict), ...]"""
    if not rows:
        return
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        for session_id, scope, ext_id, content, embedding, meta in rows:
            cur.execute(
                """insert into memory_vec (session_id, scope, ext_id, content, embedding, meta)
                   values (%s, %s, %s, %s, %s, %s)
                   on conflict (session_id, scope, ext_id)
                   do update set content = excluded.content,
                                 embedding = excluded.embedding,
                                 meta = excluded.meta""",
                (session_id, scope, ext_id[:200], content, Vector(embedding), Jsonb(meta)),
            )


def index_history(session_id: str, messages: list) -> None:
    """把已有整段对话历史一次性补建进向量库(深度模式刚就绪时调一次,upsert 幂等)。"""
    if not is_ready():
        return
    docs, rows_meta = [], []
    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            continue
        content = str(m.get("content", "")).strip()
        role = m.get("role")
        if not content or role not in {"user", "assistant"}:
            continue
        docs.append(content)
        rows_meta.append((f"{i}-{role}", content, {"turn": i, "role": role}))
    if not docs:
        return
    try:
        embs = _embed(docs)
        _upsert_many([
            (session_id, "turn", ext_id, content, emb, meta)
            for (ext_id, content, meta), emb in zip(rows_meta, embs)
        ])
    except Exception as e:
        _mark_unavailable(e)


def add_turn(session_id: str, turn: int, role: str, content: str) -> None:
    """把一轮对话存进向量库。"""
    if not content.strip() or not is_ready():
        return
    try:
        emb = _embed([content])[0]
        _upsert_many([(session_id, "turn", f"{turn}-{role}", content, emb, {"turn": turn, "role": role})])
    except Exception as e:
        _mark_unavailable(e)


def add_memory(session_id: str, memory_id: str, text: str, *, kind: str = "note", importance: int = 3) -> None:
    """把结构化抽取出的长期记忆写入(scope='lm')。"""
    if not text.strip() or not is_ready():
        return
    try:
        emb = _embed([text])[0]
        _upsert_many([(session_id, "lm", memory_id, text, emb, {"kind": kind, "importance": importance})])
    except Exception as e:
        _mark_unavailable(e)


def search_long_memory(session_id: str, query: str, k: int = 5) -> list[str]:
    if not is_ready():
        return []
    try:
        emb = Vector(_embed([query])[0])
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """select content from memory_vec
                   where session_id = %s and scope = 'lm'
                   order by embedding <=> %s limit %s""",
                (session_id, emb, k),
            )
            return [r["content"] for r in cur.fetchall()]
    except Exception as e:
        _mark_unavailable(e)
        return []


def index_knowledge(session_id: str, entries: list[dict]) -> None:
    """索引世界书/故事书条目(scope='kb')。entries 需含 id/content/source/title。"""
    if not is_ready():
        return
    docs, rows_meta = [], []
    for entry in entries:
        content = (entry.get("content") or "").strip()
        if not content:
            continue
        title = entry.get("title") or entry.get("comment") or ""
        source = entry.get("source") or "world"
        raw_id = entry.get("id") or entry.get("entry_id") or f"{source}:{title}:{content[:40]}"
        hid = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()
        docs.append(f"{title}\n{content}".strip())
        rows_meta.append((hid, f"{title}\n{content}".strip(), {
            "source": source,
            "title": title[:200],
            "truth_status": entry.get("truth_status", "canon"),
            "visibility": entry.get("visibility", "public"),
        }))
    if not docs:
        return
    try:
        embs = _embed(docs)
        _upsert_many([
            (session_id, "kb", ext_id, content, emb, meta)
            for (ext_id, content, meta), emb in zip(rows_meta, embs)
        ])
    except Exception as e:
        _mark_unavailable(e)


def search_knowledge(session_id: str, query: str, k: int = 6) -> list[str]:
    if not is_ready():
        return []
    try:
        emb = Vector(_embed([query])[0])
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """select content, meta from memory_vec
                   where session_id = %s and scope = 'kb'
                     and coalesce(meta->>'visibility', 'public') <> 'hidden'
                   order by embedding <=> %s limit %s""",
                (session_id, emb, k),
            )
            out = []
            for r in cur.fetchall():
                meta = r["meta"] or {}
                out.append(f"[{meta.get('source','kb')}/{meta.get('truth_status','canon')}] {r['content']}")
            return out
    except Exception as e:
        _mark_unavailable(e)
        return []


def search(session_id: str, query: str, k: int = 3, max_turn: int | None = None) -> list[str]:
    """按 query 检索相关旧对话。max_turn 限制只召回该轮及更早(近期已在原文,不重复召回)。"""
    if not is_ready():
        return []
    try:
        emb = Vector(_embed([query])[0])
        pool = get_pool()
        with pool.connection() as conn, conn.cursor() as cur:
            if max_turn is not None:
                cur.execute(
                    """select content, meta from memory_vec
                       where session_id = %s and scope = 'turn'
                         and (meta->>'turn')::int <= %s
                       order by embedding <=> %s limit %s""",
                    (session_id, max_turn, emb, k),
                )
            else:
                cur.execute(
                    """select content, meta from memory_vec
                       where session_id = %s and scope = 'turn'
                       order by embedding <=> %s limit %s""",
                    (session_id, emb, k),
                )
            out = []
            for r in cur.fetchall():
                meta = r["meta"] or {}
                role = "玩家" if meta.get("role") == "user" else "角色"
                out.append(f"{role}:{r['content']}")
            return out
    except Exception as e:
        _mark_unavailable(e)
        return []
