"""长期记忆 —— 对话向量化 + 检索。

数据是"对话轮"而非文档,所以直接用 chromadb + sentence-transformers,
不套文档解析框架。embedding 用 bge-small-zh-v1.5(轻、快、中文好),可换 bge-m3。

作用:长对话时不必把全部历史塞进 context —— 近期几轮发原文,更早的内容按
当前提问相关性检索回来,解决 context window 限制。
"""

from pathlib import Path
import hashlib
import os
import threading

import chromadb

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "data" / "memory"

_model = None
_client = None
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
    """模型已加载且向量库可用。所有读写都以它为门控:未就绪即全部 no-op(纯文本降级)。"""
    return _model is not None and _available


def _mark_unavailable(exc: Exception) -> None:
    """Chroma/HNSW 本地索引偶尔会坏;向量检索只是增强项,失败时本局降级。"""
    global _available
    _available = False
    print(f"[memory] vector store disabled for this process: {exc}")


def _embed(texts: list[str]) -> list[list[float]]:
    return _load_model().encode(texts, normalize_embeddings=True).tolist()


def index_history(session_id: str, messages: list) -> None:
    """把已有的整段对话历史一次性补建进向量库。

    深度模式在模型刚就绪时调用一次:此前的回合因模型未加载而漏建索引,这里补齐,
    否则召回时库是空的、召回不到早期剧情。upsert 幂等,重复调用安全。
    """
    if not is_ready():
        return
    docs, ids, metas = [], [], []
    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            continue
        content = str(m.get("content", "")).strip()
        role = m.get("role")
        if not content or role not in {"user", "assistant"}:
            continue
        docs.append(content)
        ids.append(f"{i}-{role}")
        metas.append({"turn": i, "role": role})
    if not docs:
        return
    try:
        c = _collection(session_id)
        c.upsert(ids=ids, documents=docs, embeddings=_embed(docs), metadatas=metas)
    except Exception as e:
        _mark_unavailable(e)


def _collection(session_id: str):
    global _client
    if _client is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(DB_DIR))
    # collection 名需 3-63 位字母数字;session_id 前端用 hex,加前缀保证合法
    return _client.get_or_create_collection(
        name=f"s{session_id}"[:63], metadata={"hnsw:space": "cosine"}
    )


def _named_collection(prefix: str, session_id: str):
    global _client
    if _client is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(DB_DIR))
    clean = "".join(ch for ch in session_id if ch.isalnum())[:50] or "default"
    return _client.get_or_create_collection(
        name=f"{prefix}{clean}"[:63], metadata={"hnsw:space": "cosine"}
    )


def add_turn(session_id: str, turn: int, role: str, content: str) -> None:
    """把一轮对话存进向量库。"""
    if not content.strip() or not is_ready():
        return
    try:
        c = _collection(session_id)
        c.upsert(
            ids=[f"{turn}-{role}"],
            documents=[content],
            embeddings=_embed([content]),
            metadatas=[{"turn": turn, "role": role}],
        )
    except Exception as e:
        _mark_unavailable(e)


def add_memory(session_id: str, memory_id: str, text: str, *, kind: str = "note", importance: int = 3) -> None:
    """把结构化抽取出的长期记忆写入单独 collection。"""
    if not text.strip() or not is_ready():
        return
    try:
        c = _named_collection("lm", session_id)
        c.upsert(
            ids=[memory_id[:120]],
            documents=[text],
            embeddings=_embed([text]),
            metadatas=[{"kind": kind, "importance": importance}],
        )
    except Exception as e:
        _mark_unavailable(e)


def search_long_memory(session_id: str, query: str, k: int = 5) -> list[str]:
    if not is_ready():
        return []
    try:
        c = _named_collection("lm", session_id)
        if c.count() == 0:
            return []
        res = c.query(query_embeddings=_embed([query]), n_results=min(k, c.count()))
        return [doc for doc in res["documents"][0]]
    except Exception as e:
        _mark_unavailable(e)
        return []


def index_knowledge(session_id: str, entries: list[dict]) -> None:
    """索引世界书/故事书条目。entries 需包含 id/content/source/title。"""
    docs, ids, metas = [], [], []
    for entry in entries:
        content = (entry.get("content") or "").strip()
        if not content:
            continue
        title = entry.get("title") or entry.get("comment") or ""
        source = entry.get("source") or "world"
        raw_id = entry.get("id") or entry.get("entry_id") or f"{source}:{title}:{content[:40]}"
        hid = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()
        docs.append(f"{title}\n{content}".strip())
        ids.append(hid)
        metas.append({
            "source": source,
            "title": title[:200],
            "truth_status": entry.get("truth_status", "canon"),
            "visibility": entry.get("visibility", "public"),
        })
    if not docs or not is_ready():
        return
    try:
        c = _named_collection("kb", session_id)
        c.upsert(ids=ids, documents=docs, embeddings=_embed(docs), metadatas=metas)
    except Exception as e:
        _mark_unavailable(e)


def search_knowledge(session_id: str, query: str, k: int = 6) -> list[str]:
    if not is_ready():
        return []
    try:
        c = _named_collection("kb", session_id)
        if c.count() == 0:
            return []
        res = c.query(query_embeddings=_embed([query]), n_results=min(k, c.count()))
        out = []
        for doc, meta in zip(res["documents"][0], res["metadatas"][0]):
            if meta.get("visibility") == "hidden":
                continue
            out.append(f"[{meta.get('source','kb')}/{meta.get('truth_status','canon')}] {doc}")
            if len(out) >= k:
                break
        return out
    except Exception as e:
        _mark_unavailable(e)
        return []


def search(session_id: str, query: str, k: int = 3, max_turn: int | None = None) -> list[str]:
    """按 query 检索相关旧对话。max_turn 限制只召回该轮及更早(近期已在原文,不重复召回)。"""
    if not is_ready():
        return []
    try:
        c = _collection(session_id)
        if c.count() == 0:
            return []
        res = c.query(query_embeddings=_embed([query]), n_results=min(k * 3, c.count()))
        out = []
        for doc, meta in zip(res["documents"][0], res["metadatas"][0]):
            if max_turn is not None and meta["turn"] > max_turn:
                continue
            role = "玩家" if meta["role"] == "user" else "角色"
            out.append(f"{role}:{doc}")
            if len(out) >= k:
                break
        return out
    except Exception as e:
        _mark_unavailable(e)
        return []
