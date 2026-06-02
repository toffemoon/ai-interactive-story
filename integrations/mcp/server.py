"""MCP server —— 把 AI 互动故事引擎的纯后端 HTTP API 包装成 MCP 工具。

任何 MCP 客户端(Claude Code / Cowork / Claude Desktop)连上后,就能直接驱动引擎:
识别 / 建卡 / 卡库 / 预设 / 开局 / 回合 / 续玩 / 重 roll,不用自己拼 HTTP。

设计:
- 本 server 是后端 API 的薄代理(httpx 调 STORY_API_BASE,默认 http://127.0.0.1:8000),
  不复制业务逻辑,后端是唯一真相源。
- 额外做一层**会话卡组缓存**:HTTP API 每回合都要重传整套卡(characters/world/story/player),
  对 AI 很笨重;这里让 AI 用 story_start 传一次卡,之后只发玩家输入(story_act)。
  MCP 进程重启后,会从后端已落盘的 artifacts 自动恢复卡组,续玩不断。

运行:
    STORY_API_BASE=http://127.0.0.1:8000 python integrations/mcp/server.py
依赖:见 integrations/mcp/requirements.txt(mcp + httpx)。
"""
from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

BASE = os.environ.get("STORY_API_BASE", "http://127.0.0.1:8000").rstrip("/")
# 回合 / 识别走 LLM,可能 30-60s,给足超时;纯查询走短超时。
LLM_TIMEOUT = float(os.environ.get("STORY_MCP_TIMEOUT", "180"))
GET_TIMEOUT = 30.0

mcp = FastMCP("ai-interactive-story")

# session_id -> {characters, world, story, player, mode};让 AI 开局传一次卡之后免传。
_SESSIONS: dict[str, dict[str, Any]] = {}


