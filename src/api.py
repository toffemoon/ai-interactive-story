"""FastAPI 后端 —— serve 前端 + 端点:角色识别 / 世界书识别 / 文件上传 / 对话。

启动:
    uv run uvicorn src.api:app --reload --port 8000
然后浏览器开 http://localhost:8000
"""

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .identify import (
    build_card,
    extract_text_from_file,
    identify,
    identify_auto,
    identify_player,
    identify_storybook,
    identify_worldbook,
)
from .chat import reply
from .models import CharacterCard, PlayerCard, RuntimeState, StoryBook, WorldBook
from .story import story_turn
from . import storage

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

app = FastAPI(title="AI 互动故事")


class TextReq(BaseModel):
    text: str


class AutoReq(BaseModel):
    text: str
    kind: str | None = None  # 可选:用户在前端改判类型时强制指定(character/world/story/player)


class BuildCardReq(BaseModel):
    kind: str = "characters"       # characters / players / worlds / stories
    messages: list[dict] = []      # [{role:user/assistant, content}] 至今的建卡对话
    draft: dict | None = None      # 当前草稿(对应卡的 data)
    seed: str = ""                 # 可选:已有资料/旧卡文本(完善模式)


class ChatReq(BaseModel):
    card: CharacterCard
    session_id: str
    user: str
    world: WorldBook | None = None


class StoryTurnReq(BaseModel):
    characters: list[CharacterCard]
    session_id: str
    user: str = ""
    selected_choice: str = ""
    world: WorldBook | None = None
    story: StoryBook | None = None
    player: PlayerCard | None = None
    mode: str = "standard"  # standard = 原文+滚动摘要(无 embedding);deep = 长对话时自动上向量召回


class ReRollReq(BaseModel):
    session_id: str


@app.post("/api/identify")
def api_identify(req: TextReq):
    """散文设定 → 角色 Card V2。"""
    if not req.text.strip():
        raise HTTPException(400, "设定文字不能为空")
    try:
        card = identify(req.text)
        storage.save_library("characters", card.data.name, card.model_dump())
        return card.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_world")
def api_identify_world(req: TextReq):
    """世界观文字 → 多条带关键词的世界书条目。"""
    if not req.text.strip():
        raise HTTPException(400, "世界观文字不能为空")
    try:
        world = identify_worldbook(req.text)
        storage.save_library("worlds", world.name, world.model_dump())
        return world.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_story")
def api_identify_story(req: TextReq):
    """故事书文字 → 时间线 / 主线 / 可触发事件节点。"""
    if not req.text.strip():
        raise HTTPException(400, "故事书文字不能为空")
    try:
        story = identify_storybook(req.text)
        storage.save_library("stories", story.title, story.model_dump())
        return story.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_player")
def api_identify_player(req: TextReq):
    """玩家设定 → PlayerCard。"""
    if not req.text.strip():
        raise HTTPException(400, "玩家设定不能为空")
    try:
        player = identify_player(req.text)
        storage.save_library("players", player.name, player.model_dump())
        return player.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/build_card")
def api_build_card(req: BuildCardReq):
    """对话式建卡一轮:返回 {reply, draft(Card V2 data), next_question, done, filled}。

    无状态——前端维护对话与草稿,每轮回传。完成后前端把 draft 包成 CharacterCard 进 CharacterEditor。
    """
    try:
        return build_card(req.kind, req.messages, req.draft, req.seed)
    except Exception as e:
        raise HTTPException(500, f"建卡失败:{e}")


@app.post("/api/identify_auto")
def api_identify_auto(req: AutoReq):
    """统一上传入口:AI 判类型(角色/世界/故事/玩家)→ 路由到对应解析 → 存进对应库。

    返回 {kind, confidence, reason, data}。前端据 kind 放进对应卡槽;判错时可带 kind 重调改判。
    """
    if not req.text.strip():
        raise HTTPException(400, "上传内容不能为空")
    try:
        out = identify_auto(req.text, kind=req.kind)
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")
    kind, data = out["kind"], out["data"]
    try:
        if kind == "character":
            storage.save_library("characters", (data.get("data") or {}).get("name") or "角色", data)
        elif kind == "world":
            storage.save_library("worlds", data.get("name") or "世界书", data)
        elif kind == "story":
            storage.save_library("stories", data.get("title") or "故事书", data)
        elif kind == "player":
            storage.save_library("players", data.get("name") or "玩家", data)
    except Exception:
        pass  # 入库失败不影响返回识别结果
    return out


