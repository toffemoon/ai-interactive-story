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
