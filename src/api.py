"""FastAPI 后端 —— serve 前端 + 端点:角色识别 / 世界书识别 / 文件上传 / 对话。

启动:
    uv run uvicorn src.api:app --reload --port 8000
然后浏览器开 http://localhost:8000
"""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
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
from .parsers import parse_character
from .story import story_turn
from . import storage
from . import db
from . import costguard
from . import auth

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


# ── 账户系统(AUTH_ENABLED 门控;关时全程不影响现有行为)──────────────────
async def current_user_dep(authorization: str | None = Header(None),
                           x_auth_token: str | None = Header(None)) -> dict | None:
    """取当前用户(可选):无 token→None;有但无效→401。给端点 Depends 用。"""
    return await asyncio.to_thread(auth.current_user, authorization, x_auth_token)


def _write_owner(user: dict | None) -> str | None:
    """写操作的归属:AUTH 关→None(旧全局);AUTH 开→必须登录,返回 user_id。"""
    if not auth.enabled():
        return None
    if user is None:
        raise HTTPException(401, "请先登录")
    return user["id"]


def _read_scope(user: dict | None) -> tuple[str | None, bool]:
    """读操作的范围:返回 (user_id, legacy_all)。AUTH 关→legacy_all=True(旧全局)。"""
    if not auth.enabled():
        return None, True
    return (user["id"] if user else None), False


def _write_scope(user: dict | None) -> tuple[str | None, bool]:
    """写/删操作的范围:AUTH 关→(None, legacy_all=True);开→必须登录,返回 (user_id, False)。"""
    if not auth.enabled():
        return None, True
    if user is None:
        raise HTTPException(401, "请先登录")
    return user["id"], False


def require_role(min_role: str):
    """角色门:返回一个 FastAPI 依赖,要求调用者 role >= min_role。
    认证 = 登录 token 的角色;OPERATOR_TOKEN 作 superadmin 应急后门(AUTH 关时仍可用,沿用旧控制台)。"""
    async def dep(authorization: str | None = Header(None),
                  x_auth_token: str | None = Header(None),
                  x_operator_token: str | None = Header(None)) -> dict:
        op = os.getenv("OPERATOR_TOKEN", "")
        if op and x_operator_token == op:           # 应急后门 = superadmin
            return {"id": None, "username": "(operator)", "email": None,
                    "role": "superadmin", "is_admin": True}
        user = await asyncio.to_thread(auth.current_user, authorization, x_auth_token)
        if user is None:
            raise HTTPException(401, "请先登录")
        if not auth.role_at_least(user.get("role", "user"), min_role):
            raise HTTPException(403, f"需要 {min_role} 权限")
        return user
    return dep


class SendCodeReq(BaseModel):
    email: str


class RegisterReq(BaseModel):
    email: str
    password: str
    code: str                       # 邮箱验证码
    username: str | None = None     # 可选登录名
    display_name: str | None = None


class LoginReq(BaseModel):
    identifier: str   # 邮箱或用户名
    password: str


class SetRoleReq(BaseModel):
    user: str         # 用户名 / 邮箱 / user_id
    role: str         # admin | user


@app.post("/api/auth/email/send_code")
def api_send_code(req: SendCodeReq):
    """给邮箱发注册验证码。SMTP 未配置(本地)时返回里带 dev_code 方便测试。"""
    return auth.send_email_code(req.email, purpose="register")


