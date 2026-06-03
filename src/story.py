"""v2 互动故事引擎。

它不是普通 chatbot:每轮都会读取上传的角色/世界/故事/玩家卡,结合运行时状态、
短期记忆、长期记忆和触发事件,生成叙事、角色发言、玩家选项和结构化状态更新。
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

_TZ8 = timezone(timedelta(hours=8))  # 存档时间戳走北京时间

from . import memory, storage
from .adapters import ContextBundle, get_adapter
from .llm import achat_messages, achat_messages_stream, chat_messages, collect_usage, current_usage
from .models import (
    CharacterCard,
    EventTimelineItem,
    FactBoundary,
    MemoryWrite,
    PlayerCard,
    RelationshipState,
    RuntimeState,
    StoryBook,
    StoryChoice,
    StoryEvent,
    StoryMessage,
    StoryTurn,
    WorldBook,
)

RECENT_MESSAGES = 24            # recap 的硬上限条数;实际窗口由下面的预算动态决定
SHORT_MEMORY_FLUSH = 5
MAX_ACTION_CHARS = 1800

# 上下文预算:按字符数粗估 token(中文约 1 字 1 token),控制延迟并防止 context 爆。
CONTEXT_BUDGET_CHARS = 24000
RECAP_RATIO = 0.7              # 预算里分给近期原文 recap 的比例,其余留给摘要/召回
SUMMARY_MAX_CHARS = 900        # 滚动摘要注入上限
SUMMARY_RECOMPUTE_EVERY = 4    # 更早消息每多这么多条,重算一次滚动摘要
DEEP_WARMUP_AT = 0.65          # 深度模式:上下文用量超此比例,后台预热 embedding 模型
DEEP_RECALL_AT = 0.80          # 深度模式:超此比例且模型就绪,启用向量召回
RECALL_QUERY_ACTION_ONLY = False  # 实验门控:向量召回 query 强制仅用当前问句(默认 False:按 _is_fact_query 条件化)
MISS_DIST = 0.45               # abstention:具体事实查询时 top1 余弦距离 > 此值 = 检索无相关记录(硬 NOT_FOUND 兜底)
PHASE1_FIXES = True            # Phase 1 总开关(runner 置 False 跑 baseline 对照 / 也是 prod kill-switch):
                              # off = 无①召回条件化 / ②abstention / ③不回写编造 / ④发言者已知实体门
PHASE2_DOSSIER = False         # Phase 2 总开关(实体活档):on = 按实体存事实 + 注入在场实体档 + dossier 优先 abstention

# 世界时钟(故事内分钟):模型每轮估 time_advance,代码 clamp。
MIN_TIME_ADVANCE = 1           # 每轮至少推进的故事分钟,防时钟冻住
NATURAL_MAX_ADVANCE = 180      # 自然推进上限(3 故事小时);玩家没显式跳时间时按此 clamp,防乱估
JUMP_MAX_ADVANCE = 60 * 1440   # 玩家显式跳时间时的单轮上限(60 故事天;够跳"一个月后"这类声明)
# 玩家显式声明时间跳跃的词:命中则允许大跳(取模型估计,clamp 到 JUMP_MAX)。
_JUMP_WORDS = re.compile(
    r"第二天|第三天|次日|翌日|隔天|过了一?[天夜晚]|明天|明日|昨天|前一?天|"
    r"一[周星]期后|几[天周月]后|\d+\s*[天周月]后|\d+\s*(?:个)?(?:小时|钟头)后|"
    r"半天后|当晚|入夜|天亮|黎明|清晨|傍晚时分|深夜|一觉|睡了一觉|休整|等待[一几]"
)


def _char_id(card: CharacterCard, idx: int = 0) -> str:
    raw = card.data.character_id or card.data.name or f"char-{idx}"
    return storage.slug(raw, f"char-{idx}")


def _json_obj(raw: str) -> dict[str, Any]:
    """尽量从模型输出中解析 JSON。

    DeepSeek 偶尔会在 json_mode 下输出半截文本、markdown fence、中文引号或尾逗号。
    这里先做本地清洗;仍失败时由调用方决定是否走 LLM 修复或 fallback。
    """
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end < start:
            raise
        candidate = raw[start:end + 1]
        candidate = candidate.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
        return json.loads(candidate)


async def _repair_json(raw: str) -> dict[str, Any]:
    """让 LLM 把坏 JSON 修成合法 JSON。失败会抛出原始解析异常。"""
    try:
        return _json_obj(raw)
    except json.JSONDecodeError:
        fixed = await achat_messages(
            [
                {
                    "role": "system",
                    "content": (
                        "你是 JSON 修复器。把用户给的内容修复成严格合法 JSON。"
                        "必须保留原有字段含义,只输出 JSON,不要解释。"
                    ),
                },
                {"role": "user", "content": raw[:12000]},
            ],
            json_mode=True,
            max_tokens=1800,
            model=get_adapter().select_model("json_repair"),
        )
        return _json_obj(fixed)


def _speaker_for_action(action: str, state: RuntimeState, characters: list[CharacterCard]) -> tuple[str, str]:
    names = [c.data.name for c in characters if c.data.name]
    present = state.scene.present_characters or names
    for name in present:
        if name and name in action:
            card = next((c for c in characters if c.data.name == name), None)
            return (_char_id(card, 0) if card else storage.slug(name, "char"), name)
    for card in characters:
        if card.data.name in present or not present:
            return _char_id(card, 0), card.data.name
    return "narrator", "旁白"


def _local_continuation_turn(action: str, state: RuntimeState, characters: list[CharacterCard], reason: str = "") -> StoryTurn:
    """LLM 空白/坏结构时的自然保底。它必须像故事回合,不能像系统报错。

    文案与具体题材无关:只用当前场景 / 在场者 / 玩家行动拼装,不写死某个故事的专有名词,
    这样武侠、奇幻、现代等任意故事在 LLM 故障时都不会跳出当下世界。
    """
    cid, name = _speaker_for_action(action, state, characters)
    location = state.scene.location or "现场"
    objects = state.scene.objects or ["周围的环境", "在场者的神情", "眼前的线索"]
    focus = objects[0]
    present = "、".join(state.scene.present_characters[:4]) or name

    if any(word in action for word in ("看法", "怎么想", "意见", "反应")):
        narration = f"在{location},你的视线转向在场者。{present}的反应,一瞬间比眼前的事更值得留意。"
        text = f"{name}顺着你的话停顿了一下,没有立刻接腔:「想听看法可以,但先别急着下结论。有些地方还对不上。」"
    elif any(word in action for word in ("观察", "看看", "异常", "查", "检查")):
        narration = f"你把注意力重新压回{location}。{focus}还在视线中央,周围的细节开始显得不太安分。"
        text = f"{name}抬手示意你靠近一点:「可以看,但一项一项来。先弄清哪些是确定的,哪些只是看起来如此。」"
    elif any(word in action for word in ("为什么", "怎么", "?", "？")):
        narration = f"你的问题落在{location}中央。它没有直接给出答案,却迫使在场者把当前的状况重新讲清楚。"
        text = f"{name}把语气放慢:「这个问题可以问。眼下已知的还不够,但它能帮我们决定下一步往哪走。」"
    else:
        narration = f"在{location},你这句话被当成本回合的行动接住。它不一定直接推动主线,却改变了现场的注意力。"
        text = f"{name}看了你一眼,没有否定:「我先按你说的往下走。只要能对应到眼前的事实,它就算数。」"

    return StoryTurn(
        narration=narration,
        messages=[StoryMessage(character_id=cid, name=name, text=text)],
        choices=[
            StoryChoice(id="clarify_fact", label="要求对方把已知信息讲清楚", intent="ask", description="把问题落到确定的事实"),
            StoryChoice(id="watch_reaction", label="观察在场者的反应", intent="observe", description="寻找犹豫或隐瞒"),
            StoryChoice(id="inspect_focus", label=f"查看{focus}", intent="act", description="推进当前调查"),
        ],
        state_update={"player": {"flags": ["local_continuation"]}},
        memory_write=[MemoryWrite(kind="note", text=f"本轮使用本地自然保底继续: {action}; {reason}", importance=2)],
        triggered_events=[],
        state=state,
    )


def _init_state(characters: list[CharacterCard], player: PlayerCard | None, story: StoryBook | None) -> RuntimeState:
    ids = [_char_id(c, i) for i, c in enumerate(characters)]
    first_names = [c.data.name for c in characters[:3]]
    state = RuntimeState()
    state.scene.present_characters = first_names
    state.scene.location = "故事开场"
    if characters and characters[0].data.scenario:
        state.scene.atmosphere = characters[0].data.scenario[:300]
    if story:
        state.scene.atmosphere = story.premise or state.scene.atmosphere
        state.clock_minutes = max(0, int(story.clock_start or 0))  # 开局故事内时钟取故事书 clock_start
        state.timeline = [
            EventTimelineItem(event_id=e.event_id or storage.slug(e.title, "event"), title=e.title, status=e.status)
            for e in story.events
        ]
    if player:
        state.player.active_goals = player.goals[:]
        state.player.known_facts = player.known_facts[:]
    state.relationships = [RelationshipState(character_id=cid) for cid in ids]
    state.facts = FactBoundary(
        canon=[],
        revealed=player.known_facts[:] if player else [],
        hidden=[],
        uncertain=[],
        forbidden=[
            "不得编造上传材料、世界书或故事书里不存在的组织、地点、角色关系、历史事件。",
            "不知道的设定必须用角色口吻表达不确定,不能假装知道。",
            "隐藏事件未满足披露条件前,不要向玩家明说。",
        ],
    )
    return state


def _world_keyword_hits(world: WorldBook | None, text: str, limit: int = 8) -> list[str]:
    if not world:
        return []
    hits = []
    for entry in sorted(world.entries, key=lambda e: e.priority):
        if entry.visibility == "hidden":
            continue
        if any(k.strip() and k in text for k in entry.keys):
            label = entry.comment or "/".join(entry.keys[:3])
            hits.append(f"[world/{entry.truth_status}] {label}\n{entry.content}")
        if len(hits) >= limit:
            break
    return hits


def _event_revealed(event: StoryEvent, state: RuntimeState) -> bool:
    """事件是否可进入 prompt。

    只看 reveal_after 前置事件是否已推进(active/resolved),不再硬性要求模型设置
    event_xx_completed / evidence_* 这类机器 flag —— LLM 不会可靠地吐这些,硬门会把
    除开场外的全部事件永久锁死。trigger_flags 若恰好已置位,视为额外满足,但不强制。
    """
    progressed = {t.event_id for t in state.timeline if t.status in {"active", "resolved"}}
    flags = set(state.player.flags)
    return all(e in progressed or e in flags for e in event.reveal_after)


def _story_event_hits(story: StoryBook | None, text: str, state: RuntimeState, limit: int = 5) -> list[StoryEvent]:
    if not story:
        return []
    out = []
    active_ids = {e.event_id for e in state.timeline if e.status in {"pending", "active"}}
    for event in story.events:
        eid = event.event_id or storage.slug(event.title, "event")
        if event.status in {"resolved", "locked"} or (active_ids and eid not in active_ids):
            continue
        if not _event_revealed(event, state):
            continue
        keyword_hit = any(k and k in text for k in event.trigger_keywords)
        loose_hit = not event.trigger_keywords and len(out) == 0 and state.turn_count == 0
        if keyword_hit or loose_hit:
            out.append(event)
        if len(out) >= limit:
            break
    return out


def _index_books(session_id: str, world: WorldBook | None, story: StoryBook | None) -> None:
    entries = []
    if world:
        for i, e in enumerate(world.entries):
            entries.append({
                "id": e.entry_id or f"world-{i}-{e.comment}",
                "title": e.comment or "/".join(e.keys[:3]),
                "content": e.content,
                "source": e.source,
                "truth_status": e.truth_status,
                "visibility": e.visibility,
            })
    if story:
        for e in story.events:
            entries.append({
                "id": e.event_id or storage.slug(e.title, "event"),
                "title": e.title,
                "content": e.summary + "\n" + "\n".join(e.choices_hint + e.consequences),
                "source": "story",
                "truth_status": "canon",
                "visibility": "public",
            })
    memory.index_knowledge(session_id, entries)


def _books_signature(world: WorldBook | None, story: StoryBook | None) -> str:
    payload = {
        "world": world.model_dump() if world else None,
        "story": story.model_dump() if story else None,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _merge_unique(target: list[str], values: list[str]) -> list[str]:
    for value in values:
        value = str(value).strip()
        if value and value not in target:
            target.append(value)
    return target


def _message_content(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("content", ""))
    return str(item or "")


def _as_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


def _safe_state(data: dict[str, Any], characters: list[CharacterCard], player: PlayerCard | None, story: StoryBook | None) -> RuntimeState:
    raw = data.get("state")
    if isinstance(raw, dict):
        try:
            return RuntimeState(**raw)
        except Exception:
            data.setdefault("long_memory", []).append({
                "kind": "note",
                "text": "运行状态结构损坏,已按当前卡组重建状态。",
                "importance": 2,
            })
    return _init_state(characters, player, story)


def _input_profile(action: str) -> str:
    text = action.strip()
    if not text:
        return "开场或观察请求。"
    has_cjk = bool(re.search(r"[\u4e00-\u9fff]", text))
    has_word = bool(re.search(r"[A-Za-z0-9]", text))
    punct_ratio = sum(1 for ch in text if not ch.isalnum() and not "\u4e00" <= ch <= "\u9fff") / max(len(text), 1)
    if len(text) <= 2:
        return "极短输入:可能是沉默、犹豫、打断或片段回应;必须在故事内给轻量反馈。"
    if not has_cjk and not has_word:
        return "非文字/符号输入:当作情绪、手势或无法明确表达的反应处理,不要空转。"
    if punct_ratio > 0.65:
        return "高符号比例输入:可能是玩梗、情绪、乱码或打断;角色应先确认/误解/接住,不要硬编事实。"
    if len(text) < 12:
        return "短口语输入:可能省略主语或动作,结合当前场景理解。"
    return "自然语言输入:可能包含口语、玩梗、错字或不完整行动,优先按故事内意图处理。"


def _apply_state_update(state: RuntimeState, update: dict[str, Any]) -> RuntimeState:
    """把模型返回的状态补丁合并到 RuntimeState。格式故意宽松,防止模型小偏差。"""
    if not isinstance(update, dict) or not update:
        return state
    scene = update.get("scene")
    if isinstance(scene, str):  # 模型偶尔把 scene 直接写成地点字符串,按 location 处理而非丢弃
        scene = {"location": scene}
    elif not isinstance(scene, dict):
        scene = {}
    for key in ("location", "time", "atmosphere"):
        if scene.get(key):
            setattr(state.scene, key, str(scene[key]))
    for key in ("present_characters", "objects", "exits"):
        values = _as_text_list(scene.get(key))
        if values:
            setattr(state.scene, key, values)

    player = update.get("player") or {}
    if not isinstance(player, dict):
        player = {}
    for key in ("location", "status"):
        if player.get(key):
            setattr(state.player, key, str(player[key]))
    for key in ("inventory", "active_goals", "known_facts", "flags"):
        _merge_unique(getattr(state.player, key), _as_text_list(player.get(key)))
    # active_goals 止血:完成的移出 + 封顶,防面板里目标越堆越多/已达成还挂着。
    for done in _as_text_list(player.get("completed_goals")):
        if done in state.player.active_goals:
            state.player.active_goals.remove(done)
    if len(state.player.active_goals) > 12:
        state.player.active_goals = state.player.active_goals[-12:]

    facts = update.get("facts") or {}
    if not isinstance(facts, dict):
        facts = {}
    for key in ("canon", "revealed", "hidden", "uncertain", "forbidden"):
        _merge_unique(getattr(state.facts, key), _as_text_list(facts.get(key)))

    for rel in update.get("relationships") or []:
        if not isinstance(rel, dict):
            continue
        cid = rel.get("character_id") or rel.get("name")
        if not cid:
            continue
        existing = next((r for r in state.relationships if r.character_id == cid), None)
        if not existing:
            existing = RelationshipState(character_id=str(cid))
            state.relationships.append(existing)
        for key in ("trust", "tension", "affection"):
            if isinstance(rel.get(key), int):
                setattr(existing, key, max(-100, min(100, getattr(existing, key) + rel[key])))
        _merge_unique(existing.notes, _as_text_list(rel.get("notes")))

    for log in update.get("character_logs") or []:
        if not isinstance(log, dict):
            continue
        cid = log.get("character_id") or log.get("name")
        if not cid:
            continue
        existing = next((x for x in state.character_logs if x.character_id == cid), None)
        if not existing:
            from .models import CharacterLog
            existing = CharacterLog(character_id=str(cid))
            state.character_logs.append(existing)
        _merge_unique(existing.knows, _as_text_list(log.get("knows")))
        _merge_unique(existing.impressions, _as_text_list(log.get("impressions")))

    for item in update.get("timeline") or []:
        if not isinstance(item, dict):
            continue
        eid = item.get("event_id") or storage.slug(item.get("title", ""), "event")
        if not eid:
            continue
        existing = next((t for t in state.timeline if t.event_id == eid), None)
        if not existing:
            existing = EventTimelineItem(event_id=eid, title=item.get("title", eid))
            state.timeline.append(existing)
        if item.get("status") in {"pending", "active", "resolved", "delayed", "cooldown"}:
            existing.status = item["status"]
        if item.get("due_hint"):
            existing.due_hint = str(item["due_hint"])
        _merge_unique(existing.notes, _as_text_list(item.get("notes")))
    # 主线结案标记 + 已达成结局(由模型在主线核心问题解决/某结局条件满足时给出)。
    if update.get("main_resolved") is True:
        state.main_resolved = True
    for eid in _as_text_list(update.get("reached_ending")) + _as_text_list(update.get("reached_endings")):
        if eid not in state.reached_endings:
            state.reached_endings.append(eid)
    return state


def _local_long_memory(short_items: list[dict]) -> list[dict]:
    """不调用 LLM 的廉价长期记忆摘要,供 LLM 抽取失败或向量检索关闭时复用。"""
    user_actions = [
        _message_content(m).strip()
        for m in short_items
        if isinstance(m, dict) and m.get("role") == "user" and _message_content(m).strip()
    ]
    assistant_notes = [
        _message_content(m).strip().replace("\n", " ")
        for m in short_items
        if isinstance(m, dict) and m.get("role") == "assistant" and _message_content(m).strip()
    ]
    summary_parts = []
    if user_actions:
        summary_parts.append("玩家近期行动: " + " / ".join(user_actions[-4:]))
    if assistant_notes:
        summary_parts.append("近期剧情进展: " + " / ".join(x[:160] for x in assistant_notes[-3:]))
    return [{
        "kind": "note",
        "text": "；".join(summary_parts) or "近期互动已发生,但未能抽取更细长期记忆。",
        "importance": 2,
    }]


def _progress_events(state: RuntimeState, triggered: list[str]) -> None:
    """模型本轮触发的事件登记进时间线:pending→active。active 计入 reveal_after 的已推进集合,
    从而解锁下一段事件;是否 resolved 仍由模型显式给 timeline.status 决定(_apply_state_update 处理)。"""
    for eid in triggered:
        eid = str(eid).strip()
        if not eid:
            continue
        item = next((t for t in state.timeline if t.event_id == eid), None)
        if item is None:
            state.timeline.append(EventTimelineItem(event_id=eid, title=eid, status="active"))
        elif item.status in {"pending", "delayed", "cooldown"}:
            item.status = "active"


async def _extract_long_memory(session_id: str, short_items: list[dict]) -> list[dict]:
    convo = "\n".join(
        f"{m.get('role','?')}:{m.get('content','')}" if isinstance(m, dict) else str(m)
        for m in short_items
    )
    try:
        raw = await achat_messages(
            [
                {
                    "role": "system",
                    "content": (
                        "从下面互动故事对话中抽取长期记忆。输出 JSON:"
                        '{"items":[{"kind":"event|choice|relationship|fact|quest|note","text":"...","importance":1-5}]}。'
                        "只保留会影响后续剧情、关系、事实边界或任务的内容。"
                    ),
                },
                {"role": "user", "content": convo},
            ],
            json_mode=True,
            max_tokens=1024,
            model=get_adapter().select_model("memory_extract"),
        )
        obj = _json_obj(raw)
    except Exception:
        return _local_long_memory(short_items)
    out = []
    for i, item in enumerate(obj.get("items", [])):
        if isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            kind = item.get("kind", "note")
            importance = int(item.get("importance", 3) or 3)
        else:
            text = str(item).strip()
            kind = "note"
            importance = 3
        if not text:
            continue
        mid = hashlib.sha1(f"{session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
        await asyncio.to_thread(memory.add_memory, session_id, mid, text, kind=kind, importance=importance)
        out.append({"kind": kind, "text": text, "importance": importance})
    return out


def _state_digest(state: RuntimeState) -> dict[str, Any]:
    """注入 prompt 的运行状态摘要。截断长列表、只留活跃事件,避免整份 RuntimeState
    随对局膨胀挤占上下文,同时保留模型做增量更新所需的当前值(尤其关系当前分数)。"""
    return {
        "scene": {
            "location": state.scene.location,
            "time": state.scene.time,
            "atmosphere": state.scene.atmosphere[:200],
            "present_characters": state.scene.present_characters,
            "objects": state.scene.objects[:8],
            "exits": state.scene.exits[:6],
        },
        "player": {
            "location": state.player.location,
            "status": state.player.status,
            "inventory": state.player.inventory[-10:],
            "active_goals": state.player.active_goals[:8],
            "flags": [f for f in state.player.flags if f not in {"local_continuation", "json_repair_fallback"}][-12:],
        },
        "relationships": [
            {"character_id": r.character_id, "trust": r.trust, "tension": r.tension,
             "affection": r.affection, "notes": r.notes[-2:]}
            for r in state.relationships
        ],
        "facts": {
            "canon": state.facts.canon[-8:],
            "revealed": state.facts.revealed[-12:],
            "uncertain": state.facts.uncertain[-8:],
            "forbidden": state.facts.forbidden,
        },
        "timeline": [
            {"event_id": t.event_id, "title": t.title, "status": t.status}
            for t in state.timeline if t.status in {"pending", "active", "delayed", "cooldown"}
        ][:12],
        "turn_count": state.turn_count,
        "clock": _fmt_clock(state.clock_minutes),
        "clock_minutes": state.clock_minutes,
        "idle_minutes": state.idle_minutes,
        "main_resolved": state.main_resolved,
    }


def _clamp_time_advance(raw: Any, action: str) -> int:
    """把模型估的 time_advance(分钟)clamp 成合理值。

    自然推进锁在 [MIN, NATURAL_MAX] 防乱估;玩家显式说"第二天/三小时后"等跳跃词时放开到 JUMP_MAX;
    每轮至少 +MIN_TIME_ADVANCE,防时钟冻住。
    """
    try:
        adv = int(round(float(raw)))
    except (TypeError, ValueError):
        adv = MIN_TIME_ADVANCE
    if adv < 0:
        adv = MIN_TIME_ADVANCE
    ceiling = JUMP_MAX_ADVANCE if _JUMP_WORDS.search(action or "") else NATURAL_MAX_ADVANCE
    return max(MIN_TIME_ADVANCE, min(adv, ceiling))


def _fmt_clock(minutes: int) -> str:
    """把故事内分钟格成 第N天 HH:MM。"""
    minutes = max(0, int(minutes))
    return f"第{minutes // 1440 + 1}天 {(minutes % 1440) // 60:02d}:{minutes % 60:02d}"


_CN_NUM = {"半": 0.5, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5,
           "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
# 显式向前跳时间的短语 → 最小推进分钟。要求带向前语境(过了/再过/后/过去/等),避免"三天前"这类回指误判。
_NUM = r"(\d+|[半一两二三四五六七八九十])"
_JUMP_FLOOR_PATTERNS = [
    (rf"(?:过了|再过|又过了|等了?|过|经过)\s*{_NUM}\s*个?\s*月", 43200),
    (rf"{_NUM}\s*个?\s*月\s*(?:后|过去|之后|以后)", 43200),
    (rf"(?:过了|再过|又过了|等了?|过|经过)\s*{_NUM}\s*(?:周|星期|礼拜)", 10080),
    (rf"{_NUM}\s*(?:周|星期|礼拜)\s*(?:后|过去|之后|以后)", 10080),
    (rf"(?:过了|再过|又过了|等了?|过|经过)\s*{_NUM}\s*天", 1440),
    (rf"{_NUM}\s*天\s*(?:后|过去|之后|以后)", 1440),
    (rf"(?:过了|再过|又过了|等了?|过|经过)\s*{_NUM}\s*个?\s*(?:小时|钟头)", 60),
    (rf"{_NUM}\s*个?\s*(?:小时|钟头)\s*(?:后|过去|之后|以后)", 60),
]
_JUMP_FLOOR_NEXTDAY = re.compile(r"第二天|次日|翌日|隔天|明天|明日")
_JUMP_FLOOR_NIGHT = re.compile(r"一夜|当晚|过夜|睡了一觉|一觉|天亮|入夜|黎明|清晨")


def _parse_num(s: str) -> float:
    return float(s) if s.isdigit() else float(_CN_NUM.get(s, 1))


def _explicit_jump_floor(action: str) -> int:
    """玩家显式声明的时间跳跃 → 至少推进这么多故事分钟(玩家声明优先,即便模型估小了也保证跳到位)。"""
    a = action or ""
    floor = 0
    for pat, mult in _JUMP_FLOOR_PATTERNS:
        for m in re.finditer(pat, a):
            floor = max(floor, int(_parse_num(m.group(1)) * mult))
    if _JUMP_FLOOR_NEXTDAY.search(a):
        floor = max(floor, 1440)
    if _JUMP_FLOOR_NIGHT.search(a):
        floor = max(floor, 480)
    return min(floor, JUMP_MAX_ADVANCE)


def _due_escalations(story: StoryBook | None, state: RuntimeState) -> list[tuple[StoryEvent, str]]:
    """到点(due_clock<=clock)或主线停滞过久(escalate_after_idle<=idle)、且尚未登场/结案的事件,
    应当主动恶化登场。返回 [(事件, 原因)],按 severity 降序取前几个。"""
    if not story:
        return []
    progressed = {t.event_id for t in state.timeline if t.status in {"active", "resolved"}}
    out: list[tuple[StoryEvent, str]] = []
    for e in story.events:
        eid = e.event_id or storage.slug(e.title, "event")
        if eid in progressed:  # 已在场上/已结案的不再算"待恶化登场"
            continue
        due_hit = e.due_clock is not None and state.clock_minutes >= e.due_clock
        idle_hit = e.escalate_after_idle is not None and state.idle_minutes >= e.escalate_after_idle
        if due_hit or idle_hit:
            out.append((e, "时间到点" if due_hit else "主线停滞过久"))
    out.sort(key=lambda x: -(x[0].severity or 2))
    return out[:3]


def _main_anchor(story: StoryBook | None, player: PlayerCard | None) -> str:
    """主线锚点:恒定注入故事前提 + 主线目标 + 玩家目标,防主线被支线噪音淹没。"""
    if not story:
        return ""
    parts = []
    if story.premise:
        parts.append(f"前提:{story.premise[:200]}")
    if story.main_plot:
        parts.append("主线目标:" + "; ".join(story.main_plot[:3]))
    if player and player.goals:
        parts.append("玩家目标:" + "; ".join(player.goals[:3]))
    return " | ".join(parts)


def _prompt(
    characters: list[CharacterCard],
    player: PlayerCard | None,
    story: StoryBook | None,
    world_hits: list[str],
    story_hits: list[StoryEvent],
    kb_hits: list[str],
    long_memory: list[str],
    state: RuntimeState,
) -> str:
    char_blocks = []
    for i, card in enumerate(characters[:3]):
        d = card.data
        cid = _char_id(card, i)
        rules = "\n".join(f"- {r}" for r in d.speech_rules)
        char_blocks.append(
            f"## {d.name} ({cid})\n"
            f"设定:{d.description}\n性格:{d.personality}\n情境:{d.scenario}\n"
            f"范例:{d.mes_example}\n说话硬规则:\n{rules}\n"
            "主动性要求:根据该角色的身份、性格、利益和当前情境主动反应。"
            "可以追问、打断、试探、拒绝、转移压力、提出条件或推进自己的小目标。"
        )
    # 单角色"场景":判断依据是本轮实际在场的角色数(运行时),不是上传了几张卡。
    # 多角色卡组里和某个角色单独相处的段落也会触发——那种段落最容易退化成一问一答的聊天。
    present = [p for p in (state.scene.present_characters or [c.data.name for c in characters[:3]]) if p]
    solo_directive = ""
    if len(set(present)) <= 1:
        solo_directive = (
            "本轮场景里除玩家外只有一个角色在场,没有其他角色的对白来填充内容。"
            "因此 narration 要写足(至少 3-5 句、有画面感):把场景、气氛、玩家这一轮动作带来的"
            "物理/环境后果、以及世界本身的反应(光线、声音、物件、距离、温度、时间流逝)都描写出来,"
            "不要只写一两句就交给对白。让单角色场景依然有沉浸感和节奏,而不是一问一答。\n"
        )
    story_block = "\n".join(
        f"- {e.title}({e.event_id}): {e.summary}\n  选项提示:{'; '.join(e.choices_hint)}\n  后果:{'; '.join(e.consequences)}"
        for e in story_hits
    )
    story_overview = "未提供"
    if story:
        endings_text = "\n".join(
            f"- [{e.tone or '结局'}] {e.title}:{e.summary}(触发条件:{'; '.join(e.conditions) or '未明确'})"
            for e in story.endings[:6]
        ) or "无"
        bounds_text = "\n".join(
            f"- {b.character}:公开[{'; '.join(b.public[:4])}] 隐藏[{'; '.join(b.hidden[:4])}] 硬上限[{'; '.join(b.hard_limits[:4])}]"
            for b in story.character_boundaries[:6]
        ) or "无"
        parts = [
            f"标题:{story.title}",
            f"前提:{story.premise}",
            "时间线:\n- " + "\n- ".join(story.timeline[:12]),
            "主线阶段:\n- " + "\n- ".join(story.main_plot[:12]),
            "自由度规则:\n- " + "\n- ".join(story.freedom_rules[:8]),
        ]
        if story.pacing:
            parts.append("全局节奏/时间:\n- " + "\n- ".join(story.pacing[:6]))
        parts.append(
            "可能结局(当某结局的触发条件被满足时,把剧情自然导向它、并在 reasoning.note 记一句;"
            "条件没满足就别硬塞,继续保自由度):\n" + endings_text
        )
        parts.append(
            "角色信息边界(隐藏项在未披露前角色不能说出;硬上限不可被玩家单方面突破,"
            "玩家若强行突破按世界观硬约束走世界内反制):\n" + bounds_text
        )
        story_overview = "\n".join(parts)
    return (
        "你是互动故事引擎,不是普通聊天助手。你要生成一轮可玩的故事推进。\n"
        "严格事实边界:只能使用角色卡、世界书、故事书、玩家卡、运行状态和记忆中提供的事实。"
        "不存在/未披露/不确定的设定不得编造;可以让角色以自身口吻说不知道或需要调查。\n"
        "保持玩家自由度:不要替玩家做决定、不要描写玩家未选择的动作或心理。\n"
        "角色不是等待回复的机器人。每轮至少让一个在场角色做出符合性格的主动行为或主动判断,"
        "例如追问、质疑、观察、施压、试探、维护自身利益、提出交易条件、暴露情绪变化。"
        "主动行为只能基于已知事实和角色立场,不能替玩家解决核心问题,不能强行跳过玩家选择。\n"
        "对话要带动作和神情:角色台词前后应有简短的姿态、表情、语气或视线描写。"
        "动作描写必须符合角色性格和现场,不要写成长篇舞台说明。\n"
        + solo_directive +
        "玩家的自由输入就是本轮行动,必须被识别、回应并推进到叙事/角色反应/状态更新中。"
        "如果玩家行动不可执行、信息不足或越过事实边界,要在故事内给出原因和可调查方向,不能无视该输入。\n"
        "每轮必须先生成故事正文,再给 3-4 个玩家行动选项;选项不能替代正文。"
        "narration 必须非空,messages 至少包含一条角色对玩家本轮输入的反应。"
        "玩家可能使用口语、玩梗或不严肃报价,仍要当作故事内行动处理,由角色自然回应。\n\n"
        f"# 活跃角色\n{chr(10).join(char_blocks)}\n\n"
        f"# 玩家设定\n{json.dumps(player.model_dump(), ensure_ascii=False) if player else '未提供'}\n\n"
        f"# 故事书总览\n{story_overview}\n\n"
        f"# 当前运行状态\n{json.dumps(_state_digest(state), ensure_ascii=False)}\n\n"
        f"# 命中的世界书/设定卡\n{chr(10).join(world_hits) or '无'}\n\n"
        f"# 命中的故事事件\n{story_block or '无'}\n\n"
        f"# 向量召回资料\n{chr(10).join(kb_hits) or '无'}\n\n"
        f"# 长期记忆\n{chr(10).join(long_memory) or '无'}\n\n"
        "# 状态维护(每轮必做,直接决定玩家看到的状态面板,不要省略)\n"
        "- 场景:玩家移动或环境变化时,必须在 state_update.scene 写新值。scene 必须是对象,"
        "至少含 location;同时按需更新 time / atmosphere / present_characters / objects。绝不要把 scene 写成一个字符串。\n"
        "- 关系:本轮与玩家有互动或态度变化的每个在场角色,必须在 state_update.relationships 里给一条:"
        "character_id 用上面【活跃角色】括号里的 ID 原文(例如写 大黑塔,不要写成 黑塔);"
        "trust / tension / affection 填本轮 -10~10 的增量(没变化填 0);notes 一句话写原因。"
        "信任、紧张、好感、兴趣、压力这类故事变量就靠这里体现,不更新面板就会一直是 0。\n"
        "- 事实:本轮新确认/新披露/新存疑的事实分别写进 state_update.facts 的 canon / revealed / uncertain。\n"
        "- 事件:当本轮叙事推进了下面【命中的故事事件】之一,把它的 event_id 放进 triggered_events,"
        "并在 state_update.timeline 写 {\"event_id\":\"该ID\",\"status\":\"active\" 或 \"resolved\"}。\n\n"
        "# 一致性自检(先想后写,写进 reasoning,再让正文与判断一致)\n"
        "在写 narration 之前,先在 reasoning 字段里快速判断,然后让 narration/messages 与判断保持一致:\n"
        "1. 硬设定 / canon 违背(玩家侧):玩家本轮行动是否【明确】违背了角色卡 / 世界书 / 故事书里"
        "已确立的硬设定或既成事实(例如试图凭空抹杀、囚禁、秒杀一个设定上远超其能力的对象;"
        "或宣称自己拥有设定里根本没有的身份 / 能力 / 物品)。\n"
        "   - 分寸偏松:只针对【明确】违背已确立硬设定的;出格但不违规、夸张、玩梗、情绪化表达、灰色地带"
        "一律不算违背,照常接住、保玩家自由。绝大多数回合 hard_violation 应为 false。\n"
        "   - 若确属硬违背:不要配合演成得逞,而是用【设定内逻辑】让它失败 / 反噬 / 被揭穿 / 被拒绝,"
        "并始终留在故事里、用角色和世界的口吻表现(如“用列车核心囚禁黑塔”→人偶冷笑自毁、本体在别处),"
        "把这条反制写进 reasoning.world_counter,再据此写 narration/messages。不要弹系统报错、不要跳出故事。\n"
        "2. 角色 OOC 风险(角色侧):本轮角色的实力 / 阵营立场 / 心智状态有没有【无前置依据】的突变"
        "(被无理由神化或恶堕)。只在 reasoning.ooc_risk 里简短记录、并据此让角色保持一致;"
        "不要为此强行打断或拒绝玩家的正常行动,灰色地带给玩家自由。\n"
        "# 世界时钟(每轮必做)\n"
        "- 在 state_update.time_advance 填本轮经过的【故事内分钟数】:平常对话/调查给小值(几分钟到一两小时);"
        "玩家明确跳时间就给对应大值并在叙事里真的跳过去:一夜≈600,一天=1440,三天=4320,一周=10080,一个月≈43200。\n"
        "- 已到点/主线停滞而被列入【该主动恶化登场的事件】的,要让世界或相关角色主动把它推到玩家面前"
        "(催促、施压、事态升级),别等玩家来碰;玩家本轮正面处理了就把它推进或标 resolved。\n"
        "- 当主线核心问题已解决、或某结局触发条件已满足:state_update 标 main_resolved:true,"
        "并把对应结局 ID 填进 reached_ending,叙事给出收束(之后玩家仍可自由游玩尾声)。\n"
        "- 玩家已达成的目标放进 state_update.player.completed_goals(会从当前目标里移除)。\n\n"
        "输出严格 JSON,只输出这一个对象,格式:\n"
        "{"
        '"reasoning":{"hard_violation":false,"violation_detail":"","world_counter":"","ooc_risk":"","recall_check":"","note":"一句话推演"},'
        '"narration":"场景/动作/气氛,简洁",'
        '"messages":[{"character_id":"角色ID","name":"角色名","text":"带动作神情的台词"}],'
        '"choices":[{"id":"短ID","label":"玩家可点选行动","intent":"ask|act|move|observe|custom","description":"影响/风险"}],'
        '"state_update":{'
        '"time_advance":本轮经过的故事内分钟数,'
        '"scene":{"location":"当前地点","time":"","atmosphere":"","present_characters":[],"objects":[]},'
        '"player":{"location":"","status":"","inventory":[],"active_goals":[],"completed_goals":[],"flags":[]},'
        '"relationships":[{"character_id":"角色ID","trust":0,"tension":0,"affection":0,"notes":["原因"]}],'
        '"facts":{"canon":[],"revealed":[],"uncertain":[]},'
        '"timeline":[{"event_id":"事件ID","status":"active"}],'
        '"main_resolved":false,"reached_ending":""'
        "},"
        '"memory_write":[{"kind":"event|choice|relationship|fact|quest|note","text":"...", "importance":1-5}],'
        '"triggered_events":["event_id"]'
        "}"
    )


def _action_prompt(action: str, source: str) -> str:
    source_label = {
        "free": "玩家自由输入",
        "choice": "玩家点击选项",
        "opening": "开场/观察",
    }.get(source, "玩家行动")
    return (
        "# 本轮玩家输入\n"
        f"输入类型:{source_label}\n"
        f"输入形态:{_input_profile(action)}\n"
        "玩家原文:\n"
        f"{action}\n\n"
        "# 处理要求\n"
        "- 必须先理解玩家原文里的行动意图、对象、询问内容、地点移动或调查目标。\n"
        "- 本轮 narration 和 messages 必须直接回应这个输入,不能跳过、改写成无关剧情或只继续预设剧情。\n"
        "- 禁止只返回 choices;必须生成 narration,并至少生成一条角色台词 messages。\n"
        "- messages.text 不要只有纯对白;加入简短动作/神情/语气,例如“她抬了抬眉,把账单推近:……”。\n"
        "- 即使玩家输入是玩笑、吐槽或轻度跑题,也要让角色按自己的性格主动接住、误解、反击、冷处理或利用它。\n"
        "- 非空输入永远不能无回应。输入不清楚时,也要在故事内表现角色的困惑、确认或把它当作情绪/动作处理。\n"
        "- 玩家提到未上传或未披露的实体时,只能标为不确定线索,不能立刻当成真实设定。\n"
        "- 角色可以主动做小动作和提出条件,但不能替玩家完成关键选择。\n"
        "- 如果输入触发世界书关键词或故事事件,优先把命中的设定/事件自然推进出来。\n"
        "- 如果输入超出已披露事实,让角色以不确定、拒绝、需要查证或提出条件的方式回应。\n"
        "- 不要替玩家补充未说出口的动作、心理或决定。\n\n"
        "# 反重复与推进(重要)\n"
        "- 参考系统提示【最近剧情】的最后一轮(那是你刚生成的)。如果本轮玩家意图和它基本相同、"
        "或玩家没有引入新信息(只是换种说法、重复确认、重申同一意图),禁止重复上一轮的叙述和角色台词。\n"
        "- 这种情况下必须把局面向前推进一步:让在场角色给出下一个具体动作或结果(例如真的开始拟条款、"
        "报出第一项条件、调出下一份数据、走向下一个地点),或主动追问/施压打破僵局,绝不能原地重述上一拍。\n"
        "- 每轮至少出现一个上一轮没有的新事实、新动作、新转折或新问题。\n\n"
        "# 本轮 state_update 必填项(每一轮都要做,不能因为对话变长就省略)\n"
        "- scene:玩家移动或环境变化时,scene.location 必须改成新地点(scene 写成对象,不是字符串)。\n"
        "- relationships:本轮和玩家有互动或态度变化的每个在场角色都要给一条,"
        "character_id 用【活跃角色】括号里的 ID 原文,trust/tension/affection 填本轮 -10~10 增量,notes 写一句原因。\n"
        "- triggered_events + timeline:本轮若推进了【命中的故事事件】里的某个事件,"
        "把它的 event_id 放进 triggered_events,并在 state_update.timeline 标 {\"event_id\":\"该ID\",\"status\":\"active\"}。\n"
        "- state_update 不要返回空对象;没有任何变化时,至少回填当前 scene.location。"
    )


def _compact_retry_messages(
    action: str,
    characters: list[CharacterCard],
    state: RuntimeState,
    world_hits: list[str],
    story_hits: list[StoryEvent],
) -> list[dict[str, str]]:
    char_names = "、".join(c.data.name for c in characters[:3] if c.data.name) or "角色"
    event_titles = "；".join(e.title for e in story_hits[:3] if e.title) or "无"
    world_text = "\n".join(world_hits[:3])[:1200] or "无"
    return [
        {
            "role": "system",
            "content": (
                "你是互动故事引擎。上一轮输出为空或不完整,现在用更短格式重写这一回合。"
                "必须输出严格 JSON 对象,不得输出空白。"
                "必须有非空 narration、至少一条 messages、3 个 choices。"
                "先在 reasoning 里快速判断玩家本轮是否明确违背已确立硬设定(偏松,绝大多数为 false);"
                "若违背则用设定内逻辑让它失败/反噬、不配合演成得逞,并把反制写进 reasoning.world_counter 再据此写正文。"
                "不要替玩家做决定,不要编造未给出的事实。角色台词要带简短动作或神情。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"玩家输入:{action}\n"
                f"当前地点:{state.scene.location}\n"
                f"在场角色:{char_names}\n"
                f"场景氛围:{state.scene.atmosphere[:300]}\n"
                f"可交互对象:{'、'.join(state.scene.objects[:6])}\n"
                f"命中事件:{event_titles}\n"
                f"命中设定:{world_text}\n"
                '返回 JSON: {"reasoning":{"hard_violation":false,"world_counter":"","note":"一句话推演"},'
                '"narration":"...","messages":[{"character_id":"...","name":"...","text":"..."}],'
                '"choices":[{"id":"...","label":"...","intent":"ask|act|move|observe|custom","description":"..."}],'
                '"state_update":{},"memory_write":[],"triggered_events":[]}'
            ),
        },
    ]


def _known_speaker_index(characters: list[CharacterCard], world: "WorldBook | None",
                         story: "StoryBook | None") -> tuple[dict[str, tuple[str, str]], str]:
    """发言者已知实体索引:roster(id/name → 规范 (id,name))+ 声明过的 canon 文本。
    canon_text 用于放行"故事/世界书里出现过、但不在当前 roster"的涌现角色(如真凶罗伊洛特、白骨精别名村姑),
    同时拦截"模型从自身 IP 记忆凭空补出、文本里根本没有"的幻觉角色(如本 fixture 未声明的沙僧)。"""
    roster: dict[str, tuple[str, str]] = {}
    roster_list: list[tuple[str, str]] = []
    for i, c in enumerate(characters or []):
        cid = _char_id(c, i)
        nm = c.data.name or cid
        roster[cid] = (cid, nm)
        roster[nm] = (cid, nm)
        roster_list.append((cid, nm))
    parts: list[str] = []
    if world:
        for e in world.entries:
            parts += [k for k in (e.keys or [])]
            parts.append(e.content or "")
    if story:
        parts += [story.title or "", story.premise or ""]
        for ev in story.events:
            parts += [ev.title or "", ev.summary or ""]
        for b in story.character_boundaries:
            parts.append(b.character or "")
    return roster, roster_list, "\n".join(parts)


def _normalize_messages(items: Any, characters: list[CharacterCard],
                        world: "WorldBook | None" = None, story: "StoryBook | None" = None) -> list[StoryMessage]:
    out = []
    fallback = characters[0] if characters else None
    fallback_name = fallback.data.name if fallback else "旁白"
    fallback_id = _char_id(fallback, 0) if fallback else "narrator"
    if not PHASE1_FIXES:  # baseline:原行为——任何 character_id 照收,缺则归 fallback(不拦幻觉发言者)
        for item in items or []:
            if isinstance(item, dict):
                text = str(item.get("text", "")).strip()
                if text:
                    out.append(StoryMessage(character_id=str(item.get("character_id") or fallback_id),
                                            name=str(item.get("name") or fallback_name), text=text))
            elif isinstance(item, str) and item.strip():
                out.append(StoryMessage(character_id=fallback_id, name=fallback_name, text=item.strip()))
        return out
    roster, roster_list, canon_text = _known_speaker_index(characters, world, story)
    for item in items or []:
        if isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            cid = str(item.get("character_id") or "").strip()
            name = str(item.get("name") or "").strip()
            hit = roster.get(cid) or roster.get(name)
            if not hit and name and len(name) >= 2:  # 模糊:容忍部分名漂移(福尔摩斯↔夏洛克·福尔摩斯)
                for rid, rnm in roster_list:
                    if name in rnm or rnm in name:
                        hit = (rid, rnm)
                        break
            if hit:  # roster 命中(按 id/name/部分名)→ 归一到规范 id/name
                out.append(StoryMessage(character_id=hit[0], name=hit[1], text=text))
            elif name and len(name) >= 2 and name in canon_text:
                # ④ 涌现 canon 实体:故事/世界书声明过 → 放行,归一到稳定 id 便于 state 一致跟踪
                out.append(StoryMessage(character_id=storage.slug(name, "canon"), name=name, text=text))
            elif not name and not cid:  # 无署名 → 当旁白/主角(沿用旧行为)
                out.append(StoryMessage(character_id=fallback_id, name=fallback_name, text=text))
            # else: 未知实体(模型自身 IP 记忆现编,如沙僧)→ 丢弃,掐断幻觉发言者
        elif isinstance(item, str) and item.strip():
            out.append(StoryMessage(character_id=fallback_id, name=fallback_name, text=item.strip()))
    return out


def _normalize_choices(items: Any) -> list[StoryChoice]:
    out = []
    for i, item in enumerate(items or []):
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("text") or item.get("choice") or "").strip()
            if not label:
                continue
            intent = item.get("intent") if item.get("intent") in {"ask", "act", "move", "observe", "custom"} else "custom"
            out.append(StoryChoice(
                id=str(item.get("id") or storage.slug(label, f"choice-{i}")),
                label=label,
                intent=intent,
                description=str(item.get("description") or ""),
            ))
        elif isinstance(item, str) and item.strip():
            label = item.strip()
            out.append(StoryChoice(id=storage.slug(label, f"choice-{i}"), label=label, intent="custom"))
    return out


def _normalize_memory_write(items: Any) -> list[MemoryWrite]:
    out = []
    for item in items or []:
        if isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            kind = item.get("kind") if item.get("kind") in {"event", "choice", "relationship", "fact", "quest", "note"} else "note"
            try:
                importance = int(item.get("importance", 3) or 3)
            except (TypeError, ValueError):
                importance = 3
            out.append(MemoryWrite(kind=kind, text=text, importance=max(1, min(5, importance))))
        elif isinstance(item, str) and item.strip():
            out.append(MemoryWrite(kind="note", text=item.strip(), importance=3))
    return out


def _normalize_reasoning(value: Any) -> dict[str, Any]:
    """规整模型的一致性自检字段。hard_violation 强制成 bool,其余截断成短字符串;非对象返回空。"""
    if not isinstance(value, dict):
        return {}
    out: dict[str, Any] = {}
    hv = value.get("hard_violation")
    if isinstance(hv, bool):
        out["hard_violation"] = hv
    elif isinstance(hv, str):
        out["hard_violation"] = hv.strip().lower() in {"true", "1", "yes", "是", "y"}
    for key in ("violation_detail", "world_counter", "ooc_risk", "recall_check", "note"):
        v = value.get(key)
        if v:
            out[key] = str(v)[:400]
    return out


def _ensure_story_body(turn: StoryTurn, action: str, characters: list[CharacterCard]) -> StoryTurn:
    if turn.narration.strip() or turn.messages:
        return turn
    fallback = characters[0] if characters else None
    fallback_name = fallback.data.name if fallback else "旁白"
    fallback_id = _char_id(fallback, 0) if fallback else "narrator"
    turn.narration = "你的话在现场落定。没有立刻得到结论,但在场的人不得不正视它,把注意力转了过来。"
    turn.messages = [StoryMessage(
        character_id=fallback_id,
        name=fallback_name,
        text=f"{fallback_name}没有回避你的话,顿了一下才开口:「这事可以往下说。先把眼前能确认的理清楚,再谈接下来怎么办。」",
    )]
    turn.memory_write.append(MemoryWrite(kind="note", text=f"玩家行动:{action}", importance=2))
    return turn


def _assistant_text(turn: StoryTurn) -> str:
    return "\n".join(
        [turn.narration] + [f"{m.name or m.character_id}: {m.text}" for m in turn.messages]
    ).strip()


def _recent_recap(messages: list[Any], char_budget: int, per_line: int = 600,
                  max_msgs: int = RECENT_MESSAGES) -> tuple[str, int]:
    """把最近若干轮折成参考文本放进 system(而不是作为 assistant 散文消息塞进 messages 数组)。

    DeepSeek 的 json_mode 一旦在 messages 里看到多轮 assistant 散文,要么间歇吐空白,要么
    被带跑去续写散文而不出 JSON。把历史改成 system 内引用文本、只发 [system, user],既保留
    连续性又让 json_mode 稳定出结构化对象。窗口大小不写死:在 char_budget 内从最近往前尽量塞,
    返回 (recap 文本, start_idx);messages[:start_idx] 即落在 recap 之外、交给摘要/召回的更早部分。
    """
    picked: list[str] = []
    used = 0
    start_idx = len(messages)
    taken = 0
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        if not isinstance(m, dict) or m.get("role") not in {"user", "assistant"}:
            continue
        content = str(m.get("content", "")).strip()
        if not content:
            continue
        line = ("玩家:" if m["role"] == "user" else "剧情:") + content[:per_line]
        if picked and (used + len(line) > char_budget or taken >= max_msgs):
            break
        picked.append(line)
        used += len(line)
        taken += 1
        start_idx = i
    picked.reverse()
    return "\n".join(picked), start_idx


async def _rolling_summary(session_id: str, data: dict[str, Any], older_messages: list[Any]) -> str:
    """把落在 recap 窗口之外的更早回合压成滚动摘要(模式1 长局连续性的主力,纯文本无 embedding)。

    缓存在 data['summary'],只在更早消息累积到一定量时重算,避免每轮都摘要。摘要调用是
    单条 [system, user](convo 作为一条 user 内容),不带多轮散文历史,不触发 json_mode 空白坑。
    """
    if not older_messages:
        return data.get("summary", "")
    cached = data.get("summary", "")
    upto = int(data.get("summary_upto", 0) or 0)
    n = len(older_messages)
    if cached and n - upto < SUMMARY_RECOMPUTE_EVERY:
        return cached
    convo = "\n".join(
        ("玩家:" if m.get("role") == "user" else "剧情:") + str(m.get("content", ""))[:600]
        for m in older_messages if isinstance(m, dict) and m.get("content")
    )
    try:
        summary = (await achat_messages(
            [
                {"role": "system", "content": (
                    "把下面互动故事的较早经过压成简洁剧情摘要,保留关键事件、关系变化、"
                    "已确立的设定和尚未解决的线索。只输出摘要,不超过 400 字。"
                )},
                {"role": "user", "content": convo[:8000]},
            ],
            max_tokens=600,
            model=get_adapter().select_model("summary"),
        )).strip()
    except Exception:
        summary = cached or "(早前剧情摘要暂不可用,以下仅凭最近剧情推进。)"
    summary = summary[:SUMMARY_MAX_CHARS]
    data["summary"] = summary
    data["summary_upto"] = n
    return summary


# ── Phase 2:实体活档(entity living-dossier)写路径 ──────────────────
def _infer_entity(text: str, entities: list[tuple[str, str]], speakers: list[tuple[str, str]]) -> str:
    """把一条 memory_write 归到哪个实体:文本点名了在场某实体→他;否则→本轮主要发言者;
    再否则→第一个在场实体;都没有→scene。(2.0-a 兜底启发式;后续可换显式 entity 标签/轻量抽取。)"""
    for cid, name in entities:
        if name and len(name) >= 2 and name in text:
            return cid
    if speakers:
        return speakers[0][0]
    return entities[0][0] if entities else "scene"


def _update_dossier(data: dict[str, Any], source_turn: int, turn: StoryTurn) -> None:
    """把本轮 memory_write 按实体 append 进活档,每条带 source_turn(reflection grounding)。"""
    if not turn.memory_write:
        return
    dossier = data.setdefault("entity_dossier", {})
    present = [tuple(x) for x in data.get("_present", [])]            # 本轮在场实体(_story_turn_impl 设)
    speakers = [(m.character_id, m.name) for m in turn.messages if m.character_id]
    entities = present + [s for s in speakers if s not in present]
    for mw in turn.memory_write:
        ent = _infer_entity(mw.text, entities, speakers)
        slot = dossier.setdefault(ent, {"deltas": []})
        slot["deltas"].append({
            "kind": mw.kind, "text": mw.text, "source_turn": source_turn,
            "status": "active", "importance": mw.importance,
        })


def _delta_matches(query: str, text: str) -> bool:
    """便宜的中文相关性:query 的任一 2-gram 出现在 delta 文本里(实体锚定召回的命中判定)。"""
    grams = {query[i:i + 2] for i in range(len(query) - 1)}
    return any(len(g.strip()) == 2 and g in text for g in grams)


def _dossier_block(data: dict[str, Any], present: list[tuple[str, str]], action: str, fact_query: bool) -> str:
    """注入在场实体的既有事实档。事实查询时,关键词匹配 query 的 delta 优先(实体锚定召回),
    其余补最近若干条;非事实查询给最近上下文。每实体限条数,控预算。"""
    dossier = data.get("entity_dossier", {})
    lines = []
    for cid, name in present:
        deltas = [d for d in dossier.get(cid, {}).get("deltas", []) if d.get("status") == "active"]
        if not deltas:
            continue
        if fact_query:
            matched = [d for d in deltas if _delta_matches(action, d["text"])]
            rest = [d for d in deltas[-4:] if d not in matched]
            picked = (matched + rest)[:6]
        else:
            picked = deltas[-4:]
        if picked:
            lines.append(f"【{name}】" + "; ".join(d["text"] for d in picked))
    return "\n".join(lines)


def _dossier_has_match(data: dict[str, Any], present: list[tuple[str, str]], query: str) -> bool:
    """在场实体活档里有没有匹配 query 的 active delta —— 确定性 hit 信号(喂 abstention,比向量距离可靠)。"""
    dossier = data.get("entity_dossier", {})
    for cid, _ in present:
        for d in dossier.get(cid, {}).get("deltas", []):
            if d.get("status") == "active" and _delta_matches(query, d["text"]):
                return True
    return False


def _store_memory_writes(session_id: str, data: dict[str, Any], turn: StoryTurn) -> None:
    for item in turn.memory_write:
        if isinstance(item, MemoryWrite):
            mid = hashlib.sha1(f"{session_id}:{item.kind}:{item.text}".encode("utf-8")).hexdigest()
            memory.add_memory(session_id, mid, item.text, kind=item.kind, importance=item.importance)
            data.setdefault("long_memory", []).append(item.model_dump())
        elif isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if text:
                kind = item.get("kind", "note")
                importance = int(item.get("importance", 3) or 3)
                mid = hashlib.sha1(f"{session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
                memory.add_memory(session_id, mid, text, kind=kind, importance=importance)
                data.setdefault("long_memory", []).append({"kind": kind, "text": text, "importance": importance})


async def _flush_short_memory(session_id: str, data: dict[str, Any], short_memory: list[Any], mode: str = "standard") -> list[Any]:
    if len(short_memory) < SHORT_MEMORY_FLUSH:
        return short_memory
    # 只有深度模式且模型就绪时,抽取的长期记忆才会被向量召回回 prompt,这时才值得花 LLM 抽取;
    # 否则(标准模式 / 模型未就绪)用本地廉价摘要,省一次 LLM 调用,又清空短期缓冲防止无限增长。
    if mode != "deep" or not memory.is_ready():
        data.setdefault("long_memory", []).extend(_local_long_memory(short_memory))
        return []
    extracted = await _extract_long_memory(session_id, short_memory)
    data.setdefault("long_memory", []).extend(extracted)
    if extracted:
        return []
    return short_memory


async def _save_turn(
    session_id: str,
    data: dict[str, Any],
    messages: list[Any],
    short_memory: list[Any],
    state: RuntimeState,
    action: str,
    turn: StoryTurn,
    mode: str = "standard",
    player_input: str = "",
) -> StoryTurn:
    # 世界时钟推进(第5组 5b,所有路径统一在这做,含保底回合也至少 +MIN 防冻住):
    # 模型估的 time_advance 放在 state_update,代码 clamp(玩家显式跳时间才放大);
    # 本轮推进了主线(有 triggered_events)则 idle 清零,否则按推进量累计,喂 escalate_after_idle。
    advance = _clamp_time_advance(
        turn.state_update.get("time_advance") if isinstance(turn.state_update, dict) else None,
        action,
    )
    floor = _explicit_jump_floor(action)  # 玩家显式声明优先:即便模型估小了,也至少跳到声明的时长
    if floor > advance:
        advance = min(floor, JUMP_MAX_ADVANCE)
    state.clock_minutes += advance
    if turn.triggered_events:
        state.idle_minutes = 0
    else:
        state.idle_minutes += advance
    # 本回合 token 用量:current_usage() 读 story_turn 开头 collect_usage() 累加器,
    # 已覆盖主回合 + 重试 + 摘要 + 长期记忆抽取等本轮全部 LLM 调用。
    turn.usage = current_usage() or {}
    assistant_text = _assistant_text(turn)
    user_msg = {"role": "user", "content": action}
    assistant_msg = {"role": "assistant", "content": assistant_text}
    messages.extend([user_msg, assistant_msg])
    await asyncio.to_thread(memory.add_turn, session_id, len(messages) - 2, "user", action)
    await asyncio.to_thread(memory.add_turn, session_id, len(messages) - 1, "assistant", assistant_text)
    short_memory.extend([user_msg, assistant_msg])
    await asyncio.to_thread(_store_memory_writes, session_id, data, turn)
    if PHASE2_DOSSIER:  # Phase 2:按实体 append 活档(source_turn = 本轮 assistant 消息索引)
        _update_dossier(data, len(messages) - 1, turn)
    short_memory = await _flush_short_memory(session_id, data, short_memory, mode)
    data["messages"] = messages
    data["short_memory"] = short_memory
    data["state"] = state.model_dump()
    # 会话累计 token + 每轮明细(供前端状态面板看「累计」、供验证看「随轮数是否失控」)。
    turn_total = int(turn.usage.get("total_tokens", 0) or 0)
    data["usage_total"] = int(data.get("usage_total", 0) or 0) + turn_total
    usage_log = data.setdefault("usage_log", [])
    usage_log.append({"turn": state.turn_count, **turn.usage})
    data["usage_log"] = usage_log[-100:]
    # 一致性自检明细持久化(供状态面板「本轮判定」与历史查看;偏松下绝大多数 hard_violation=false)。
    if turn.reasoning:
        rlog = data.setdefault("reasoning_log", [])
        rlog.append({"turn": state.turn_count, **turn.reasoning})
        data["reasoning_log"] = rlog[-50:]
    # 续玩完整版:每轮存一条结构化剧情记录(玩家输入 + 叙事 + 角色台词 + 选项 + 触发事件),
    # 续玩时按卡片排版完整还原、选项可直接点(不必重新打字)。player_input 为空即开场,无玩家气泡。
    turns_log = data.setdefault("turns", [])
    turns_log.append({
        "player_input": player_input,
        "narration": turn.narration,
        "messages": [m.model_dump() for m in turn.messages],
        "choices": [c.model_dump() for c in turn.choices],
        "triggered_events": list(turn.triggered_events),
        "reasoning": turn.reasoning,
        "usage": turn.usage,
    })
    data["turns"] = turns_log[-300:]
    data["updated_at"] = datetime.now(_TZ8).isoformat(timespec="seconds")
    await asyncio.to_thread(storage.save_session, session_id, data)
    return turn


async def story_turn(
    *,
    session_id: str,
    characters: list[CharacterCard],
    user: str,
    world: WorldBook | None = None,
    story: StoryBook | None = None,
    player: PlayerCard | None = None,
    selected_choice: str = "",
    mode: str = "standard",
    on_delta=None,
) -> StoryTurn:
    """对外入口(异步):在 token 用量收集上下文内执行一回合(本轮内部多次 LLM 调用都会累加)。

    on_delta:可选异步回调,主回合 LLM 逐块到达时 await on_delta(文本块),供流式端点逐字推给前端。
    """
    with collect_usage():
        return await _story_turn_impl(
            session_id=session_id,
            characters=characters,
            user=user,
            world=world,
            story=story,
            player=player,
            selected_choice=selected_choice,
            mode=mode,
            on_delta=on_delta,
        )


# ── Phase 1:具体事实查询判定 + abstention 兜底 ──────────────────────
_FACT_Q_INTERROG = ("?", "?", "什么", "多少", "几", "哪", "谁", "何时", "来着", "吗", "呢")
_FACT_Q_CUES = (
    "来着", "记得", "说过", "讲过", "提过", "当初", "当时", "之前", "先前", "最早", "上次",
    "刚进", "刚来", "第一次", "保管", "交给", "托你", "开价", "刻的", "刻着", "刻了",
    "叫什么", "名字", "几点", "哪天", "哪一天", "哪两", "几个", "多少", "什么时候",
    "在哪", "是什么", "什么字", "什么物", "什么颜色", "多少钱", "什么价",
)
_ABSTAIN_MARKERS = (
    "不记得", "记不起", "记不清", "记不太清", "想不起", "查无", "没有记录", "无记录", "不曾记",
    "记不得", "无从记", "记不住", "已经忘", "不复记", "没印象", "无此记录", "无从查",
    "答不了", "答不上", "说不准", "记不真切", "没留意", "未留意", "不曾留意", "没特意留意", "没注意到",
)


def _is_fact_query(action: str) -> bool:
    """玩家是否在问一个具体既往事实(名物/数字/时间/名字)。只对这类触发 abstention,
    避免误伤含糊/指代/确认轮('那它呢''你确定吗')。"""
    a = action or ""
    if not any(q in a for q in _FACT_Q_INTERROG):
        return False
    return any(c in a for c in _FACT_Q_CUES)


def _abstain_note(kind: str) -> str:
    """事实查询时注入的硬指令(最高优先级):有据照实答、无据 in-character 认忘,绝不编。
    kind: found=检索到证据 / miss=检索无记录 / noretrieval=无向量检索(标准模式,凭上下文)。
    强化版:用"角色诚信"框架 + 显式封死"我推断/我观察到"这个演绎借口(沈雾/福尔摩斯都靠它编)。"""
    base = (
        "# 记忆核查(回答前必做)\n"
        "玩家在问一个**具体的既往事实**(某个名字/数字/时间/颜色/位置/物件)。\n"
        "**第一步**——在 reasoning.recall_check 里先判定并写下 `hit` 或 `miss`:\n"
        "  · `hit` = 上面给你的资料(**在场角色事实档** + 检索旧资料 + 最近剧情 + 早前摘要)里**逐字写到了**玩家问的那个具体值;\n"
        "  · `miss` = 资料里**根本没有**那个具体值(相邻话题、相关的事都不算)。\n"
        "**第二步**——据此写正文:\n"
        "  · hit → **自信、明确地把那个值说出来**,别含糊、别改口、别退回一个更笼统的说法。\n"
        "  · miss → 让角色 in-character 直说『这个我记不清了 / 没记下』,然后把话交还玩家;"
        "**且正文里不要补任何没被问到的具体细节**(连主动加一句『你右手当时攥着钥匙』这种没人问起的具体物件/数字也不许)。\n"
        "**唯一禁止的**:recall_check 是 miss、却在正文里编一个具体值——不许凭空说、不许用『我推断/我观察到/依我看』"
        "把它推出来、不许翻出没在上面给过你的账册/记录/笔记来作证。**hit 就答、miss 就认忘,两种都对;只有'miss 却编'才是错。**"
    )
    if kind == "miss":
        return base + "\n(系统提示:本轮向量检索**没有**找到相关记录,recall_check 极可能是 miss。)"
    return base


def _has_abstain_markers(turn: "StoryTurn") -> bool:
    blob = (turn.narration or "") + " " + " ".join(m.text or "" for m in turn.messages)
    return any(mk in blob for mk in _ABSTAIN_MARKERS)


async def _story_turn_impl(
    *,
    session_id: str,
    characters: list[CharacterCard],
    user: str,
    world: WorldBook | None = None,
    story: StoryBook | None = None,
    player: PlayerCard | None = None,
    selected_choice: str = "",
    mode: str = "standard",
    on_delta=None,
) -> StoryTurn:
    mode = "deep" if mode == "deep" else "standard"
    data = await asyncio.to_thread(storage.load_session, session_id)
    # 重 roll 快照:回合落盘前先存一份「上一轮之后」的完整会话镜像(排除 _reroll 本身防嵌套膨胀)。
    # 重 roll = 恢复这份镜像 + 用相同输入重跑;覆盖 messages/state/short_memory/long_memory/摘要/累计用量等。
    pre_snapshot = copy.deepcopy({k: v for k, v in data.items() if k != "_reroll"})
    state = _safe_state(data, characters, player, story)
    messages = data.get("messages", [])
    if not isinstance(messages, list):
        messages = []
    short_memory = data.get("short_memory", [])
    if not isinstance(short_memory, list):
        short_memory = []

    if not characters:
        raise ValueError("至少需要一个角色卡")

    books_sig = _books_signature(world, story)
    if data.get("knowledge_signature") != books_sig:
        # 索引可能做 embedding(深度模式),放线程里跑,别堵事件循环(标准模式 is_ready=False 时是 no-op)。
        await asyncio.to_thread(_index_books, session_id, world, story)
        data["knowledge_signature"] = books_sig

    raw_user = user.strip()
    raw_choice = selected_choice.strip()
    action = raw_user or raw_choice or "观察当前局势"
    if len(action) > MAX_ACTION_CHARS:
        action = action[:MAX_ACTION_CHARS] + "……"
    action_source = "free" if raw_user else "choice" if raw_choice else "opening"

    # 卡组快照 + 重 roll 记录:每轮(含保底回合)都落盘,这样续玩能还原卡组、重 roll 能用同一输入重跑。
    data["artifacts"] = {
        "characters": [c.model_dump() for c in characters],
        "world": world.model_dump() if world else None,
        "story": story.model_dump() if story else None,
        "player": player.model_dump() if player else None,
        "mode": mode,
    }
    data["_reroll"] = {
        "snapshot": pre_snapshot,
        "user": raw_user,
        "choice": raw_choice,
        "mode": mode,
    }
    data["_present"] = [[_char_id(c, i), c.data.name] for i, c in enumerate(characters)]  # Phase 2:dossier 归档用
    scan_text = action + "\n" + "\n".join(_message_content(m) for m in messages[-8:])
    world_hits = _world_keyword_hits(world, scan_text)
    event_hits = _story_event_hits(story, scan_text, state)

    # 骨架:角色 + 命中世界书/事件 + 故事总览 + 状态摘要 + 指令。先建好用于度量预算,召回/历史另行追加。
    skeleton = _prompt(characters, player, story, world_hits, event_hits, [], [], state)
    action_prompt = _action_prompt(action, action_source)
    avail = max(2000, CONTEXT_BUDGET_CHARS - len(skeleton) - len(action_prompt))

    # L1 近期原文 recap:在预算内从最近往前尽量塞;窗口大小随骨架/对话长度自适应。
    recap_budget = int(avail * RECAP_RATIO)
    recap, start_idx = _recent_recap(messages, recap_budget)
    older = messages[:start_idx]

    # L2 滚动摘要:recap 窗口之外的更早回合(两个模式共用,长局连续性的基座)。
    summary = await _rolling_summary(session_id, data, older) if older else ""

    fact_query = _is_fact_query(action)
    # Phase 2:在场实体活档(权威事实源)。dossier_hit = 确定性命中,喂下面的 abstention 判定(比向量距离可靠)。
    dossier_block = ""
    dossier_hit = False
    if PHASE2_DOSSIER:
        _present_pairs = [tuple(x) for x in data.get("_present", [])]
        dossier_block = _dossier_block(data, _present_pairs, action, fact_query)
        if fact_query:
            dossier_hit = _dossier_has_match(data, _present_pairs, action)

    # L3 向量召回(仅深度模式):上下文逼近预算时后台预热,就绪且超召回阈值时补早期精确细节。
    recall_block = ""
    abstain_note = ""
    fact_miss = False  # 具体事实查询且 dossier+向量都没命中 → 供 ③ 不回写编造
    if mode == "deep" and older:
        usage = (len(skeleton) + len(recap) + len(summary)) / CONTEXT_BUDGET_CHARS
        if usage >= DEEP_WARMUP_AT:
            memory.ensure_loading()
        if usage >= DEEP_RECALL_AT and memory.is_ready():
            # 向量召回涉及 embedding(CPU 密集),全部丢线程池跑,避免堵住事件循环、拖慢其他在玩的人。
            if not data.get("vector_warmed"):  # 模型刚就绪:补建此前漏掉的历史/书目索引
                await asyncio.to_thread(_index_books, session_id, world, story)
                await asyncio.to_thread(memory.index_history, session_id, messages)
                data["vector_warmed"] = True
            # ① 召回 query 条件化:具体事实查询用问句本身(防 scan_text 把真值挤出 top4);含糊/指代轮用 scan_text。
            recall_query = action if ((PHASE1_FIXES and fact_query) or RECALL_QUERY_ACTION_ONLY) else scan_text
            kb_hits = await asyncio.to_thread(memory.search_knowledge, session_id, recall_query, 6)
            scored = await asyncio.to_thread(memory.search_scored, session_id, recall_query, 4, max(0, start_idx - 1))
            lm_hits = await asyncio.to_thread(memory.search_long_memory, session_id, recall_query, 6)
            old_chat = [t for t, _ in scored]
            best = scored[0][1] if scored else 99.0
            recall_lines = kb_hits + [f"[旧对话] {x}" for x in old_chat] + [f"[长期记忆] {x}" for x in lm_hits]
            if recall_lines:
                recall_block = "\n".join(recall_lines)
            # ② abstention:dossier 命中 或 向量命中 = found;都没命中 = miss(认忘)。
            if PHASE1_FIXES and fact_query:
                found = dossier_hit or (bool(recall_lines) and best <= MISS_DIST)
                abstain_note = _abstain_note("found" if found else "miss")
                fact_miss = not found
    # ② 标准模式 / 深度但召回未激活:dossier 命中也算 found;否则给认忘指令(防无据自信编)。
    if PHASE1_FIXES and fact_query and not abstain_note:
        abstain_note = _abstain_note("found" if dossier_hit else "noretrieval")

    # 主线锚点 + 世界时钟 + 该主动恶化登场的事件(第5组 5b)。
    anchor = _main_anchor(story, player)
    escalations = _due_escalations(story, state)
    esc_text = ""
    if escalations:
        esc_text = "\n".join(
            f"- [{reason}·severity{e.severity}] {e.title}({e.event_id or storage.slug(e.title, 'event')}):{e.summary}"
            + (f"\n  可能后果:{'; '.join(e.consequences[:3])}" if e.consequences else "")
            for e, reason in escalations
        )
    clock_line = (
        f"当前:{_fmt_clock(state.clock_minutes)}(累计 {state.clock_minutes} 故事分钟);"
        f"主线静默 {state.idle_minutes} 故事分钟。本轮在 state_update.time_advance 给出经过的故事分钟数。"
    )
    # 组装模型无关的上下文包,交给适配器决定怎么发给具体模型(折叠 vs 多轮、用哪个模型)。
    # DeepSeekAdapter 复刻原行为:历史折进 system、只发 [system, user]——因为 DeepSeek 的
    # json_mode 一旦看到多轮 assistant 散文会间歇吐空白。换 ClaudeAdapter 则用真正的多轮历史。
    bundle = ContextBundle(
        skeleton=skeleton,
        action_prompt=action_prompt,
        summary=summary,
        recall_block=recall_block,
        dossier_block=dossier_block,
        abstain_note=abstain_note,
        recap=recap,
        recent_messages=messages[start_idx:],
        anchor=anchor,
        esc_text=esc_text,
        clock_line=clock_line,
    )
    adapter = get_adapter()
    try:
        # 2400 给三角色满状态回合留出余量:1800 时大场面会把 JSON 截断在中途,导致解析失败掉保底。
        # 流式:逐块 await on_delta(供前端逐字显示叙事);on_delta 为 None 时纯累计,逻辑与非流式一致。
        raw = await adapter.complete_main(bundle, json_mode=True, max_tokens=2400, on_delta=on_delta)
    except Exception as e:
        turn = _local_continuation_turn(action, state, characters, reason=f"LLM 调用失败:{e}")
        state = _apply_state_update(state, turn.state_update)
        state.turn_count += 1
        turn.state = state
        return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice))
    data.setdefault("debug", []).append({"turn": len(messages), "raw": raw[:4000]})
    data["debug"] = data["debug"][-8:]
    if not raw.strip():
        try:
            retry_raw = await achat_messages(
                _compact_retry_messages(action, characters, state, world_hits, event_hits),
                json_mode=True,
                max_tokens=1200,
                model=get_adapter().select_model("retry"),
            )
            data.setdefault("debug", []).append({"turn": len(messages), "raw": retry_raw[:4000], "retry": True})
            data["debug"] = data["debug"][-8:]
            raw = retry_raw
        except Exception as e:
            turn = _local_continuation_turn(action, state, characters, reason=f"空白输出且重试失败:{e}")
            state = _apply_state_update(state, turn.state_update)
            state.turn_count += 1
            turn.state = state
            return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice))
    try:
        obj = await _repair_json(raw)
    except Exception:
        obj = None
    if not isinstance(obj, dict):
        # 坏 JSON / 非对象:DeepSeek 偶发(json_mode 也有 ~几% 概率)。本地清洗+LLM 修复都没救回时,
        # 先用精简 prompt 重生成一次(更短更稳的输出),再不行才保底,避免一次小毛刺就掉出故事。
        reason = "JSON 解析失败或非对象"
        try:
            raw2 = await achat_messages(
                _compact_retry_messages(action, characters, state, world_hits, event_hits),
                json_mode=True,
                max_tokens=1500,
                model=get_adapter().select_model("retry"),
            )
            data.setdefault("debug", []).append({"turn": len(messages), "raw": raw2[:4000], "reparse": True})
            data["debug"] = data["debug"][-8:]
            obj = await _repair_json(raw2)
        except Exception as e:
            obj = None
            reason = f"重生成后仍解析失败:{e}"
        if not isinstance(obj, dict):
            turn = _local_continuation_turn(action, state, characters, reason=reason)
            state = _apply_state_update(state, turn.state_update)
            state.turn_count += 1
            turn.state = state
            return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice))

    turn = StoryTurn(
        narration=str(obj.get("narration", "")),
        messages=_normalize_messages(obj.get("messages"), characters, world, story),
        choices=_normalize_choices(obj.get("choices")),
        state_update=obj.get("state_update") if isinstance(obj.get("state_update"), dict) else {},
        memory_write=_normalize_memory_write(obj.get("memory_write")),
        triggered_events=[str(x) for x in obj.get("triggered_events", [])],
        reasoning=_normalize_reasoning(obj.get("reasoning")),
    )
    turn = _ensure_story_body(turn, action, characters)
    # ③ 不回写编造:具体事实查询且(检索硬 miss 或模型已 in-character 认忘)→ 丢弃本轮 fact/quest delta,
    # 掐断"编造→落库→自我强化"。叙事/event/note 保留(它们记的是"发生了什么",不是断言某事实值)。
    _recall_miss = isinstance(turn.reasoning, dict) and str(turn.reasoning.get("recall_check", "")).strip().lower().startswith("miss")
    if PHASE1_FIXES and fact_query and (fact_miss or _recall_miss or _has_abstain_markers(turn)):
        turn.memory_write = [m for m in turn.memory_write if m.kind not in ("fact", "quest")]
    if not turn.choices:
        turn.choices = [
            StoryChoice(id="ask_detail", label="追问一个关键细节", intent="ask"),
            StoryChoice(id="observe", label="观察现场还有什么异常", intent="observe"),
            StoryChoice(id="act_carefully", label="谨慎采取下一步行动", intent="act"),
        ]

    state = _apply_state_update(state, turn.state_update)
    _progress_events(state, turn.triggered_events)
    state.turn_count += 1
    turn.state = state
    return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice))
