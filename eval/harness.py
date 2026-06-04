"""离线测试夹具 —— 把引擎与外部依赖(Supabase / 向量模型)隔离,让评测零成本、确定性地跑。

- in_memory_storage():把 src.storage 的 load/save/delete 换成进程内 dict 版,引擎不碰 Postgres。
- 标准模式下 memory.is_ready() 恒为 False(向量模型未加载),所有 memory 调用自然 no-op,不碰 DB。
  → 因此离线模式下引擎完全不需要网络 / 数据库,适配器 + 脚本 LLM 就能跑通整个回合循环。
"""

from __future__ import annotations

import contextlib
import copy

from src import storage


class MemStore:
    """进程内会话存储,接口对齐 storage 的 load/save/delete。"""

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}

    def load_session(self, session_id: str) -> dict:
        if session_id not in self.sessions:
            return {
                "session_id": session_id, "messages": [], "short_memory": [],
                "long_memory": [], "state": None, "artifacts": {},
            }
        return copy.deepcopy(self.sessions[session_id])

    def save_session(self, session_id: str, data: dict) -> None:
        self.sessions[session_id] = copy.deepcopy(data)

    def delete_session(self, session_id: str) -> bool:
        return self.sessions.pop(session_id, None) is not None


@contextlib.contextmanager
def in_memory_storage():
    """临时把 storage 的会话读写换成内存版;退出时还原。yield 出 MemStore 供检查。"""
    store = MemStore()
    orig = {
        "load_session": storage.load_session,
        "save_session": storage.save_session,
        "delete_session": storage.delete_session,
    }
    storage.load_session = store.load_session
    storage.save_session = store.save_session
    storage.delete_session = store.delete_session
    try:
        yield store
    finally:
        for k, v in orig.items():
            setattr(storage, k, v)


@contextlib.contextmanager
def in_memory_vectors():
    """离线 deep:把 memory 的存/检索换成进程内 numpy 余弦,deep 不再依赖 Supabase pgvector。
    - 仍用真实本地 bge embedding(_embed/_load_model/ensure_loading/is_ready 不动,纯本地、无网络)。
    - 距离对齐 pgvector `<=>`:余弦距离 = 1 - dot(向量已 normalize)。
    - 比远端 pgvector 还快(无网络往返),且免去免费 Supabase 被 pause 的 TCP 卡死。
    """
    import hashlib
    import numpy as np
    from src import memory as M
    vec: dict[tuple, dict] = {}  # (session, scope, ext_id) -> {content, meta, emb}

    def _put(session, scope, ext_id, content, emb, meta):
        vec[(session, scope, str(ext_id)[:200])] = {
            "content": content, "meta": meta or {}, "emb": np.asarray(emb, dtype="float32")}

    def _scored(session_id, scope, query, k, max_turn=None, vis_filter=False):
        q = np.asarray(M._embed([query])[0], dtype="float32")
        items = []
        for (s, sc, _), rec in vec.items():
            if s != session_id or sc != scope:
                continue
            if max_turn is not None and int(rec["meta"].get("turn", 0)) > max_turn:
                continue
            if vis_filter and rec["meta"].get("visibility", "public") == "hidden":
                continue
            items.append((rec, 1.0 - float(np.dot(q, rec["emb"]))))  # 余弦距离
        items.sort(key=lambda x: x[1])
        return items[:k]

    def add_turn(session_id, turn, role, content, present=None):
        if not str(content).strip() or not M.is_ready():
            return
        meta = {"turn": turn, "role": role}
        if present:
            meta["present"] = list(present)
        _put(session_id, "turn", f"{turn}-{role}", content, M._embed([content])[0], meta)

    def add_memory(session_id, memory_id, text, *, kind="note", importance=3, entity=""):
        if not str(text).strip() or not M.is_ready():
            return
        meta = {"kind": kind, "importance": importance}
        if entity:
            meta["entity"] = entity
        _put(session_id, "lm", memory_id, text, M._embed([text])[0], meta)

    def index_history(session_id, messages, turn_present=None):
        if not M.is_ready():
            return
        rows = []
        for i, m in enumerate(messages):
            if not isinstance(m, dict):
                continue
            content = str(m.get("content", "")).strip()
            role = m.get("role")
            if not content or role not in {"user", "assistant"}:
                continue
            meta = {"turn": i, "role": role}
            pres = (turn_present or {}).get(i) or (turn_present or {}).get(str(i))
            if pres:
                meta["present"] = list(pres)
            rows.append((f"{i}-{role}", content, meta))
        if rows:
            for (eid, content, meta), emb in zip(rows, M._embed([c for _, c, _ in rows])):
                _put(session_id, "turn", eid, content, emb, meta)

    def index_knowledge(session_id, entries):
        if not M.is_ready():
            return
        rows = []
        for entry in entries:
            content = (entry.get("content") or "").strip()
            if not content:
                continue
            title = entry.get("title") or entry.get("comment") or ""
            source = entry.get("source") or "world"
            raw_id = entry.get("id") or entry.get("entry_id") or f"{source}:{title}:{content[:40]}"
            hid = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()
            text = f"{title}\n{content}".strip()
            rows.append((hid, text, {"source": source, "title": title[:200],
                                     "truth_status": entry.get("truth_status", "canon"),
                                     "visibility": entry.get("visibility", "public")}))
        if rows:
            for (eid, content, meta), emb in zip(rows, M._embed([c for _, c, _ in rows])):
                _put(session_id, "kb", eid, content, emb, meta)

    def search_long_memory(session_id, query, k=5):
        return [] if not M.is_ready() else [rec["content"] for rec, _ in _scored(session_id, "lm", query, k)]

    def search_knowledge(session_id, query, k=6):
        if not M.is_ready():
            return []
        return [f"[{rec['meta'].get('source','kb')}/{rec['meta'].get('truth_status','canon')}] {rec['content']}"
                for rec, _ in _scored(session_id, "kb", query, k, vis_filter=True)]

    def _line(rec):  # 与 memory.search 同款渲染:在场标注 + 角色:内容
        pres = rec["meta"].get("present")
        tag = f"[当时在场:{'、'.join(pres)}] " if pres else ""
        role = "玩家" if rec["meta"].get("role") == "user" else "角色"
        return f"{tag}{role}:{rec['content']}"

    def search(session_id, query, k=3, max_turn=None):
        if not M.is_ready():
            return []
        return [_line(rec) for rec, _ in _scored(session_id, "turn", query, k, max_turn=max_turn)]

    def search_scored(session_id, query, k=4, max_turn=None):
        if not M.is_ready():
            return []
        return [(_line(rec), dist) for rec, dist in _scored(session_id, "turn", query, k, max_turn=max_turn)]

    names = ["add_turn", "add_memory", "index_history", "index_knowledge",
             "search_long_memory", "search_knowledge", "search", "search_scored"]
    local = locals()
    orig = {n: getattr(M, n) for n in names}
    for n in names:
        setattr(M, n, local[n])
    try:
        yield vec
    finally:
        for n, fn in orig.items():
            setattr(M, n, fn)