@app.post("/api/auth/register")
def api_register(req: RegisterReq):
    """注册:邮箱 + 验证码 + 密码(可选用户名)。验证码对 → 建号(邮箱已验证)→ 返回 token + user。"""
    if not auth.verify_email_code(req.email, req.code, purpose="register"):
        raise HTTPException(400, "验证码不对或已过期")
    user = auth.create_user(req.email, req.password, req.username, req.display_name, email_verified=True)
    token = auth.issue_token(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/login")
def api_login(req: LoginReq):
    """登录(邮箱/用户名 + 密码),返回 token + user。"""
    user = auth.authenticate(req.identifier, req.password)
    if not user:
        raise HTTPException(401, "邮箱/用户名或密码错误")
    token = auth.issue_token(user["id"])
    return {"token": token, "user": user}


@app.post("/api/admin/set_role")
def api_set_role(req: SetRoleReq, actor: dict = Depends(require_role("superadmin"))):
    """superadmin 把某用户设成 admin / user。需 superadmin。"""
    if not auth.set_user_role(req.user, req.role):
        raise HTTPException(404, f"找不到用户:{req.user}")
    return {"ok": True, "user": req.user, "role": req.role}


@app.post("/api/auth/logout")
def api_logout(authorization: str | None = Header(None), x_auth_token: str | None = Header(None)):
    """登出:吊销当前 token。"""
    tok = auth._extract(authorization, x_auth_token)
    if tok:
        auth.revoke_token(tok)
    return {"ok": True}


@app.get("/api/auth/me")
def api_me(user: dict | None = Depends(current_user_dep)):
    """当前登录用户(未登录返回 {user:null})。"""
    return {"user": user, "auth_enabled": auth.enabled()}


@app.get("/api/my/sessions")
def api_my_sessions(user: dict | None = Depends(current_user_dep)):
    """「我的存档」:列出当前用户的会话(跨设备可见)。需登录。"""
    if user is None:
        raise HTTPException(401, "请先登录")
    return storage.list_sessions(user_id=user["id"])


class DisplayNameReq(BaseModel):
    display_name: str


@app.post("/api/my/display_name")
def api_my_display_name(req: DisplayNameReq, user: dict | None = Depends(current_user_dep)):
    """设置昵称(登录后无昵称时前端强制走这里;之后也可改)。1-24 字,去首尾空白。"""
    if user is None:
        raise HTTPException(401, "请先登录")
    nm = (req.display_name or "").strip()
    if not nm or len(nm) > 24:
        raise HTTPException(400, "昵称需为 1-24 个字符")
    pool = auth.get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update users set display_name = %s where id = %s::uuid", (nm, user["id"]))
    return {"ok": True, "display_name": nm}


class AvatarReq(BaseModel):
    avatar: str


@app.post("/api/my/avatar")
def api_my_avatar(req: AvatarReq, user: dict | None = Depends(current_user_dep)):
    """上传/更换头像。前端已做居中裁方+缩放(256×256 JPEG);服务端只收 data URI 并设上限,
    防绕过前端直接塞大图。存 users.avatar(DB 持久;Render 磁盘易失不可存盘)。"""
    if user is None:
        raise HTTPException(401, "请先登录")
    a = (req.avatar or "").strip()
    allowed = ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")
    if not a.startswith(allowed):
        raise HTTPException(400, "头像格式不支持(仅 jpeg/png/webp 的 data URI)")
    if len(a) > 200_000:   # 256² JPEG 一般 ~20KB;200KB 已是宽限,超出说明绕过了前端压缩
        raise HTTPException(400, "头像过大,请重新选择(会自动压缩到 256×256)")
    pool = auth.get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update users set avatar = %s where id = %s::uuid", (a, user["id"]))
    return {"ok": True, "avatar": a}


@app.get("/api/my/oc")
def api_my_oc(user: dict | None = Depends(current_user_dep)):
    """当前用户可聊的 OC(聊天页「OC」栏数据源;卡主导的一对一对话走 /api/chat)。
    AUTH 关 = 全部可见(本地开发);开 = 按 oc/index.json 的 user 字段匹配,admin/superadmin 看全部。
    返回含引擎卡数据(card.md 解析后的 CharacterCard);没有卡的 OC 标 card=None(只读资料,不可聊)。"""
    idx = OC_DIR / "index.json"
    if not idx.is_file():
        return {"ocs": []}
    try:
        entries = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return {"ocs": []}

    def _asset(rel: str) -> str:
        return ("/oc-assets/" + rel) if rel and (OC_DIR / rel).is_file() else ""

    def _mine(e: dict) -> bool:
        if not auth.enabled():
            return True                      # AUTH 关(本地开发):全部可见
        if user is None:
            return False                     # AUTH 开 + 未登录(游客):私人 OC 一律不可见
        if user.get("is_admin") or user.get("role") in ("admin", "superadmin"):
            return True
        who = {str(user.get("username") or ""), str(user.get("email") or ""), str(user.get("display_name") or "")}
        who.discard("")
        owners = e.get("user", "")
        owners = owners if isinstance(owners, list) else [owners]   # 支持单人(str)或多人(list)
        return any(str(o) in who for o in owners)

    out = []
    for e in entries:
        if not _mine(e):
            continue
        card = None
        card_path = (OC_DIR / e["card"]) if e.get("card") else None
        if card_path and card_path.is_file():
            try:
                card = parse_character(card_path.read_text(encoding="utf-8")).model_dump()
            except Exception:
                card = None
        # 简介优先用引擎卡的 description(真人设);没有卡再退 profile.md 第一行正文。
        persona = ""
        if card and isinstance(card.get("data"), dict):
            persona = str(card["data"].get("description") or card["data"].get("personality") or "")[:60]
        if not persona:
            prof_path = (OC_DIR / e["profile"]) if e.get("profile") else None
            if prof_path and prof_path.is_file():
                txt = prof_path.read_text(encoding="utf-8")
                if txt.startswith("---"):
                    end = txt.find("\n---", 3)
                    if end > 0:
                        txt = txt[end + 4:]
                lines = [ln.strip() for ln in txt.splitlines()
                         if ln.strip() and not ln.strip().startswith(("#", "!", "[[", "*"))]
                persona = (lines[0] if lines else "")[:60]
        out.append({"user": e.get("user", ""), "character": e.get("character", ""),
                    "art": _asset(e.get("art", "")), "anim": _asset(e.get("anim", "")),
                    "persona": persona, "card": card})
    return {"ocs": out}


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
def api_identify(req: TextReq, user: dict | None = Depends(current_user_dep)):
    """散文设定 → 角色 Card V2。"""
    if not req.text.strip():
        raise HTTPException(400, "设定文字不能为空")
    owner = _write_owner(user)
    try:
        card = identify(req.text)
        storage.save_library("characters", card.data.name, card.model_dump(), user_id=owner)
        return card.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_world")
def api_identify_world(req: TextReq, user: dict | None = Depends(current_user_dep)):
    """世界观文字 → 多条带关键词的世界书条目。"""
    if not req.text.strip():
        raise HTTPException(400, "世界观文字不能为空")
    owner = _write_owner(user)
    try:
        world = identify_worldbook(req.text)
        storage.save_library("worlds", world.name, world.model_dump(), user_id=owner)
        return world.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_story")
def api_identify_story(req: TextReq, user: dict | None = Depends(current_user_dep)):
    """故事书文字 → 时间线 / 主线 / 可触发事件节点。"""
    if not req.text.strip():
        raise HTTPException(400, "故事书文字不能为空")
    owner = _write_owner(user)
    try:
        story = identify_storybook(req.text)
        storage.save_library("stories", story.title, story.model_dump(), user_id=owner)
        return story.model_dump()
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")


@app.post("/api/identify_player")
def api_identify_player(req: TextReq, user: dict | None = Depends(current_user_dep)):
    """玩家设定 → PlayerCard。"""
    if not req.text.strip():
        raise HTTPException(400, "玩家设定不能为空")
    owner = _write_owner(user)
    try:
        player = identify_player(req.text)
        storage.save_library("players", player.name, player.model_dump(), user_id=owner)
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
def api_identify_auto(req: AutoReq, user: dict | None = Depends(current_user_dep)):
    """统一上传入口:AI 判类型(角色/世界/故事/玩家)→ 路由到对应解析 → 存进对应库。

    返回 {kind, confidence, reason, data}。前端据 kind 放进对应卡槽;判错时可带 kind 重调改判。
    """
    if not req.text.strip():
        raise HTTPException(400, "上传内容不能为空")
    owner = _write_owner(user)
    try:
        out = identify_auto(req.text, kind=req.kind)
    except Exception as e:
        raise HTTPException(500, f"识别失败:{e}")
    kind, data = out["kind"], out["data"]
    try:
        if kind == "character":
            storage.save_library("characters", (data.get("data") or {}).get("name") or "角色", data, user_id=owner)
        elif kind == "world":
            storage.save_library("worlds", data.get("name") or "世界书", data, user_id=owner)
        elif kind == "story":
            storage.save_library("stories", data.get("title") or "故事书", data, user_id=owner)
        elif kind == "player":
            storage.save_library("players", data.get("name") or "玩家", data, user_id=owner)
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
def api_chat(req: ChatReq, user: dict | None = Depends(current_user_dep)):
    """与角色对话。历史由后端按 session_id 维护,前端只传当轮输入。"""
    if not req.user.strip():
        raise HTTPException(400, "消息不能为空")
    auth.authorize_session(req.session_id, user)  # 归属闸(AUTH 关时 no-op):防跨用户污染会话/记忆
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
async def api_story_turn(req: StoryTurnReq, request: Request,
                         user: dict | None = Depends(current_user_dep)):
    """v2 故事回合(异步):多角色 + 世界书 + 故事书 + 玩家卡 + 状态/选项/记忆。非流式,作降级路径。"""
    if not req.characters:
        raise HTTPException(400, "至少需要一个角色卡")
    # 归属闸(AUTH_ENABLED=0 时 no-op):无主→认领给当前用户;他人有主→拒。放 try 之前,401/403 不被保底吞。
    await asyncio.to_thread(auth.authorize_session, req.session_id, user)
    # Phase 0 成本闸:全局熔断 + 限流 + 预扣(COST_GUARD_ENABLED=0 时全程 no-op)。
    res = await asyncio.to_thread(costguard.preflight, costguard.client_ip(request))
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
        await asyncio.to_thread(costguard.record, res, {})  # 保底回合≈零成本,退回预扣
        return _fallback_turn_dict(req, e)
    await asyncio.to_thread(costguard.record, res, out.usage)
    return out.model_dump()


@app.post("/api/story_turn_stream")
async def api_story_turn_stream(req: StoryTurnReq, request: Request,
                               user: dict | None = Depends(current_user_dep)):
    """流式故事回合(SSE)。主回合叙事逐字推给前端(delta 事件),回合算完再推完整结构体(done 事件)。

    协议:每行 `data: {json}\\n\\n`。事件 type:
    - delta:{"type":"delta","text":"..."} 主回合 LLM 的原始 JSON token 块,前端从累积串里实时抽 narration 先显示。
    - done :{"type":"done","turn":{...完整 StoryTurn...}} 服务端解析/落库后的权威结果(messages/choices/state/usage)。
    - error:{"type":"error","turn":{...保底...}} story_turn 抛异常时的端点级保底。
    """
    if not req.characters:
        raise HTTPException(400, "至少需要一个角色卡")
    # 归属闸 + Phase 0 成本闸:开流前先过(401/403/503/429 在这里抛,不进 SSE 流);两个门控关时 no-op。
    await asyncio.to_thread(auth.authorize_session, req.session_id, user)
    res = await asyncio.to_thread(costguard.preflight, costguard.client_ip(request))

    async def event_stream():
        q: asyncio.Queue = asyncio.Queue()

        async def on_delta(text: str):
            await q.put({"type": "delta", "text": text})

        async def runner():
            usage_for_record: dict = {}
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
                usage_for_record = out.usage
                await q.put({"type": "done", "turn": out.model_dump()})
            except Exception as e:
                await q.put({"type": "error", "turn": _fallback_turn_dict(req, e)})
            finally:
                await asyncio.to_thread(costguard.record, res, usage_for_record)  # 出错时 {}→退预扣
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
async def api_reroll(req: ReRollReq, request: Request,
                     user: dict | None = Depends(current_user_dep)):
    """对上一回合不满意时重新生成:回滚上一轮副作用(恢复 pre-turn 快照),用相同输入重跑。

    卡组取自当前已落盘的 artifacts(即上一轮实际用的卡),输入/模式取自 _reroll 记录。
    """
    await asyncio.to_thread(auth.authorize_session, req.session_id, user)  # 归属闸(AUTH 关时 no-op)
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
    # Phase 0 成本闸:重跑也烧 LLM,过闸(在回滚之前;COST_GUARD_ENABLED=0 时 no-op)。
    res = await asyncio.to_thread(costguard.preflight, costguard.client_ip(request))
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
        await asyncio.to_thread(costguard.record, res, {})
        raise HTTPException(500, f"重新生成失败:{e}")
    await asyncio.to_thread(costguard.record, res, out.usage)
    return out.model_dump()


@app.get("/api/session/{session_id}")
def api_session(session_id: str, user: dict | None = Depends(current_user_dep)):
    """查看持久化会话:调试/状态面板/续玩还原用。剔除内部重 roll 快照,避免把 ~2x 体量的镜像发给前端。"""
    auth.authorize_session(session_id, user, claim=False)  # 读:只校验不认领(AUTH 关时 no-op)
    data = storage.load_session(session_id)
    data.pop("_reroll", None)
    return data


@app.delete("/api/session/{session_id}")
def api_delete_session(session_id: str, user: dict | None = Depends(current_user_dep)):
    """删除一局存档(存档列表的删除)。删会话 + 级联 messages;深度模式向量数据(memory_vec)留作孤儿(无害)。"""
    if auth.enabled():
        if user is None:
            raise HTTPException(401, "请先登录")
        owner = auth.session_owner(session_id)
        # 删是破坏性的:有主只 owner/super 能删;无主(遗留)只 super 能删 —— 不让任意登录用户删别人/遗留存档。
        if user.get("role") != "superadmin" and owner != user["id"]:
            raise HTTPException(403, "无权删除该存档")
    return {"deleted": storage.delete_session(session_id)}


@app.get("/api/session/{session_id}/tail")
def api_session_tail(session_id: str, after: int = 0, user: dict | None = Depends(current_user_dep)):
    """玩家端实时轮询:返回该局第 after 条之后的新回合 + 当前状态(轻量,只回新回合)。
    用途:运营者「立即生效」或任何 server 端出的新回合,玩家界面自己冒出来(不必刷新)。
    AUTH 开时按归属校验(他人有主存档拒);关时沿用旧「session_id 随机难猜」模型。"""
    auth.authorize_session(session_id, user, claim=False)  # 读:只校验不认领(AUTH 关时 no-op)
    d = storage.load_session(session_id)
    turns = d.get("turns") or []
    n = len(turns)
    after = max(0, after)
    new_turns = turns[after:] if after < n else []
    return {"turn_count": n, "new_turns": new_turns, "state": d.get("state")}


_LIB_KINDS = {"characters", "worlds", "stories", "players"}


@app.get("/api/library/{kind}")
def api_library(kind: str, user: dict | None = Depends(current_user_dep)):
    """列出卡库:AUTH 开时 = 官方公共卡 + 当前用户私有卡(各带 official 标记);关时 = 旧全局。"""
    if kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    uid, legacy = _read_scope(user)
    return storage.list_library(kind, user_id=uid, legacy_all=legacy)


class LibSaveReq(BaseModel):
    kind: str
    data: dict


@app.post("/api/library/save")
def api_library_save(req: LibSaveReq, user: dict | None = Depends(current_user_dep)):
    """把一张卡存进卡库(建好/编辑过的卡完成时自动入库;上传识别的卡已在识别端点入库)。AUTH 开时存进当前用户私有库。"""
    if req.kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    owner = _write_owner(user)
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
        storage.save_library(req.kind, name, d, user_id=owner)
    except Exception as e:
        raise HTTPException(500, f"入库失败:{e}")
    return {"saved": True, "name": storage.slug(name)}


@app.delete("/api/library/{kind}/{name}")
def api_delete_library(kind: str, name: str, user: dict | None = Depends(current_user_dep)):
    """从卡库删除一张卡(name 取自 list 返回的 stem)。AUTH 开时只能删自己的(官方卡仅 admin)。"""
    if kind not in _LIB_KINDS:
        raise HTTPException(400, "kind 必须是 characters/worlds/stories/players")
    uid, legacy = _write_scope(user)
    return {"deleted": storage.delete_library(kind, name, user_id=uid,
                                              is_admin=bool(user and user.get("is_admin")), legacy_all=legacy)}


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
def api_list_presets(user: dict | None = Depends(current_user_dep)):
    """列出故事预设:AUTH 开时 = 官方公共预设 + 当前用户私有(各带 official 标记);关时 = 旧全局。"""
    uid, legacy = _read_scope(user)
    return storage.list_presets(user_id=uid, legacy_all=legacy)


@app.post("/api/presets")
def api_save_preset(req: PresetReq, user: dict | None = Depends(current_user_dep)):
    if not req.name.strip():
        raise HTTPException(400, "预设名不能为空")
    if not req.characters:
        raise HTTPException(400, "故事预设至少要一个角色卡")
    owner = _write_owner(user)
    storage.save_preset(req.name, req.model_dump(), user_id=owner)
    return {"saved": True, "name": storage.slug(req.name)}


@app.delete("/api/presets/{name}")
def api_delete_preset(name: str, user: dict | None = Depends(current_user_dep)):
    uid, legacy = _write_scope(user)
    return {"deleted": storage.delete_preset(name, user_id=uid,
                                             is_admin=bool(user and user.get("is_admin")), legacy_all=legacy)}


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


async def _operator_advance(session_id: str, user: str = "（场景继续）") -> dict:
    """运营者触发:立即用该局存档卡组跑一回合,AI 当场出内容。
    卡组复用 artifacts(同 reroll)。user 默认中性"场景继续"(导演 now 用);
    传入玩家输入则等于运营者以玩家身份发话(/api/operator/say 用)。"""
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
    out = await story_turn(session_id=session_id, characters=characters, user=user,
                           world=world, story=story, player=player, mode=art.get("mode") or "standard")
    return out.model_dump()


@app.post("/api/operator/inject")
async def api_operator_inject(req: OperatorInjectReq, _actor: dict = Depends(require_role("superadmin"))):
    """后台对某局施加影响,三种模式(需 X-Operator-Token):
    - director(默认):幕后指令进队列,AI 下回合织进剧情;sticky=持续每回合,now=立即跑一回合。
    - direct:指定 target 角色【逐字】说出 content —— 引擎直插一条回合,不走 AI、即时、保证原样。
    - narration:把 content 作为旁白【逐字】写进剧情 —— 引擎直插,不走 AI、即时。
    direct/narration 即时落地(不看 sticky/now);两路都写 operator_applied 留痕。"""
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
def api_operator_inject_list(session_id: str, _actor: dict = Depends(require_role("superadmin"))):
    """看某局当前待注入(还没被消费)的内容。需 X-Operator-Token。"""
    return {"operator_inject": storage.load_session(session_id).get("operator_inject") or []}


@app.delete("/api/operator/inject/{session_id}")
def api_operator_inject_clear(session_id: str, _actor: dict = Depends(require_role("superadmin"))):
    """清空某局的待注入队列(once + sticky 全清)。需 X-Operator-Token。"""
    data = storage.load_session(session_id)
    data["operator_inject"] = []
    storage.save_session(session_id, data)
    return {"ok": True}


@app.get("/api/operator/sessions")
def api_operator_sessions(_actor: dict = Depends(require_role("superadmin"))):
    """列出所有 session(控制台左栏点选用)。需 X-Operator-Token。"""
    return {"sessions": storage.list_sessions()}


@app.get("/api/operator/session/{session_id}")
def api_operator_session(session_id: str, _actor: dict = Depends(require_role("superadmin"))):
    """看某局完整上下文:回合记录(玩家输入 + 叙事 + 角色发言)+ 当前状态 + 注入队列。需 X-Operator-Token。"""
    d = storage.load_session(session_id)
    return {
        "session_id": session_id,
        "turns": d.get("turns") or [],
        "state": d.get("state"),
        "operator_inject": d.get("operator_inject") or [],
        "artifacts_mode": (d.get("artifacts") or {}).get("mode"),
    }


@app.get("/api/operator/oc")
def api_operator_oc(_actor: dict = Depends(require_role("admin"))):
    """OC 集:列出各用户的 OC(角色设定 + 世界观 + 立绘 + 地图)。需 X-Operator-Token。
    数据读 oc/index.json + 它引用的 .md;图走 /oc-assets 静态路由(<img> 直接取)。"""
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
        "card": bool(e.get("card") and (OC_DIR / e["card"]).is_file()),  # 有引擎卡才可「开测」
    } for e in entries]
    return {"ocs": ocs}