def _post(path: str, payload: dict, timeout: float = LLM_TIMEOUT) -> Any:
    r = httpx.post(f"{BASE}{path}", json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _get(path: str, timeout: float = GET_TIMEOUT) -> Any:
    r = httpx.get(f"{BASE}{path}", timeout=timeout)
    r.raise_for_status()
    return r.json()


def _delete(path: str, timeout: float = GET_TIMEOUT) -> Any:
    r = httpx.delete(f"{BASE}{path}", timeout=timeout)
    r.raise_for_status()
    return r.json()


def _cards_for(session_id: str) -> dict[str, Any]:
    """取本 session 的卡组:先看内存缓存,没有就尝试从后端 artifacts 恢复(MCP 重启后续玩)。"""
    s = _SESSIONS.get(session_id)
    if s:
        return s
    try:
        sess = _get(f"/api/session/{session_id}")
        art = (sess or {}).get("artifacts") or {}
        if art.get("characters"):
            s = {
                "characters": art["characters"], "world": art.get("world"),
                "story": art.get("story"), "player": art.get("player"),
                "mode": art.get("mode", "standard"),
            }
            _SESSIONS[session_id] = s
            return s
    except Exception:
        pass
    raise ValueError(f"session '{session_id}' 未开局;请先调 story_start 或 story_start_from_preset")


def _turn(session_id: str, user: str, selected_choice: str) -> dict:
    s = _cards_for(session_id)
    return _post("/api/story_turn", {
        "session_id": session_id, "user": user, "selected_choice": selected_choice,
        "characters": s["characters"], "world": s.get("world"),
        "story": s.get("story"), "player": s.get("player"), "mode": s.get("mode", "standard"),
    })


# ───────── 识别 / 建卡 ─────────

@mcp.tool()
def identify(text: str, kind: str = "auto") -> dict:
    """把一段散文设定识别成结构化卡,并自动入库。

    kind: auto(AI 判类型) / character / world / story / player。
    auto 返回 {kind, confidence, reason, data};指定类型返回对应卡对象。
    """
    if kind == "auto":
        return _post("/api/identify_auto", {"text": text})
    route = {
        "character": "/api/identify", "world": "/api/identify_world",
        "story": "/api/identify_story", "player": "/api/identify_player",
    }
    if kind not in route:
        raise ValueError("kind 必须是 auto/character/world/story/player")
    return _post(route[kind], {"text": text})


@mcp.tool()
def build_card(kind: str, messages: list[dict], draft: dict | None = None, seed: str = "") -> dict:
    """多轮对话式建卡(无状态)。kind: characters/players/worlds/stories。

    messages=[{role,content}] 是至今的建卡对话;draft 是上一轮返回的草稿。
    返回 {reply, draft, next_question, done, filled};done=true 时草稿可入库。
    """
    return _post("/api/build_card", {"kind": kind, "messages": messages, "draft": draft or {}, "seed": seed})


# ───────── 卡库 / 预设 ─────────

@mcp.tool()
def library_list(kind: str) -> list:
    """列出卡库某类卡。kind: characters/worlds/stories/players。返回 [{name, data}]。"""
    return _get(f"/api/library/{kind}")


@mcp.tool()
def library_save(kind: str, data: dict) -> dict:
    """存一张卡进库。kind: characters/worlds/stories/players;data 是完整卡对象。返回 {saved, name}。"""
    return _post("/api/library/save", {"kind": kind, "data": data})


@mcp.tool()
def library_delete(kind: str, name: str) -> dict:
    """删库中一张卡(name 取自 library_list 返回的 name)。"""
    return _delete(f"/api/library/{kind}/{name}")


@mcp.tool()
def preset_list() -> list:
    """列出故事预设(配好的卡组,可一键开局)。返回 [{name, data}]。"""
    return _get("/api/presets")


@mcp.tool()
def preset_save(name: str, characters: list, world: dict | None = None,
                story: dict | None = None, player: dict | None = None,
                mode: str = "standard", synopsis: str = "", tags: list | None = None) -> dict:
    """把一组卡打包成预设(characters 至少一张)。之后可用 story_start_from_preset 一键开局。"""
    return _post("/api/presets", {
        "name": name, "characters": characters, "world": world, "story": story,
        "player": player, "mode": mode, "synopsis": synopsis, "tags": tags or [],
    })


# ───────── 开局 / 回合 ─────────

@mcp.tool()
def story_start(session_id: str, characters: list, world: dict | None = None,
                story: dict | None = None, player: dict | None = None, mode: str = "standard") -> dict:
    """开一局新游戏并缓存卡组到本 session(之后用 story_act 只发玩家输入即可,不必重传卡)。

    session_id 由调用方生成(任意唯一串);characters 是完整角色卡列表(最多 3 张参与本轮);
    mode: standard(近期原文+滚动摘要) / deep(长对话自动向量召回)。
    返回开场回合:{narration, messages, choices, state, ...}。
    """
    _SESSIONS[session_id] = {"characters": characters, "world": world, "story": story,
                             "player": player, "mode": mode}
    return _turn(session_id, "", "")


@mcp.tool()
def story_start_from_preset(session_id: str, preset_name: str, mode: str | None = None) -> dict:
    """用一个已存预设开局(preset_name 取自 preset_list 的 name)。自动取出卡组缓存并开场。"""
    presets = _get("/api/presets")
    p = next((x for x in presets if x.get("name") == preset_name), None)
    if not p:
        raise ValueError(f"找不到预设 '{preset_name}';可用:{[x.get('name') for x in presets]}")
    d = p.get("data") or {}
    _SESSIONS[session_id] = {
        "characters": d.get("characters") or [], "world": d.get("world"),
        "story": d.get("story"), "player": d.get("player"),
        "mode": mode or d.get("mode") or "standard",
    }
    return _turn(session_id, "", "")


@mcp.tool()
def story_act(session_id: str, user: str = "", selected_choice: str = "") -> dict:
    """推进一回合(用 story_start 缓存的卡组,不必重传)。

    二选一:user=自由输入(如"我走上前问她来历"),或 selected_choice=上一回合某 choice 的 id。
    返回新回合 {narration, messages, choices, state_update, state, triggered_events, usage, reasoning}。
    """
    if not user.strip() and not selected_choice.strip():
        raise ValueError("user 或 selected_choice 至少给一个")
    return _turn(session_id, user, selected_choice)


@mcp.tool()
def story_turn_raw(session_id: str, characters: list, user: str = "", selected_choice: str = "",
                   world: dict | None = None, story: dict | None = None,
                   player: dict | None = None, mode: str = "standard") -> dict:
    """忠实于 HTTP API 的原始回合调用:每次自带完整卡组,不用本地缓存。

    一般用 story_start + story_act 更省事;只有需要无状态/每轮换卡时才用这个。
    """
    return _post("/api/story_turn", {
        "session_id": session_id, "characters": characters, "user": user,
        "selected_choice": selected_choice, "world": world, "story": story,
        "player": player, "mode": mode,
    })


@mcp.tool()
def reroll(session_id: str) -> dict:
    """对上一回合不满意,用相同输入重新生成(回滚到上一回合之前的快照再重跑)。"""
    return _post("/api/reroll", {"session_id": session_id})


# ───────── 会话 / 单角色对话 ─────────

@mcp.tool()
def session_get(session_id: str) -> dict:
    """查看一局存档(messages / state / turns / usage_total 等),用于续玩还原或看状态面板。"""
    return _get(f"/api/session/{session_id}")


@mcp.tool()
def session_delete(session_id: str) -> dict:
    """删除一局存档(并清掉本地卡组缓存)。"""
    _SESSIONS.pop(session_id, None)
    return _delete(f"/api/session/{session_id}")


@mcp.tool()
def chat(card: dict, session_id: str, user: str, world: dict | None = None) -> dict:
    """与单个角色直聊(不走故事引擎,无选项/状态)。card 是完整角色卡;历史按 session_id 维护。返回 {reply}。"""
    return _post("/api/chat", {"card": card, "session_id": session_id, "user": user, "world": world})


if __name__ == "__main__":
    mcp.run()  # 默认 stdio transport,供 MCP 客户端以子进程方式启动