@app.post("/api/upload")
async def api_upload(request: Request, filename: str = "upload.txt"):
    """上传 .txt/.md/.docx,返回纯文本(前端再填进设定框走识别)。"""
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "空文件")
    try:
        text = extract_text_from_file(filename, raw)
    except Exception as e:
        raise HTTPException(500, f"读取失败:{e}")
    return {"text": text}


@app.post("/api/chat")
def api_chat(req: ChatReq):
    """与角色对话。历史由后端按 session_id 维护,前端只传当轮输入。"""
    if not req.user.strip():
        raise HTTPException(400, "消息不能为空")
    try:
        text = reply(req.card, req.session_id, req.user, req.world)
    except Exception as e:
        raise HTTPException(500, f"对话失败:{e}")
    return {"reply": text}


def _fallback_turn_dict(req: StoryTurnReq, e: Exception) -> dict:
    """story_turn 自身抛异常时的端点级保底回合(题材中性,留在故事内)。"""
    first = req.characters[0]
    name = first.data.name or "旁白"
    cid = first.data.character_id or name
    action = req.user.strip() or req.selected_choice.strip() or "观察当前局势"
    return {
        "narration": "故事引擎遇到了未预料的问题,已保留当前输入并切换为保底回合。你可以继续操作,不用重开。",
        "messages": [{
            "character_id": cid,
            "name": name,
            "text": f"她短暂停顿,把话题拉回现场:「刚才这一步先记下。我们从你说的“{action[:80]}”继续。」",
        }],
        "choices": [
            {"id": "retry_scene", "label": "重新整理当前场景", "intent": "observe", "description": "降低跑偏"},
            {"id": "clarify_action", "label": "换一种说法继续行动", "intent": "custom", "description": "保留自由输入"},
            {"id": "ask_character", "label": "让角色确认已知信息", "intent": "ask", "description": "补足事实边界"},
        ],
        "state_update": {},
        "memory_write": [{"kind": "note", "text": f"保底回合:{e}", "importance": 2}],
        "triggered_events": [],
        "state": RuntimeState().model_dump(),
        "usage": {},
        "reasoning": {},
    }


@app.post("/api/story_turn")
async def api_story_turn(req: StoryTurnReq):
    """v2 故事回合(异步):多角色 + 世界书 + 故事书 + 玩家卡 + 状态/选项/记忆。非流式,作降级路径。"""
    if not req.characters:
        raise HTTPException(400, "至少需要一个角色卡")
    try:
        out = await story_turn(
            session_id=req.session_id,
            characters=req.characters[:3],
            user=req.user,
            selected_choice=req.selected_choice,
            world=req.world,
            story=req.story,
            player=req.player,
            mode=req.mode,
        )
    except Exception as e:
        return _fallback_turn_dict(req, e)
    return out.model_dump()


@app.post("/api/story_turn_stream")
async def api_story_turn_stream(req: StoryTurnReq):
    """流式故事回合(SSE)。主回合叙事逐字推给前端(delta 事件),回合算完再推完整结构体(done 事件)。

    协议:每行 `data: {json}\\n\\n`。事件 type:
    - delta:{"type":"delta","text":"..."} 主回合 LLM 的原始 JSON token 块,前端从累积串里实时抽 narration 先显示。
    - done :{"type":"done","turn":{...完整 StoryTurn...}} 服务端解析/落库后的权威结果(messages/choices/state/usage)。
    - error:{"type":"error","turn":{...保底...}} story_turn 抛异常时的端点级保底。
    """
    if not req.characters:
        raise HTTPException(400, "至少需要一个角色卡")

    async def event_stream():
        q: asyncio.Queue = asyncio.Queue()

        async def on_delta(text: str):
            await q.put({"type": "delta", "text": text})

        async def runner():
            try:
                out = await story_turn(
                    session_id=req.session_id,
                    characters=req.characters[:3],
                    user=req.user,
                    selected_choice=req.selected_choice,
                    world=req.world,
                    story=req.story,
                    player=req.player,
                    mode=req.mode,
                    on_delta=on_delta,
                )
                await q.put({"type": "done", "turn": out.model_dump()})
            except Exception as e:
                await q.put({"type": "error", "turn": _fallback_turn_dict(req, e)})
            finally:
                await q.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/reroll")