class OCStartReq(BaseModel):
    index: int = 0


@app.post("/api/operator/oc/start")
async def api_operator_oc_start(req: OCStartReq, _actor: dict = Depends(require_role("superadmin"))):
    """用某个 OC 的引擎角色卡直接开一局测试会话(跑开场回合)。需 X-Operator-Token。
    返回 {session_id, character, turn};该会话即普通 session,可在「对局」里继续(/api/operator/say)+ 导演注入。"""
    idx_file = OC_DIR / "index.json"
    if not idx_file.is_file():
        raise HTTPException(404, "没有 OC 数据")
    entries = json.loads(idx_file.read_text(encoding="utf-8"))
    if not (0 <= req.index < len(entries)):
        raise HTTPException(400, "OC index 越界")
    e = entries[req.index]
    card_path = (OC_DIR / e["card"]) if e.get("card") else None
    if not (card_path and card_path.is_file()):
        raise HTTPException(400, f"该 OC 没有引擎角色卡(card.md):{e.get('character', '')}")
    card = parse_character(card_path.read_text(encoding="utf-8"))
    session_id = "octest-" + uuid.uuid4().hex[:12]
    out = await story_turn(session_id=session_id, characters=[card], user="", mode="standard")
    return {"session_id": session_id, "character": e.get("character", ""), "turn": out.model_dump()}


