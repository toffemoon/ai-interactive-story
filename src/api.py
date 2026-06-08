"""FastAPI 后端 —— serve 前端 + 端点:角色识别 / 世界书识别 / 文件上传 / 对话。

启动:
    uv run uvicorn src.api:app --reload --port 8000
然后浏览器开 http://localhost:8000
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
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
from . import db

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
OC_DIR = ROOT / "oc"  # OC 集:用户 OC 的设定/世界观/立绘/地图(operator 控制台「OC集」用)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动: 建 Postgres 连接池 (DATABASE_URL 见 .env)。关闭: 释放池。
    db.init_pool()
    yield
    db.close_pool()


app = FastAPI(title="AI 互动故事", lifespan=lifespan)


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


@app.get("/api/health")
def api_health():
    """健康检查:确认后端在线 + DB 可达 + 是否带前端 + deep 向量召回依赖是否就绪。
    AI / 调用方可先打这个再调其它接口。"""
    db_ok = True
    try:
        with db.get_pool().connection() as conn, conn.cursor() as cur:
            cur.execute("select 1")
            cur.fetchone()
    except Exception:
        db_ok = False
    # embeddings_installed:部署装没装 sentence-transformers/torch(= deep 向量召回 + Phase 3 在场过滤能不能用);
    #   只查包是否可定位、不加载模型(不触发下载)。embeddings_loaded:bge 是否已加载(首次 deep 触发后才 True)。
    try:
        import importlib.util
        emb_installed = importlib.util.find_spec("sentence_transformers") is not None
    except Exception:
        emb_installed = False
    try:
        from src import memory as _memory
        emb_loaded = _memory.is_ready()
    except Exception:
        emb_loaded = False
    return {"status": "ok", "db": db_ok, "frontend": FRONTEND.is_dir(),
            "embeddings_installed": emb_installed, "embeddings_loaded": emb_loaded,
            "deep_capable": emb_installed,  # True = 完整 Phase 3(向量在场过滤)可用
            "mode": "frontend+api" if FRONTEND.is_dir() else "api-only"}


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
            characters=req.characters,  # 角色卡上限已解除:用全部上传角色(支持群像剧)
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
                    characters=req.characters,  # 角色卡上限已解除:用全部上传角色(支持群像剧)
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
    data = await asyncio.to_thread(storage.load_session, req.session_id)
    reroll = data.get("_reroll")
    if not isinstance(reroll, dict) or not isinstance(reroll.get("snapshot"), dict):
        raise HTTPException(400, "当前没有可重新生成的回合")
    art = data.get("artifacts") or reroll["snapshot"].get("artifacts") or {}
    raw_chars = art.get("characters") or []
    if not raw_chars:
        raise HTTPException(400, "缺少角色卡快照,无法重新生成")
    try:
        characters = [CharacterCard(**c) for c in raw_chars]  # 上限已解除:还原全部角色卡
        world = WorldBook(**art["world"]) if art.get("world") else None
        story = StoryBook(**art["story"]) if art.get("story") else None
        player = PlayerCard(**art["player"]) if art.get("player") else None
    except Exception as e:
        raise HTTPException(500, f"卡组快照解析失败:{e}")
    mode = reroll.get("mode") or art.get("mode") or "standard"
    # 回滚:把会话恢复到上一轮之前的镜像,丢弃刚生成的那一轮(含其 messages/state/累计用量)。
    await asyncio.to_thread(storage.save_session, req.session_id, reroll["snapshot"])
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
    """删除一局存档(存档列表的删除)。删会话 + 级联 messages;深度模式向量数据(memory_vec)留作孤儿(无害)。"""
    return {"deleted": storage.delete_session(session_id)}


@app.get("/api/session/{session_id}/tail")
def api_session_tail(session_id: str, after: int = 0):
    """玩家端实时轮询:返回该局第 after 条之后的新回合 + 当前状态(轻量,只回新回合)。
    用途:运营者「立即生效」或任何 server 端出的新回合,玩家界面自己冒出来(不必刷新)。
    无 token —— 同 /api/session(玩家本来就能读自己这局;session_id 随机难猜)。"""
    d = storage.load_session(session_id)
    turns = d.get("turns") or []
    n = len(turns)
    after = max(0, after)
    new_turns = turns[after:] if after < n else []
    return {"turn_count": n, "new_turns": new_turns, "state": d.get("state")}


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
    playables: list[dict] = []   # 可玩主角候选(预设故事的选人页用;空则前端回退到"自定义")
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


# ── 后台注入(运营者/作者)──────────────────────────────────────────
# 让运营者把内容"发进"某局,引擎下一回合就放进 AI 的上下文(AI 会看到)。
# 没有账号系统 → 用单一运营者密钥 OPERATOR_TOKEN 当闸:env 没设=整组端点关闭(默认安全);
# 设了但请求头 X-Operator-Token 不对=403。玩家拿不到 token、前端也不暴露入口,故只有开发者能发。
def _require_operator(token: str | None) -> None:
    expected = os.getenv("OPERATOR_TOKEN", "")
    if not expected:
        raise HTTPException(503, "后台注入未启用:服务端未设置 OPERATOR_TOKEN")
    if token != expected:
        raise HTTPException(403, "operator token 不对")


class OperatorInjectReq(BaseModel):
    session_id: str
    content: str
    mode: str = "director"  # director=幕后指令AI织进剧情 / direct=指定角色逐字台词(引擎直插) / narration=旁白(引擎直插)
    target: str = ""         # direct 模式:说这句的角色名(空则退化为旁白)
    sticky: bool = False     # 仅 director:每回合都注入,直到手动清空
    now: bool = False        # 仅 director:立即跑一回合,AI 当场采纳(不等玩家)


async def _operator_advance(session_id: str) -> dict:
    """运营者触发:立即用该局存档卡组跑一回合(消费刚入队的注入),AI 当场出内容。
    卡组复用 artifacts(同 reroll);用中性"场景继续"作动作驱动一回合,真正的导演指令在 operator_inject 块里。"""
    data = await asyncio.to_thread(storage.load_session, session_id)
    art = data.get("artifacts") or {}
    raw = art.get("characters") or []
    if not raw:
        raise HTTPException(400, "该局还没有卡组快照(玩家未正式开局?),无法立即推进")
    try:
        characters = [CharacterCard(**c) for c in raw]
        world = WorldBook(**art["world"]) if art.get("world") else None
        story = StoryBook(**art["story"]) if art.get("story") else None
        player = PlayerCard(**art["player"]) if art.get("player") else None
    except Exception as e:
        raise HTTPException(500, f"卡组快照解析失败:{e}")
    out = await story_turn(session_id=session_id, characters=characters, user="（场景继续）",
                           world=world, story=story, player=player, mode=art.get("mode") or "standard")
    return out.model_dump()


@app.post("/api/operator/inject")
async def api_operator_inject(req: OperatorInjectReq, x_operator_token: str | None = Header(None)):
    """后台对某局施加影响,三种模式(需 X-Operator-Token):
    - director(默认):幕后指令进队列,AI 下回合织进剧情;sticky=持续每回合,now=立即跑一回合。
    - direct:指定 target 角色【逐字】说出 content —— 引擎直插一条回合,不走 AI、即时、保证原样。
    - narration:把 content 作为旁白【逐字】写进剧情 —— 引擎直插,不走 AI、即时。
    direct/narration 即时落地(不看 sticky/now);两路都写 operator_applied 留痕。"""
    _require_operator(x_operator_token)
    content = req.content.strip()
    if not content:
        raise HTTPException(400, "内容不能为空")
    data = await asyncio.to_thread(storage.load_session, req.session_id)
    mode = req.mode if req.mode in ("director", "direct", "narration") else "director"

    if mode in ("direct", "narration"):
        # 引擎直插一条回合:逐字、即时、零 LLM。direct 且给了角色 → 当台词;否则 → 当旁白。
        as_line = mode == "direct" and bool(req.target.strip())
        applied_mode = "direct" if as_line else "narration"
        turn_rec = {
            "player_input": "",
            "narration": "" if as_line else content,
            "messages": ([{"character_id": storage.slug(req.target, "char"),
                           "name": req.target.strip(), "text": content}] if as_line else []),
            "choices": [], "triggered_events": [], "reasoning": {}, "usage": {},
            "operator_applied": [{"mode": applied_mode, "target": req.target.strip(), "content": content}],
        }
        turns = data.setdefault("turns", [])
        turns.append(turn_rec)
        data["turns"] = turns[-300:]
        await asyncio.to_thread(storage.save_session, req.session_id, data)
        return {"ok": True, "mode": applied_mode, "inserted": True, "turn": turn_rec}

    # director:进队列(sticky 决定是否持续);now=true 立即跑一回合
    inj = list(data.get("operator_inject") or [])
    inj.append({"content": content, "mode": "director", "sticky": bool(req.sticky)})
    data["operator_inject"] = inj[-50:]
    await asyncio.to_thread(storage.save_session, req.session_id, data)
    res = {"ok": True, "mode": "director", "pending": len(data["operator_inject"]), "sticky": bool(req.sticky)}
    if req.now:
        res["turn"] = await _operator_advance(req.session_id)
    return res


@app.get("/api/operator/inject/{session_id}")
def api_operator_inject_list(session_id: str, x_operator_token: str | None = Header(None)):
    """看某局当前待注入(还没被消费)的内容。需 X-Operator-Token。"""
    _require_operator(x_operator_token)
    return {"operator_inject": storage.load_session(session_id).get("operator_inject") or []}


@app.delete("/api/operator/inject/{session_id}")
def api_operator_inject_clear(session_id: str, x_operator_token: str | None = Header(None)):
    """清空某局的待注入队列(once + sticky 全清)。需 X-Operator-Token。"""
    _require_operator(x_operator_token)
    data = storage.load_session(session_id)
    data["operator_inject"] = []
    storage.save_session(session_id, data)
    return {"ok": True}


@app.get("/api/operator/sessions")
def api_operator_sessions(x_operator_token: str | None = Header(None)):
    """列出所有 session(控制台左栏点选用)。需 X-Operator-Token。"""
    _require_operator(x_operator_token)
    return {"sessions": storage.list_sessions()}


@app.get("/api/operator/session/{session_id}")
def api_operator_session(session_id: str, x_operator_token: str | None = Header(None)):
    """看某局完整上下文:回合记录(玩家输入 + 叙事 + 角色发言)+ 当前状态 + 注入队列。需 X-Operator-Token。"""
    _require_operator(x_operator_token)
    d = storage.load_session(session_id)
    return {
        "session_id": session_id,
        "turns": d.get("turns") or [],
        "state": d.get("state"),
        "operator_inject": d.get("operator_inject") or [],
        "artifacts_mode": (d.get("artifacts") or {}).get("mode"),
    }


@app.get("/api/operator/oc")
def api_operator_oc(x_operator_token: str | None = Header(None)):
    """OC 集:列出各用户的 OC(角色设定 + 世界观 + 立绘 + 地图)。需 X-Operator-Token。
    数据读 oc/index.json + 它引用的 .md;图走 /oc-assets 静态路由(<img> 直接取)。"""
    _require_operator(x_operator_token)
    idx = OC_DIR / "index.json"
    if not idx.is_file():
        return {"ocs": []}
    try:
        entries = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return {"ocs": []}

    def _read(rel: str) -> str:
        p = (OC_DIR / rel) if rel else None
        return p.read_text(encoding="utf-8") if (p and p.is_file()) else ""

    def _asset(rel: str) -> str:
        return ("/oc-assets/" + rel) if rel and (OC_DIR / rel).is_file() else ""

    ocs = [{
        "user": e.get("user", ""),
        "character": e.get("character", ""),
        "profile": _read(e.get("profile", "")),
        "world": _read(e.get("world", "")),
        "art": _asset(e.get("art", "")),
        "map": _asset(e.get("map", "")),
    } for e in entries]
    return {"ocs": ocs}


# 私人后台控制台:不从玩家前端链接过去;真正的闸是 token(页面只是表单,无 token 调不动接口)。
# OPERATOR_TOKEN 没设则 404(功能关闭)。token 存浏览器 localStorage,同源 fetch 免 CORS。
_OPERATOR_HTML = r"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>后台控制台</title>
<style>*{box-sizing:border-box}body{font:14px/1.55 -apple-system,system-ui,sans-serif;margin:0;color:#1f2328;background:#fff}
header{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}
header h1{font-size:15px;margin:0 10px 0 0}
header input{padding:6px 8px;border:1px solid #ccc;border-radius:6px;font:inherit}
button{padding:6px 12px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font:inherit}
button.sec{background:#6b7280}#st{font-size:12px;color:#888;margin-left:auto}
#wrap{display:flex;height:calc(100vh - 53px)}
#list{width:240px;border-right:1px solid #e5e7eb;overflow:auto}
.sess{padding:9px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer}
.sess:hover{background:#f6f7f9}.sess.on{background:#e8f0fe}
.sess .id{font-weight:600}.sess .meta{color:#999;font-size:12px}.sess .sid{color:#bbb;font-size:11px;word-break:break-all;margin-top:2px}
#detail{flex:1;display:flex;flex-direction:column;min-width:0}
#shdr{padding:8px 14px;border-bottom:1px solid #eee;color:#555;font-size:13px}
#conv{flex:1;overflow:auto;padding:14px;background:#fafafa}
.b{max-width:80%;margin:6px 0;padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word}
.b.player{background:#2563eb;color:#fff;margin-left:auto}.b.char{background:#fff;border:1px solid #e5e7eb}
.narr{color:#666;font-style:italic;margin:8px 4px;font-size:13px}
.oplabel{font-size:11px;color:#7c3aed;background:#f3effe;border-radius:4px;padding:2px 7px;margin:7px 0;display:inline-block}
#box select,#box #target{padding:5px 7px;border:1px solid #ccc;border-radius:6px;font:inherit}
#box{border-top:1px solid #e5e7eb;padding:10px 14px}
#box textarea{width:100%;min-height:52px;padding:8px;border:1px solid #ccc;border-radius:6px;font:inherit}
#queue{font-size:12px;color:#a15;margin-bottom:4px}
.tab{background:#eef1f5;color:#333}.tab.on{background:#2563eb;color:#fff}
#ocwrap{display:none;height:calc(100vh - 53px)}
#oclist{width:230px;border-right:1px solid #e5e7eb;overflow:auto}
#ocdetail{flex:1;overflow:auto;padding:16px 26px;min-width:0}
#ocdetail h3{margin:20px 0 8px;font-size:15px;color:#b1442f;border-bottom:2px solid #f0c9bf;padding-bottom:4px}
#ocdetail h4{margin:14px 0 5px;font-size:14px}#ocdetail h5{margin:11px 0 4px;font-size:13px;color:#555}
#ocdetail p{margin:5px 0}#ocdetail ul{margin:5px 0;padding-left:20px}#ocdetail li{margin:2px 0}
#ocdetail blockquote{margin:8px 0;padding:6px 10px;background:#f7f8fa;border-left:3px solid #cbd2d9;color:#555;font-size:13px}
#ocdetail code{background:#f0f0f0;padding:1px 5px;border-radius:4px;font-size:12px}
.trow{display:flex;gap:10px;padding:3px 0;border-bottom:1px solid #f3f3f3}.trow span:first-child{min-width:96px;color:#666;font-weight:600}
.ocimg{max-width:360px;width:100%;border-radius:10px;border:1px solid #eee;display:block;margin:4px 0 16px}
.ocsec{max-width:780px}</style>
</head><body>
<header><h1>后台控制台</h1>
<button id="tabSess" class="tab on" onclick="showView('sessions')">🎭 对局</button>
<button id="tabOC" class="tab" onclick="showView('oc')">🍎 OC集</button>
<input id="tok" type="password" placeholder="OPERATOR_TOKEN" size="22">
<button class="sec" onclick="loadSessions()">刷新列表</button><span id="st"></span></header>
<div id="wrap">
 <div id="list"></div>
 <div id="detail">
  <div id="shdr">← 左边点一个 session 看上下文</div>
  <div id="conv"></div>
  <div id="box">
   <div id="queue"></div>
   <textarea id="msg" placeholder="导演=写指令(让X警觉…) / 直接台词=写那句话 / 旁白=写环境描写"></textarea>
   <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <select id="mode" onchange="onMode()">
     <option value="director">🎬 导演(AI 织进剧情)</option>
     <option value="direct">🎤 直接台词(角色逐字说)</option>
     <option value="narration">🌧 旁白(逐字写进剧情)</option>
    </select>
    <input id="target" type="text" placeholder="角色名" style="display:none;width:110px">
    <label id="stickyL" style="font-size:13px"><input id="sticky" type="checkbox"> 持续</label>
    <button id="bNext" onclick="send('next')">发送(下回合)</button>
    <button id="bNow" onclick="send('now')">⚡ 立即</button>
    <button class="sec" onclick="clearQ()">清空队列</button>
   </div>
  </div>
 </div>
</div>
<div id="ocwrap">
 <div id="oclist"></div>
 <div id="ocdetail"></div>
</div>
<script>
const $=id=>document.getElementById(id);
$("tok").value=localStorage.op_tok||""; $("tok").oninput=()=>{localStorage.op_tok=$("tok").value;loadSessions();};
const H=()=>({"X-Operator-Token":$("tok").value,"Content-Type":"application/json"});
const st=t=>$("st").textContent=t;
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function bub(role,name,text){const d=el("div","b "+role);if(name)d.appendChild(el("b",null,name+": "));d.appendChild(document.createTextNode(text));return d;}
let cur=null;
async function j(url,opt){const r=await fetch(url,opt||{headers:H()});if(!r.ok){st("✗ "+r.status+(r.status==503?" 未启用(没设OPERATOR_TOKEN)":r.status==403?" token不对":""));throw r;}st("");return r.json();}
async function loadSessions(){try{const d=await j("/api/operator/sessions");const L=$("list");L.innerHTML="";(d.sessions||[]).forEach(s=>{const it=el("div","sess"+(s.id===cur?" on":""));it.dataset.sid=s.id;it.appendChild(el("div","id",(s.story||"(未命名故事)")+(s.player?" · 玩"+s.player:"")));it.appendChild(el("div","meta",(s.turns||0)+"轮 · "+String(s.updated_at||"").slice(0,16).replace("T"," ")));if(s.last_input)it.appendChild(el("div","meta","最后:"+s.last_input));it.appendChild(el("div","sid",s.id));it.onclick=()=>select(s.id);L.appendChild(it);});if(!(d.sessions||[]).length)L.appendChild(el("div","meta","(没有 session)"));}catch(e){}}
function select(id){cur=id;document.querySelectorAll(".sess").forEach(n=>n.classList.toggle("on",n.dataset.sid===id));loadSession();}
async function loadSession(silent){if(!cur)return;try{const d=await j("/api/operator/session/"+encodeURIComponent(cur));const C=$("conv");const atBottom=C.scrollHeight-C.scrollTop-C.clientHeight<60;C.innerHTML="";(d.turns||[]).forEach(t=>{(t.operator_applied||[]).forEach(a=>{const tag=a.mode==="direct"?("🎤 直接台词"+(a.target?"("+a.target+")":"")):(a.mode==="narration"?"🌧 旁白":"🎬 导演");C.appendChild(el("div","oplabel",tag+":"+(a.content||"")));});if(t.player_input)C.appendChild(bub("player","",t.player_input));if(t.narration)C.appendChild(el("div","narr",t.narration));(t.messages||[]).forEach(m=>C.appendChild(bub("char",m.name||m.character_id||"",m.text||"")));});const s=d.state||{},sc=s.scene||{};$("shdr").textContent=cur+"  ·  地点:"+(sc.location||"?")+"  ·  在场:"+((sc.present_characters||[]).join("、")||"?")+"  ·  第"+(s.turn_count||0)+"回合";const q=d.operator_inject||[];$("queue").textContent=q.length?("待注入 "+q.length+" 条:"+q.map(x=>(typeof x=="object"?x.content+(x.sticky?"[持续]":"[一次]"):x)).join(" / ")):"";if(!silent||atBottom)C.scrollTop=C.scrollHeight;}catch(e){}}
function onMode(){const m=$("mode").value;$("target").style.display=m==="direct"?"":"none";$("stickyL").style.display=m==="director"?"":"none";$("bNext").style.display=m==="director"?"":"none";$("bNow").textContent=m==="director"?"⚡ 立即":"发送";}
async function send(timing){if(!cur){st("先选一个 session");return;}const m=$("msg").value.trim();if(!m)return;const mode=$("mode").value;const now=(timing==="now"&&mode==="director");if(mode==="direct"&&!$("target").value.trim()){st("直接台词要填角色名(留空=旁白)");}try{st(now?"AI 生成中…":(mode!=="director"?"插入中…":""));await j("/api/operator/inject",{method:"POST",headers:H(),body:JSON.stringify({session_id:cur,content:m,mode,target:$("target").value.trim(),sticky:$("sticky").checked,now})});$("msg").value="";st("已发送 ✓");loadSession();}catch(e){}}
async function clearQ(){if(!cur)return;try{await j("/api/operator/inject/"+encodeURIComponent(cur),{method:"DELETE",headers:H()});st("已清空 ✓");loadSession();}catch(e){}}
let ocs=[],ocLoaded=false;
function showView(v){$("wrap").style.display=v==="oc"?"none":"flex";$("ocwrap").style.display=v==="oc"?"flex":"none";$("tabSess").classList.toggle("on",v!=="oc");$("tabOC").classList.toggle("on",v==="oc");if(v==="oc"&&!ocLoaded){ocLoaded=true;loadOC();}}
function mdToHtml(t){t=(t||"").replace(/^---\n[\s\S]*?\n---\n/,"").replace(/!\[\[.*?\]\]/g,"").replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g,"$1");const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;");const inl=s=>esc(s).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,"<code>$1</code>");let h="",ul=false;const cu=()=>{if(ul){h+="</ul>";ul=false;}};for(const line of t.split("\n")){if(!line.trim()){cu();continue;}let m;if(m=line.match(/^(#{1,6})\s+(.*)$/)){cu();const lv=Math.min(m[1].length+1,6);h+="<h"+lv+">"+inl(m[2])+"</h"+lv+">";}else if(m=line.match(/^\s*>\s?(.*)$/)){cu();h+="<blockquote>"+inl(m[1])+"</blockquote>";}else if(m=line.match(/^\s*[-*]\s+(.*)$/)){if(!ul){h+="<ul>";ul=true;}h+="<li>"+inl(m[1])+"</li>";}else if(/^\s*\|/.test(line)){cu();const c=line.replace(/^\s*\|/,"").replace(/\|\s*$/,"").split("|").map(x=>x.trim());if(c.every(x=>/^[-:\s]*$/.test(x)))continue;h+="<div class=trow>"+c.map(x=>"<span>"+inl(x)+"</span>").join("")+"</div>";}else{cu();h+="<p>"+inl(line)+"</p>";}}cu();return h;}
async function loadOC(){try{const d=await j("/api/operator/oc");ocs=d.ocs||[];const L=$("oclist");L.innerHTML="";ocs.forEach((o,i)=>{const it=el("div","sess");it.appendChild(el("div","id","🍎 "+(o.character||"OC")));it.appendChild(el("div","meta","用户:"+(o.user||"?")));it.onclick=()=>showOC(i);L.appendChild(it);});if(ocs.length)showOC(0);else $("ocdetail").innerHTML="<p style=color:#999>(oc/index.json 里没有 OC)</p>";}catch(e){}}
function showOC(i){const o=ocs[i];if(!o)return;document.querySelectorAll("#oclist .sess").forEach((n,k)=>n.classList.toggle("on",k===i));let h="<div class=ocsec><h3>🍎 "+o.character+"　·　用户 "+o.user+"</h3>";if(o.art)h+="<img class=ocimg src='"+o.art+"' alt=立绘>";h+=mdToHtml(o.profile)+"</div><div class=ocsec><h3>🗺 世界观</h3>";if(o.map)h+="<img class=ocimg src='"+o.map+"' alt=地图>";h+=mdToHtml(o.world)+"</div>";$("ocdetail").innerHTML=h;$("ocdetail").scrollTop=0;}
onMode();
loadSessions();
setInterval(()=>{if(cur)loadSession(true);},4000);
</script></body></html>"""


@app.get("/operator", response_class=HTMLResponse)
def operator_console():
    """私人后台注入控制台。OPERATOR_TOKEN 没设 → 404(功能关闭)。页面不做鉴权,真正的闸是各 /api/operator/* 端点的 token。"""
    if not os.getenv("OPERATOR_TOKEN"):
        raise HTTPException(404, "未启用")
    return HTMLResponse(_OPERATOR_HTML)


# 前端静态文件挂在根路径(html=True 让 / 返回 index.html)。
# 前端目录存在 → 同时服务前端 + /api/* 接口(给人玩);目录不存在 → 退化为纯后端
# (只剩 /api/* + /docs + /openapi.json,给 AI / 调用方按 schema 直接调),且不会启动崩溃。
# 这样"既保留前端、又能纯后端被 AI 直接调用"在同一份代码里共存。
if OC_DIR.is_dir():  # OC 集图片(立绘/地图)走静态;须在 "/" catch-all 之前挂
    app.mount("/oc-assets", StaticFiles(directory=str(OC_DIR)), name="oc-assets")

if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