async def api_reroll(req: ReRollReq):
    """对上一回合不满意时重新生成:回滚上一轮副作用(恢复 pre-turn 快照),用相同输入重跑。

    卡组取自当前已落盘的 artifacts(即上一轮实际用的卡),输入/模式取自 _reroll 记录。
    """
    data = storage.load_session(req.session_id)
    reroll = data.get("_reroll")
    if not isinstance(reroll, dict) or not isinstance(reroll.get("snapshot"), dict):
        raise HTTPException(400, "当前没有可重新生成的回合")
    art = data.get("artifacts") or reroll["snapshot"].get("artifacts") or {}
    raw_chars = art.get("characters") or []
    if not raw_chars:
        raise HTTPException(400, "缺少角色卡快照,无法重新生成")
    try:
        characters = [CharacterCard(**c) for c in raw_chars][:3]
        world = WorldBook(**art["world"]) if art.get("world") else None
        story = StoryBook(**art["story"]) if art.get("story") else None
        player = PlayerCard(**art["player"]) if art.get("player") else None
    except Exception as e:
        raise HTTPException(500, f"卡组快照解析失败:{e}")
    mode = reroll.get("mode") or art.get("mode") or "standard"
    # 回滚:把会话恢复到上一轮之前的镜像,丢弃刚生成的那一轮(含其 messages/state/累计用量)。
    storage.save_session(req.session_id, reroll["snapshot"])
    try:
        out = await story_turn(
            session_id=req.session_id,
            characters=characters,
            user=reroll.get("user", ""),
            selected_choice=reroll.get("choice", ""),
            world=world,
            story=story,
            player=player,
            mode=mode,
        )
    except Exception as e:
        raise HTTPException(500, f"重新生成失败:{e}")
    return out.model_dump()


@app.get("/api/session/{session_id}")
def api_session(session_id: str):
    """查看持久化会话:调试/状态面板/续玩还原用。剔除内部重 roll 快照,避免把 ~2x 体量的镜像发给前端。"""
    data = storage.load_session(session_id)
    data.pop("_reroll", None)
    return data


@app.delete("/api/session/{session_id}")
def api_delete_session(session_id: str):
    """删除一局存档(存档列表的删除)。只删会话文件;深度模式向量数据留作孤儿(无害、标准模式没有)。"""
    path = storage.session_path(session_id)
    existed = path.exists()
    if existed:
        path.unlink()
    return {"deleted": existed}


_LIB_KINDS = {"characters", "worlds", "stories", "players"}


@app.get("/api/library/{kind}")
def api_library(kind: str):
    """列出卡库里已保存的角色/世界/故事/玩家卡 JSON。"""
    if kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    return storage.list_library(kind)


class LibSaveReq(BaseModel):
    kind: str
    data: dict


@app.post("/api/library/save")
def api_library_save(req: LibSaveReq):
    """把一张卡存进卡库(建好/编辑过的卡完成时自动入库;上传识别的卡已在识别端点入库)。"""
    if req.kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    d = req.data or {}
    if req.kind == "characters":
        name = (d.get("data") or {}).get("name") or "角色"
    elif req.kind == "worlds":
        name = d.get("name") or "世界书"
    elif req.kind == "stories":
        name = d.get("title") or "故事书"
    else:
        name = d.get("name") or "玩家"
    try:
        storage.save_library(req.kind, name, d)
    except Exception as e:
        raise HTTPException(500, f"入库失败:{e}")
    return {"saved": True, "name": storage.slug(name)}


@app.delete("/api/library/{kind}/{name}")
def api_delete_library(kind: str, name: str):
    """从卡库删除一张卡(name 取自 list 返回的 stem)。"""
    if kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    return {"deleted": storage.delete_library(kind, name)}


class PresetReq(BaseModel):
    name: str
    characters: list[dict] = []
    world: dict | None = None
    story: dict | None = None
    player: dict | None = None
    mode: str = "standard"
    cover: str = ""          # 封面图:图片 URL 或自包含 data-URI;空则前端按故事名生成渐变星空封面
    synopsis: str = ""       # 简介
    author: str = ""         # 作者
    tags: list[str] = []     # 分类标签


@app.get("/api/presets")
def api_list_presets():
    """列出已保存的故事预设(配好的卡组,主界面复用开新局)。"""
    return storage.list_presets()


@app.post("/api/presets")
def api_save_preset(req: PresetReq):
    if not req.name.strip():
        raise HTTPException(400, "预设名不能为空")
    if not req.characters:
        raise HTTPException(400, "故事预设至少要一个角色卡")
    storage.save_preset(req.name, req.model_dump())
    return {"saved": True, "name": storage.slug(req.name)}


@app.delete("/api/presets/{name}")
def api_delete_preset(name: str):
    return {"deleted": storage.delete_preset(name)}


# 前端静态文件挂在根路径(html=True 让 / 返回 index.html)
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