class OperatorSayReq(BaseModel):
    session_id: str
    user: str


@app.post("/api/operator/say")
async def api_operator_say(req: OperatorSayReq, _actor: dict = Depends(require_role("superadmin"))):
    """以【玩家】身份给某局发一句、推进一回合(用该局存档卡组)。需 X-Operator-Token。
    给运营者在控制台直接测试对话用;与导演注入(/inject)互补:say=玩家行动,inject=幕后导演。"""
    if not req.user.strip():
        raise HTTPException(400, "玩家输入不能为空")
    return await _operator_advance(req.session_id, user=req.user.strip())


# ── Phase 0 成本闸观测 / 急停(见 src/costguard.py)──────────────────
class KillReq(BaseModel):
    tripped: bool = True  # True=立即停服调 LLM;False=恢复


@app.get("/api/operator/usage")
def api_operator_usage(_actor: dict = Depends(require_role("superadmin"))):
    """看今日全局花费 / 是否熔断 / Top 来源用量。需 X-Operator-Token。"""
    return costguard.stats()


@app.post("/api/operator/usage/kill")
def api_operator_usage_kill(req: KillReq, _actor: dict = Depends(require_role("superadmin"))):
    """手动急停/恢复:翻今天的全局熔断开关。需 X-Operator-Token。"""
    return costguard.set_tripped(req.tripped)


