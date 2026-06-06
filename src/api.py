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
    sticky: bool = False  # False=一次性(下回合送达后清);True=持续到手动 DELETE 清


@app.post("/api/operator/inject")
def api_operator_inject(req: OperatorInjectReq, x_operator_token: str | None = Header(None)):
    """后台发一条内容 → 进该局注入队列,下一回合放进 AI 上下文。sticky=True 则持续到清空。需 X-Operator-Token。"""
    _require_operator(x_operator_token)
    if not req.content.strip():
        raise HTTPException(400, "内容不能为空")
    data = storage.load_session(req.session_id)
    inj = list(data.get("operator_inject") or [])
    inj.append({"content": req.content.strip(), "sticky": bool(req.sticky)})
    data["operator_inject"] = inj[-50:]
    storage.save_session(req.session_id, data)
    return {"ok": True, "pending": len(data["operator_inject"]), "sticky": bool(req.sticky)}


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


# 私人后台控制台:不从玩家前端链接过去;真正的闸是 token(页面只是表单,无 token 调不动接口)。
# OPERATOR_TOKEN 没设则 404(功能关闭)。token 存浏览器 localStorage,同源 fetch 免 CORS。
_OPERATOR_HTML = """<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>后台注入</title>
<style>body{font:15px/1.6 -apple-system,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#222}
h2{margin:0 0 12px}label{display:block;margin:10px 0 4px;font-weight:600;font-size:13px;color:#555}
input,textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:6px;font:inherit}
textarea{min-height:80px}.row{display:flex;gap:8px;align-items:center;margin:10px 0}
.row label{margin:0;font-weight:400}button{padding:9px 16px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font:inherit;margin:4px 6px 4px 0}
button.sec{background:#6b7280}#out{white-space:pre-wrap;background:#f6f7f9;border-radius:6px;padding:10px;margin-top:12px;font-size:13px;min-height:20px}</style>
</head><body>
<h2>后台注入控制台</h2>
<label>OPERATOR_TOKEN(只你知道,存本机浏览器)</label><input id="tok" type="password" placeholder="X-Operator-Token">
<label>局 ID(session_id)</label><input id="sid" placeholder="哪一局">
<label>内容(要让 AI 看到的话)</label><textarea id="msg" placeholder="例:让沈雾突然警觉起来"></textarea>
<div class="row"><input id="sticky" type="checkbox"><label for="sticky">持续生效(sticky:每回合都注入,直到手动清空;不勾=一次性,下回合送达即清)</label></div>
<button onclick="send()">发送</button><button class="sec" onclick="view()">查看队列</button><button class="sec" onclick="clr()">清空</button>
<div id="out"></div>
<script>
const $=id=>document.getElementById(id), out=t=>$("out").textContent=typeof t=="string"?t:JSON.stringify(t,null,2);
["tok","sid"].forEach(k=>{$(k).value=localStorage["op_"+k]||"";$(k).oninput=()=>localStorage["op_"+k]=$(k).value});
const H=()=>({"X-Operator-Token":$("tok").value,"Content-Type":"application/json"});
async function send(){try{const r=await fetch("/api/operator/inject",{method:"POST",headers:H(),body:JSON.stringify({session_id:$("sid").value,content:$("msg").value,sticky:$("sticky").checked})});const j=await r.json();out(r.ok?("已发送 ✓ "+JSON.stringify(j)):("失败 "+r.status+" "+JSON.stringify(j)));if(r.ok)$("msg").value=""}catch(e){out("错误 "+e)}}
async function view(){try{const r=await fetch("/api/operator/inject/"+encodeURIComponent($("sid").value),{headers:H()});out(await r.json())}catch(e){out("错误 "+e)}}
async function clr(){try{const r=await fetch("/api/operator/inject/"+encodeURIComponent($("sid").value),{method:"DELETE",headers:H()});out(r.ok?"已清空 ✓":("失败 "+r.status))}catch(e){out("错误 "+e)}}
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
if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
