"""轻量持久化层。

v1 把会话放在进程内,重启即丢。v2 先用 JSON 文件持久化 session / cards /
story runtime,保持实现简单、可检查、方便后续换 SQLite。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SAVE_DIR = ROOT / "data" / "sessions"
LIB_DIR = ROOT / "data" / "library"
PRESET_DIR = ROOT / "data" / "presets"


def slug(text: str, fallback: str = "item") -> str:
    """生成适合作文件名/ID 的短 slug。中文会保留。"""
    s = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", text.strip(), flags=re.UNICODE)
    s = re.sub(r"-+", "-", s).strip("-_").lower()
    return s[:48] or fallback


def session_path(session_id: str) -> Path:
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    return SAVE_DIR / f"{slug(session_id, 'session')}.json"


def load_session(session_id: str) -> dict[str, Any]:
    path = session_path(session_id)
    if not path.exists():
        return {
            "session_id": session_id,
            "messages": [],
            "short_memory": [],
            "long_memory": [],
            "state": None,
            "artifacts": {},
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        broken = path.with_suffix(f".broken-{path.stat().st_mtime_ns}.json")
        path.replace(broken)
        return {
            "session_id": session_id,
            "messages": [],
            "short_memory": [],
            "long_memory": [{"kind": "note", "text": "上一份会话文件损坏,已自动开启新会话。", "importance": 2}],
            "state": None,
            "artifacts": {},
        }
    if not isinstance(data, dict):
        return {
            "session_id": session_id,
            "messages": [],
            "short_memory": [],
            "long_memory": [],
            "state": None,
            "artifacts": {},
        }
    data.setdefault("messages", [])
    data.setdefault("short_memory", [])
    data.setdefault("long_memory", [])
    data.setdefault("state", None)
    data.setdefault("artifacts", {})
    return data


def save_session(session_id: str, data: dict[str, Any]) -> None:
    path = session_path(session_id)
    data["session_id"] = session_id
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def save_library(kind: str, name: str, payload: dict[str, Any]) -> Path:
    """保存用户上传/识别出的卡片,供之后列表管理。"""
    target = LIB_DIR / kind
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{slug(name, kind)}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def save_preset(name: str, payload: dict[str, Any]) -> Path:
    """保存一个「故事预设」(一套配好的卡组 + 模式),供主界面复用开新局。"""
    PRESET_DIR.mkdir(parents=True, exist_ok=True)
    path = PRESET_DIR / f"{slug(name, 'preset')}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def list_presets() -> list[dict[str, Any]]:
    if not PRESET_DIR.exists():
        return []
    out = []
    for path in sorted(PRESET_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            out.append({"name": path.stem, "data": json.loads(path.read_text(encoding="utf-8"))})
        except json.JSONDecodeError:
            continue
    return out


def delete_preset(name: str) -> bool:
    path = PRESET_DIR / f"{slug(name, 'preset')}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def delete_library(kind: str, name: str) -> bool:
    """从卡库删一张卡。name 取自 list_library 返回的 stem(已是 slug);slug() 幂等且防路径穿越。"""
    target = LIB_DIR / kind / f"{slug(name, kind)}.json"
    if target.exists():
        target.unlink()
        return True
    return False


def list_library(kind: str) -> list[dict[str, Any]]:
    target = LIB_DIR / kind
    if not target.exists():
        return []
    out = []
    for path in sorted(target.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            out.append({"name": path.stem, "path": str(path), "data": data})
        except json.JSONDecodeError:
            continue
    return out