# ── 账户迁移(运营者手动把老存档/卡归到某用户)──────────────────────
class AssignSessionReq(BaseModel):
    session_id: str
    user: str          # 用户名 / 邮箱 / user_id


class AssignCardReq(BaseModel):
    kind: str          # characters / worlds / stories / players
    name: str          # list 返回的 stem(slug)
    user: str          # 用户名 / 邮箱 / user_id;留空("")=设回官方公共


class AssignPresetReq(BaseModel):
    name: str          # 预设 stem(slug)
    user: str          # 用户名 / 邮箱 / user_id;留空("")=设回官方公共


@app.get("/api/operator/users")
def api_operator_users(_actor: dict = Depends(require_role("admin"))):
    """列出所有用户(迁移时查 user_id 用)。需 X-Operator-Token。"""
    return {"users": auth.list_users()}


@app.post("/api/operator/assign_session")
def api_operator_assign_session(req: AssignSessionReq, _actor: dict = Depends(require_role("superadmin"))):
    """把某局存档归到某用户(账户系统迁移老存档)。需 X-Operator-Token。"""
    uid = auth.find_user_id(req.user)
    if not uid:
        raise HTTPException(404, f"找不到用户:{req.user}")
    return {"assigned": storage.assign_session_owner(req.session_id, uid), "user_id": uid}


@app.post("/api/operator/assign_card")
def api_operator_assign_card(req: AssignCardReq, _actor: dict = Depends(require_role("admin"))):
    """把某张(原全局/官方)卡归到某用户;user 留空=设回官方公共。需 X-Operator-Token。"""
    uid = auth.find_user_id(req.user) if req.user.strip() else None
    if req.user.strip() and not uid:
        raise HTTPException(404, f"找不到用户:{req.user}")
    return {"assigned": storage.assign_card_owner(req.kind, req.name, uid), "user_id": uid}


@app.post("/api/operator/assign_preset")
def api_operator_assign_preset(req: AssignPresetReq, _actor: dict = Depends(require_role("admin"))):
    """把某个(原全局/官方)预设归到某用户;user 留空=设回官方公共。需 admin。"""
    uid = auth.find_user_id(req.user) if req.user.strip() else None
    if req.user.strip() and not uid:
        raise HTTPException(404, f"找不到用户:{req.user}")
    return {"assigned": storage.assign_preset_owner(req.name, uid), "user_id": uid}


# ── 账户中心(super 主入口):看某账户的对话 / 列无主老存档 / 分发 OC ──────────
@app.get("/api/operator/account_sessions/{user_id}")
def api_operator_account_sessions(user_id: str, _actor: dict = Depends(require_role("superadmin"))):
    """列某账户的所有对话(账户中心点开账户用)。需 superadmin。"""
    return {"sessions": storage.list_sessions(user_id=user_id)}


@app.get("/api/operator/unowned_sessions")
def api_operator_unowned_sessions(_actor: dict = Depends(require_role("superadmin"))):
    """列无主老存档(供「分发老存档」挑选)。需 superadmin。"""
    return {"sessions": storage.list_sessions(unowned=True)}


class AssignOcReq(BaseModel):
    index: int = 0
    user: str          # 用户名 / 邮箱 / user_id


@app.post("/api/operator/assign_oc")
async def api_operator_assign_oc(req: AssignOcReq, _actor: dict = Depends(require_role("superadmin"))):
    """把某个 OC 分发给用户:用 OC 引擎卡开一局(生成开场)、存档归属设为该用户 → 他在「我的存档」即可续玩。需 superadmin。"""
    uid = auth.find_user_id(req.user)
    if not uid:
        raise HTTPException(404, f"找不到用户:{req.user}")
    idx_file = OC_DIR / "index.json"
    if not idx_file.is_file():
        raise HTTPException(404, "没有 OC 数据")
    entries = json.loads(idx_file.read_text(encoding="utf-8"))
    if not (0 <= req.index < len(entries)):
        raise HTTPException(400, "OC index 越界")
    e = entries[req.index]
    card_path = (OC_DIR / e["card"]) if e.get("card") else None
    if not (card_path and card_path.is_file()):
        raise HTTPException(400, f"该 OC 没有引擎角色卡(card.md):{e.get('character', '')}")
    card = parse_character(card_path.read_text(encoding="utf-8"))
    session_id = "oc-" + uuid.uuid4().hex[:12]
    await asyncio.to_thread(auth.claim_session, session_id, uid)   # 先把空存档归到该用户
    out = await story_turn(session_id=session_id, characters=[card], user="", mode="standard")  # 跑开场(归属保持)
    return {"ok": True, "session_id": session_id, "character": e.get("character", ""), "user_id": uid}


# 私人后台控制台:不从玩家前端链接过去;真正的闸是 token(页面只是表单,无 token 调不动接口)。
# OPERATOR_TOKEN 没设则 404(功能关闭)。token 存浏览器 localStorage,同源 fetch 免 CORS。
def _load_console_html() -> str:
    p = ROOT / "operator_console.html"
    return p.read_text(encoding="utf-8") if p.is_file() else "<h1>控制台文件缺失</h1>"


@app.get("/operator", response_class=HTMLResponse)
def operator_console():
    """后台控制台(admin/superadmin)。页面不做鉴权,真正的闸是各 /api/operator/* 端点按角色校验。
    可达条件:设了 OPERATOR_TOKEN(后门)或开了账户系统(AUTH_ENABLED)——后者下由登录用户的角色决定能做什么。"""
    if not (os.getenv("OPERATOR_TOKEN") or auth.enabled()):
        raise HTTPException(404, "未启用")
    return HTMLResponse(_load_console_html())


# 前端静态文件挂在根路径(html=True 让 / 返回 index.html)。
# 前端目录存在 → 同时服务前端 + /api/* 接口(给人玩);目录不存在 → 退化为纯后端
# (只剩 /api/* + /docs + /openapi.json,给 AI / 调用方按 schema 直接调),且不会启动崩溃。
# 这样"既保留前端、又能纯后端被 AI 直接调用"在同一份代码里共存。
if OC_DIR.is_dir():  # OC 集图片(立绘/地图)走静态;须在 "/" catch-all 之前挂
    app.mount("/oc-assets", StaticFiles(directory=str(OC_DIR)), name="oc-assets")

if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
