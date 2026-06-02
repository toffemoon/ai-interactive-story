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
from .llm import achat_messages, achat_messages_stream, chat_messages, collect_usage, current_usage
from .models import (
    CharacterCard,
    EntityDossier,
    EventTimelineItem,
    FactBoundary,
    MemoryWrite,
    PersonaVersion,
    PlayerCard,
    RelationshipState,
    RuntimeState,
    StoryBook,
    StoryChoice,
    StoryEvent,
    StoryMessage,
    StoryTurn,
    StructuredFact,
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


# 长程记忆 A 档:玩家实体在记忆里的规范键(玩家没有 char_block,单独注入到玩家设定块)。
_PLAYER_ENTITY = "__player__"
# 长程记忆 B① 区域召回:地点实体规范键前缀(与角色 cid / 玩家键区分,避免撞键)。
_LOC_PREFIX = "loc:"


def _norm_entity(s: Any) -> str:
    """实体别名归一:去空白 + 小写,供受限词表匹配(角色名/ID、玩家名都先过这里)。"""
    return str(s or "").strip().lower()


def _entity_roster(characters: list[CharacterCard], player: PlayerCard | None,
                   world: WorldBook | None = None, story: StoryBook | None = None,
                   state: RuntimeState | None = None) -> tuple[dict[str, str], list[str]]:
    """受限词表:返回 (别名→规范键 的映射, 给 prompt 看的可读标签列表)。

    角色:名字 / character_id 两个别名都映射到该角色的 cid;玩家:玩家名 / "玩家" → _PLAYER_ENTITY;
    地点(B①):已知地点别名 → loc 键(见 `_location_aliases`)。
    模型给 memory_write.entity 选了表外的值(自由发挥)就清空,不让它挂错实体。
    召回时 present_characters / 当前所在地 也过这张表解析成同一个规范键,确保挂载与召回对得上。
    """
    roster: dict[str, str] = {}
    labels: list[str] = []
    for i, c in enumerate(characters):
        cid = _char_id(c, i)
        roster[_norm_entity(cid)] = cid
        if c.data.name:
            roster[_norm_entity(c.data.name)] = cid
        labels.append(f"{c.data.name or cid}={cid}")
    if player and player.name:
        roster[_norm_entity(player.name)] = _PLAYER_ENTITY
        roster[_norm_entity("玩家")] = _PLAYER_ENTITY
        labels.append(f"{player.name}=玩家")
    # 地点别名:撞到角色别名时让角色优先(setdefault),避免地名盖掉同名角色。
    loc_roster, loc_labels = _location_aliases(world, story, state)
    for k, v in loc_roster.items():
        roster.setdefault(k, v)
    labels.extend(loc_labels)
    return roster, labels


def _present_entity_keys(state: RuntimeState, characters: list[CharacterCard],
                         roster: dict[str, str]) -> set[str]:
    """本轮在场实体的规范键集合:present_characters(角色名)解析成 cid;空时回退到全部角色卡。"""
    present_names = state.scene.present_characters or [c.data.name for c in characters]
    keys: set[str] = set()
    for n in present_names:
        k = roster.get(_norm_entity(n))
        if k and k != _PLAYER_ENTITY:
            keys.add(k)
    return keys


def _entity_memory_index(long_memory: list[Any], wanted: set[str],
                         per_entity: int = 6) -> dict[str, list[str]]:
    """从会话 long_memory 里取 entity ∈ wanted 的条目,按实体分组(每实体保留最近 per_entity 条)。

    这是 A 档的确定性召回:不靠相似度,只要实体在场就必然把挂在它身上的派生事实取出来。
    两个记忆模式都走这里(数据落在会话 JSON,不依赖 embedding)。
    """
    by_entity: dict[str, list[str]] = {}
    for item in long_memory or []:
        if not isinstance(item, dict):
            continue
        ent = str(item.get("entity", "") or "")
        if not ent or ent not in wanted:
            continue
        text = str(item.get("text", "") or "").strip()
        if not text:
            continue
        kind = item.get("kind", "note")
        by_entity.setdefault(ent, []).append(f"[{kind}] {text}")
    return {ent: lines[-per_entity:] for ent, lines in by_entity.items()}


# ── 长程记忆 B① 区域/实体召回:把 A 的「按在场角色召回」扩到地点 ──

def _loc_key(name: Any) -> str:
    """地点规范键:loc: + slug。"""
    return _LOC_PREFIX + storage.slug(str(name or ""), "loc")


def _location_aliases(world: WorldBook | None, story: StoryBook | None,
                      state: RuntimeState | None) -> tuple[dict[str, str], list[str]]:
    """已知地点的受限词表:(别名→loc 键, 可读标签)。

    来源:世界书 source=='location' 的条目 + 故事事件 location + 当前 scene/player 所在地。
    当前所在地每轮都进表,所以「挂在此地」与「回到此地召回」用同一个 loc 键对得上。
    诚实局限:scene.location 是模型自由文本,同一地点两次措辞不同(正厅 vs 听雪山庄正厅)键就不同、会漏召回;
    固定来源(世界书/故事)地名稳定,能把模型往规范地名上引。"""
    roster: dict[str, str] = {}
    labels: list[str] = []
    seen: set[str] = set()

    # 占位/默认地点不当真实地点实体(否则默认 player.location="未定地点" 会污染词表 + 误召回)。
    placeholders = {"未定地点", "未定时间", "故事开场", "现场", "未知", "未知地点", "未定", "-"}

    def add(name: Any) -> None:
        nm = str(name or "").strip()
        if not nm or nm in placeholders:
            return
        key = _loc_key(nm)
        roster.setdefault(_norm_entity(nm), key)
        roster.setdefault(_norm_entity(key), key)  # loc 键自映射(同 cid:既是键也是值),两条抽取路径都对得上
        if key not in seen:
            labels.append(f"{nm}={key}")
            seen.add(key)

    if world:
        for e in world.entries:
            if getattr(e, "source", "") == "location":
                add(e.comment or (e.keys[0] if e.keys else ""))
    if story:
        for ev in story.events:
            add(ev.location)
    if state:
        add(state.scene.location)
        add(state.player.location)
    return roster, labels


def _present_location_keys(state: RuntimeState, roster: dict[str, str]) -> set[str]:
    """本轮在场地点的规范键:玩家当前所在地 + 场景地点,解析成 loc 键(命中受限词表才算)。"""
    keys: set[str] = set()
    for loc in (state.scene.location, state.player.location):
        k = roster.get(_norm_entity(loc))
        if k and k.startswith(_LOC_PREFIX):
            keys.add(k)
    return keys


# ── 长程记忆 B② · 实体活档 + 人格 versioning(整块换版,作者谓词触发,不逐轮改) ──

def _init_dossiers(characters: list[CharacterCard]) -> list[EntityDossier]:
    """开局给每个角色建实体活档:v1 画像 = 上传卡(既作不可变基线,又作当前版本)。"""
    out = []
    for i, c in enumerate(characters):
        cid = _char_id(c, i)
        v1 = PersonaVersion(version=1, personality=c.data.personality,
                            speech_rules=list(c.data.speech_rules), description=c.data.description,
                            committed_turn=0, reason="上传卡(基线)")
        out.append(EntityDossier(entity=cid, baseline=v1.model_copy(deep=True),
                                 persona_versions=[v1], current_version=1))
    return out


def _dossier_for(state: RuntimeState, cid: str) -> EntityDossier | None:
    return next((d for d in state.dossiers if d.entity == cid), None)


def _current_persona(dossier: EntityDossier | None) -> PersonaVersion | None:
    """活档当前生效的人格版本(char_block / OOC 以此为准,不对初始卡也不对活值)。"""
    if not dossier or not dossier.persona_versions:
        return None
    cur = next((v for v in dossier.persona_versions if v.version == dossier.current_version), None)
    return cur or dossier.persona_versions[-1]


def _check_persona_shifts(story: StoryBook | None, characters: list[CharacterCard],
                          state: RuntimeState) -> list[str]:
    """作者预定义人格切版:谓词满足→给目标角色 append 新画像版本并切到它(整块换、append-only、旧版保留)。
    复用 ending 谓词(required_events 全 resolved + required_facts 全 revealed)。每个 shift 只触发一次。
    返回本轮切版说明(供日志/调试)。绝不逐轮 delta 改人格、绝不靠模型自动改写——那是设计明令的最高风险操作。"""
    if not story or not story.persona_shifts or not state.dossiers:
        return []
    name2cid: dict[str, str] = {}
    for i, c in enumerate(characters):
        cid = _char_id(c, i)
        name2cid[_norm_entity(cid)] = cid
        if c.data.name:
            name2cid[_norm_entity(c.data.name)] = cid
    resolved = {t.event_id for t in state.timeline if t.status == "resolved"}
    revealed = list(state.facts.revealed)
    changed: list[str] = []
    for idx, sh in enumerate(story.persona_shifts):
        cid = name2cid.get(_norm_entity(sh.character))
        dossier = _dossier_for(state, cid) if cid else None
        if not dossier:
            continue
        req_ev = [x for x in (sh.required_events or []) if x]
        req_fa = [x for x in (sh.required_facts or []) if x]
        if not req_ev and not req_fa:
            continue  # 无谓词的切版不自动触发,防误切
        if not (all(x in resolved for x in req_ev) and all(any(x in r for r in revealed) for x in req_fa)):
            continue
        marker = sh.reason or f"persona_shift#{idx}:{sh.character}"
        if any(v.reason == marker for v in dossier.persona_versions):
            continue  # 这个 shift 已切过,不重复
        base = _current_persona(dossier)
        new_ver = dossier.current_version + 1
        pv = PersonaVersion(
            version=new_ver,
            personality=sh.new_personality or (base.personality if base else ""),
            speech_rules=list(sh.new_speech_rules) if sh.new_speech_rules else (list(base.speech_rules) if base else []),
            description=sh.new_description or (base.description if base else ""),
            committed_turn=state.turn_count,
            reason=marker,
        )
        dossier.persona_versions.append(pv)
        dossier.current_version = new_ver
        changed.append(f"{cid}→v{new_ver}({marker})")
    return changed


def _record_persona_proposal(state: RuntimeState, turn: StoryTurn) -> None:
    """模型若在 state_update.persona_proposal 提议某角色发生【本性/人格】持久转变,只记录进
    state.persona_proposals 供作者复审——【绝不】据此自动改人格(设计§五:涌现自动改写是全系统最高
    风险操作,留作 B④ consolidation 高闸门 + 作者在环)。情绪波动/一时冲动不算,模型被要求只在跨多轮的
    本性转变时才提。"""
    su = turn.state_update if isinstance(turn.state_update, dict) else {}
    prop = su.get("persona_proposal")
    if isinstance(prop, dict):
        prop = [prop]
    if not isinstance(prop, list):
        return
    for p in prop:
        if not isinstance(p, dict):
            continue
        ch = str(p.get("character", "") or "").strip()
        obs = str(p.get("observation") or p.get("note") or "").strip()
        if ch and obs:
            state.persona_proposals.append({"turn": state.turn_count, "character": ch[:40], "observation": obs[:300]})
    state.persona_proposals = state.persona_proposals[-30:]


# ── 长程记忆 B③ · canon 结构化:扁平事实 → 挂实体 + 标派生(扁平表保留作兼容) ──

def _infer_fact_entity(text: str, roster: dict[str, str]) -> str:
    """从事实文本推断它主要关乎的实体:命中受限词表里某实体别名(取最长别名,防子串误挂)就挂上,否则 global("")。"""
    if not text or not roster:
        return ""
    low = text.lower()
    best_alias, best_key = "", ""
    for alias, key in roster.items():
        if alias and alias in low and len(alias) > len(best_alias):
            best_alias, best_key = alias, key
    return best_key


def _migrate_structured_facts(state: RuntimeState, roster: dict[str, str]) -> None:
    """老存档迁移:structured 为空但扁平表有内容→据扁平表建结构化(实体推断,derived=False 当基线)。
    幂等(structured 非空即跳过);向后兼容,扁平表不动。"""
    fb = state.facts
    if fb.structured:
        return
    for status in ("canon", "revealed", "uncertain", "hidden"):
        for text in getattr(fb, status, []) or []:
            t = str(text).strip()
            if t:
                fb.structured.append(StructuredFact(text=t, entity=_infer_fact_entity(t, roster),
                                                    status=status, derived=False, source_turn=0))


def _ingest_structured_facts(state: RuntimeState, update_facts: Any, roster: dict[str, str], turn: int) -> None:
    """本轮模型在 state_update.facts 写的新事实→结构化入库(实体推断,derived=True 玩出来的派生 canon)。
    去重(同 status+文本不重复);扁平表由 _apply_state_update 另行维护;结构化层封顶止血(精炼/消解是 B④)。"""
    if not isinstance(update_facts, dict):
        return
    fb = state.facts
    seen = {(s.status, s.text.strip()) for s in fb.structured}
    for status in ("canon", "revealed", "uncertain", "hidden"):
        for text in _as_text_list(update_facts.get(status)):
            t = text.strip()
            if t and (status, t) not in seen:
                fb.structured.append(StructuredFact(text=t, entity=_infer_fact_entity(t, roster),
                                                    status=status, derived=True, source_turn=turn))
                seen.add((status, t))
    if len(fb.structured) > 200:
        fb.structured = fb.structured[-200:]


def _entity_canon_index(structured: list[Any], wanted: set[str], per_entity: int = 5) -> dict[str, list[str]]:
    """按在场实体取挂在它身上的结构化 canon 事实(隐藏/未披露的不注入正文),分组、每实体封顶。"""
    by: dict[str, list[str]] = {}
    for f in structured or []:
        ent = getattr(f, "entity", "")
        status = getattr(f, "status", "revealed")
        text = (getattr(f, "text", "") or "").strip()
        # B④:已取代(superseded)的事实不再注入正文;隐藏未披露的也不进正文
        if not ent or ent not in wanted or not text or status == "hidden" or getattr(f, "superseded", False):
            continue
        tag = "派生" if getattr(f, "derived", False) else "设定"
        conf = getattr(f, "confidence", "med")
        mark = f"{tag}·{status}" + ("·已巩固" if getattr(f, "consolidated", False) else "")
        by.setdefault(ent, []).append(f"[{mark}] {text}")
    return {k: v[-per_entity:] for k, v in by.items()}


def _strip_fact_tag(s: str) -> str:
    """去掉 "[xxx] " 前缀,取正文,用于跨来源(A 记忆 / B③ canon)去重比对。"""
    return s.split("] ", 1)[-1].strip() if s.startswith("[") else s.strip()


# ── 长程记忆 B④ · consolidation(把原始 note 精炼成结构化 delta + 消解矛盾,防幻觉) ──

CONSOLIDATE_MIN_NOTES = 3      # 某实体原始 note 少于这个数不值得 consolidate
CONSOLIDATE_RETURN_GAP_H = 6   # updated_at 距今超过这么多小时 → 判定"用户回来了"→回来时批量精炼


def _bigrams(s: str) -> set[str]:
    s = re.sub(r"\s+", "", str(s or ""))
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) >= 2 else ({s} if s else set())


def _grounded(text: str, material: str, thresh: float = 0.5) -> bool:
    """防幻觉守卫:delta 文本的 2-gram 必须有足够比例出现在原始材料里,否则视为模型凭空编造、丢弃。
    挡得住"原始材料没有的人名/数字/事件"被新造出来(纯新增内容 2-gram 重叠会很低)。"""
    bt = _bigrams(text)
    if not bt:
        return False
    return len(bt & _bigrams(material)) / len(bt) >= thresh


def _entity_label(key: str, characters: list[CharacterCard]) -> str:
    """实体规范键→给 consolidation prompt 看的可读名。"""
    if key == _PLAYER_ENTITY:
        return "玩家"
    if key.startswith(_LOC_PREFIX):
        return "地点:" + key[len(_LOC_PREFIX):]
    for i, c in enumerate(characters):
        if _char_id(c, i) == key:
            return c.data.name or key
    return key


async def _consolidate_entity(label: str, raw_notes: list[str], existing_texts: list[str]) -> list[dict]:
    """把某实体的【原始记录】精炼成结构化 delta;只整理给定材料、绝不新增(防幻觉),并标出取代了哪些既有事实。
    返回 [{text,type,confidence,supersedes:[...]}];每条都过 grounding 守卫(无原始依据的丢弃)。"""
    raw_notes = [t for t in (raw_notes or []) if t.strip()]
    if len(raw_notes) < CONSOLIDATE_MIN_NOTES:
        return []
    material = "\n".join(f"- {t}" for t in raw_notes)
    existing = "\n".join(f"- {t}" for t in (existing_texts or [])) or "(无)"
    sys = (
        "你是长期记忆管理员。把【原始记录】里关于该实体的内容精炼成若干条结构化事实 delta。\n"
        "硬规则:\n"
        "1. 只能基于【原始记录】整理 / 去重 / 归并,【绝对禁止】新增任何原始记录里没出现过的信息——"
        "人名、数字、地点、事件、关系一律不许编造或推断超出材料的内容。宁可少写,不可臆造。\n"
        "2. 若某条新事实与【既有事实】里某条就同一属性发生冲突(新旧矛盾),在该 delta 的 supersedes 数组里"
        "列出被它取代的那条既有事实的原文。\n"
        "3. 每条标 type(设定=往后长期生效的属性/规则;事实=发生过的具体事件)与 confidence"
        "(原始记录明确肯定=high;带'可能/或许/存疑/不确定'=low;其余=med)。text 要短、自包含、第三人称。\n"
        '输出 JSON:{"deltas":[{"text":"...","type":"设定|事实","confidence":"high|med|low","supersedes":["被取代的既有事实原文"]}]};'
        "没有值得沉淀的就给空数组 deltas:[]。"
    )
    user = f"实体:{label}\n\n【既有事实】\n{existing}\n\n【原始记录】\n{material}"
    obj = None
    for _attempt in range(3):  # DeepSeek/v4-pro json_mode 偶发吐空白,多重试两次兜住(同主回合套路)
        try:
            raw = await achat_messages([{"role": "system", "content": sys}, {"role": "user", "content": user}],
                                       json_mode=True, max_tokens=900)
            if raw and raw.strip():
                obj = _json_obj(raw)
                if isinstance(obj, dict):
                    break
        except Exception:
            obj = None
    if not isinstance(obj, dict):
        return []
    out = []
    for d in obj.get("deltas", []) if isinstance(obj, dict) else []:
        if not isinstance(d, dict):
            continue
        text = str(d.get("text", "")).strip()
        if not text or not _grounded(text, material):  # 防幻觉:必须有原始材料依据,否则丢
            continue
        out.append({
            "text": text,
            "type": d.get("type") if d.get("type") in {"设定", "事实"} else "事实",
            "confidence": d.get("confidence") if d.get("confidence") in {"high", "med", "low"} else "med",
            "supersedes": [str(s).strip() for s in (d.get("supersedes") or []) if str(s).strip()],
        })
    return out


def _apply_consolidation(state: RuntimeState, entity_key: str, deltas: list[dict], turn: int) -> int:
    """把 consolidation 产出的 delta 落进 state.facts.structured:消解矛盾(取代旧的)+ 去重 + 入新。返回新增条数。"""
    fb = state.facts
    applied = 0
    for d in deltas:
        # 矛盾消解:把同实体、未取代、与 supersedes 文本互相包含的既有事实标记为已取代
        for old in d.get("supersedes", []):
            no = _norm_entity(old)
            if not no:
                continue
            for f in fb.structured:
                if f.entity == entity_key and not f.superseded:
                    nf = _norm_entity(f.text)
                    if nf and (no in nf or nf in no):
                        f.superseded = True
        status = "canon" if d["type"] == "设定" else "revealed"
        dup = next((f for f in fb.structured if f.entity == entity_key and not f.superseded
                    and _norm_entity(f.text) == _norm_entity(d["text"])), None)
        if dup:  # 已有同一条:只升级为已巩固 + 更新置信,不重复入库
            dup.consolidated = True
            dup.confidence = d["confidence"]
            continue
        fb.structured.append(StructuredFact(text=d["text"], entity=entity_key, status=status, derived=True,
                                            source_turn=turn, confidence=d["confidence"], consolidated=True))
        applied += 1
    if len(fb.structured) > 200:
        fb.structured = fb.structured[-200:]
    return applied


async def _consolidate_entities(state: RuntimeState, long_memory: list[Any], entity_keys: set[str],
                                turn: int, characters: list[CharacterCard]) -> list[str]:
    """对给定实体各跑一次 consolidation(原始 note 取自 A 的 entity-tagged long_memory)。
    贵活,只在事件触发 / 回来时批量调,不每轮跑。返回日志。"""
    log = []
    for key in entity_keys:
        raw = [str(m.get("text", "")).strip() for m in (long_memory or [])
               if isinstance(m, dict) and m.get("entity") == key and str(m.get("text", "")).strip()]
        if len(raw) < CONSOLIDATE_MIN_NOTES:
            continue
        existing = [f.text for f in state.facts.structured if f.entity == key and not f.superseded]
        deltas = await _consolidate_entity(_entity_label(key, characters), raw[-12:], existing[-10:])
        if deltas:
            n = _apply_consolidation(state, key, deltas, turn)
            log.append(f"{_entity_label(key, characters)}:+{n}")
    return log


def _hours_since(iso_ts: str) -> float:
    """data.updated_at(北京时间 ISO)距今多少小时;解析失败返回 0(不触发回来时批量)。"""
    if not iso_ts:
        return 0.0
    try:
        prev = datetime.fromisoformat(iso_ts)
        now = datetime.now(_TZ8)
        return (now - prev).total_seconds() / 3600.0
    except Exception:
        return 0.0


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
    first_names = [c.data.name for c in characters]
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
    state.dossiers = _init_dossiers(characters)  # B②:开局建实体活档,v1 画像=上传卡
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
    for key in ("location", "atmosphere"):  # time 不再由 LLM 写,统一在 _save_turn 由权威时钟渲染(根治显示倒退)
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
            v = rel.get(key)
            if not isinstance(v, int):
                continue
            cur = getattr(existing, key)
            # prompt 要求填本轮 -10~10 增量;模型常误填成绝对值(实测见 -120 / 单轮 +33)。
            # |v|>20 视为模型给了绝对读数:朝该值收敛(每轮最多移动 10),不叠加、不瞬间撞 ±100 饱和。
            if abs(v) > 20:
                target = max(-100, min(100, v))
                cur += max(-10, min(10, target - cur))
            else:
                cur += v
            setattr(existing, key, max(-100, min(100, cur)))
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
    # 主线结案标记 + 已达成结局。**只有模型同时给出某个具名结局 ID 时才认作"达成结局"并锁 main_resolved**——
    # 否则 /quit、软性"先休整"这类无具名结局的退出会被旧的单向闩锁误锁成结案、永久污染整局(R3 实测 bug)。
    new_endings = [eid for eid in (_as_text_list(update.get("reached_ending")) + _as_text_list(update.get("reached_endings"))) if eid]
    for eid in new_endings:
        if eid not in state.reached_endings:
            state.reached_endings.append(eid)
    if update.get("main_resolved") is True and (new_endings or state.reached_endings):
        state.main_resolved = True
    return state


def _check_ending_predicates(story: StoryBook | None, state: RuntimeState) -> None:
    """代码侧客观判定结局:某 ending 的 required_events 全部 resolved + required_facts 全部 revealed
    → 强制达成(置 main_resolved + 记 ending_id),把"是否达成"从模型主观里拿出来。
    向后兼容:两个谓词都空的 ending 跳过 → 回退到模型在 state_update 里给 main_resolved 的判定。"""
    if not story or state.main_resolved:
        return
    resolved = {t.event_id for t in state.timeline if t.status == "resolved"}
    revealed = list(state.facts.revealed)
    for e in story.endings:
        req_ev = [x for x in (e.required_events or []) if x]
        req_fa = [x for x in (e.required_facts or []) if x]
        if not req_ev and not req_fa:
            continue
        if all(x in resolved for x in req_ev) and all(any(x in r for r in revealed) for x in req_fa):
            eid = e.ending_id or storage.slug(e.title, "ending")
            if eid not in state.reached_endings:
                state.reached_endings.append(eid)
            state.main_resolved = True
            return


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


async def _extract_long_memory(session_id: str, short_items: list[dict],
                               roster: dict[str, str] | None = None,
                               entity_labels: list[str] | None = None) -> list[dict]:
    roster = roster or {}
    convo = "\n".join(
        f"{m.get('role','?')}:{m.get('content','')}" if isinstance(m, dict) else str(m)
        for m in short_items
    )
    # 实体轴:给模型一份受限的实体名册,让它【从中选】每条记忆挂在哪个实体上(不自由发挥)。
    roster_hint = (
        "为每条记忆标注它主要关乎的实体(entity),只能从下面名册里【选一个等号右边的值】填进 entity;"
        "关乎玩家就填'玩家',关乎某地点就填名册里该地点对应的 loc: 值;"
        "不明确关乎名册里任一实体就留空字符串。\n名册:" + "; ".join(entity_labels or [])
        if entity_labels else "entity 一律留空字符串。"
    )
    try:
        raw = await achat_messages(
            [
                {
                    "role": "system",
                    "content": (
                        "从下面互动故事对话中抽取长期记忆。输出 JSON:"
                        '{"items":[{"kind":"event|choice|relationship|fact|quest|note","text":"...","importance":1-5,"entity":"实体或空"}]}。'
                        "只保留会影响后续剧情、关系、事实边界或任务的内容。" + roster_hint
                    ),
                },
                {"role": "user", "content": convo},
            ],
            json_mode=True,
            max_tokens=1024,
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
            entity = roster.get(_norm_entity(item.get("entity")), "")  # 落在受限词表才算数,否则清空
        else:
            text = str(item).strip()
            kind = "note"
            importance = 3
            entity = ""
        if not text:
            continue
        mid = hashlib.sha1(f"{session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
        await asyncio.to_thread(memory.add_memory, session_id, mid, text, kind=kind,
                                importance=importance, entity=entity)
        out.append({"kind": kind, "text": text, "importance": importance, "entity": entity})
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
    # 容许"X单位 …(几个字)… 过去/过完/没了"(如"一周就这么过去了""三天稀里糊涂过去了"):
    (rf"{_NUM}\s*个?\s*月[^,。;!?\n]{{0,5}}?(?:过去|过完|没了|溜走)", 43200),
    (rf"{_NUM}\s*(?:周|星期|礼拜)[^,。;!?\n]{{0,5}}?(?:过去|过完|没了|溜走)", 10080),
    (rf"{_NUM}\s*天[^,。;!?\n]{{0,5}}?(?:过去|过完|没了|溜走)", 1440),
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
    entity_memory: dict[str, list[str]] | None = None,
) -> str:
    entity_memory = entity_memory or {}
    char_blocks = []
    for i, card in enumerate(characters):
        d = card.data
        cid = _char_id(card, i)
        # 长程记忆 B②:角色实力/性格/口吻按【实体活档当前画像版本】渲染(arc 演变后用演变版,不一直拿初始卡)。
        # 没活档(老存档)或没切过版就等于初始卡。OOC 自检对照的就是这里展示的当前版本。
        persona = _current_persona(_dossier_for(state, cid))
        personality = persona.personality if persona else d.personality
        speech_rules = persona.speech_rules if persona else d.speech_rules
        description = persona.description if persona else d.description
        ver_tag = f"(当前画像 v{persona.version}:{persona.reason})" if persona and persona.version > 1 else ""
        rules = "\n".join(f"- {r}" for r in speech_rules)
        block = (
            f"## {d.name} ({cid}){ver_tag}\n"
            f"设定:{description}\n性格:{personality}\n情境:{d.scenario}\n"
            f"范例:{d.mes_example}\n说话硬规则:\n{rules}\n"
            "主动性要求:根据该角色的身份、性格、利益和当前情境主动反应。"
            "可以追问、打断、试探、拒绝、转移压力、提出条件或推进自己的小目标。"
        )
        # 长程记忆 A 档:该角色在场 → 把挂在它身上的派生事实/记忆确定性注入它自己的块(不靠相似度)。
        ent_lines = entity_memory.get(cid)
        if ent_lines:
            block += (
                "\n关于该角色的既有事实/记忆(此前剧情里确立、必须保持一致,不要与之矛盾):\n"
                + "\n".join(f"- {x}" for x in ent_lines)
            )
        char_blocks.append(block)
    # 单角色"场景":判断依据是本轮实际在场的角色数(运行时),不是上传了几张卡。
    # 多角色卡组里和某个角色单独相处的段落也会触发——那种段落最容易退化成一问一答的聊天。
    present = [p for p in (state.scene.present_characters or [c.data.name for c in characters]) if p]
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
            "条件没满足就别硬塞,继续保自由度。"
            "但反过来同样重要:一旦你判断某结局条件【已经满足】、或剧情已抵达该结局对应的决定性时刻"
            "(摊牌/开门/真相揭晓/对决的那一刻),就在【本轮】把那一刻真正写出来、让它发生,并按下方规则标记结局——"
            "不要再插入'最后一步之前的最后一步'式的前置流程(又一道开锁、又一次嗅探、又一遍确认)把它无限拖延。"
            "玩家可以反复逼近某个高潮,你要么给出实质阻力推迟它、要么就让它发生,但不能用换皮的同义前置步骤原地空耗):\n"
            + endings_text
        )
        parts.append(
            "角色信息边界(隐藏项在未披露前角色不能说出;硬上限不可被玩家单方面突破,"
            "玩家若强行突破按世界观硬约束走世界内反制):\n" + bounds_text
        )
        story_overview = "\n".join(parts)
    # 长程记忆 A 档:挂在玩家身上的派生事实(玩家没有 char_block,玩家恒在场 → 始终注入到玩家设定块)。
    player_mem_lines = entity_memory.get(_PLAYER_ENTITY)
    player_mem_block = ""
    if player_mem_lines:
        player_mem_block = (
            "\n关于玩家的既有事实/记忆(此前剧情里确立、必须保持一致):\n"
            + "\n".join(f"- {x}" for x in player_mem_lines)
        )
    # 长程记忆 B① 区域召回:挂在当前所在地点上的派生事实(地点无 char_block,注入到运行状态旁的地点块)。
    loc_mem_lines = [x for k, lines in entity_memory.items() if k.startswith(_LOC_PREFIX) for x in lines]
    location_mem_block = ""
    if loc_mem_lines:
        location_mem_block = (
            "\n\n# 当前地点的既有事实/记忆(此前在玩家当前所在地确立、回到此地必须保持一致)\n"
            + "\n".join(f"- {x}" for x in loc_mem_lines[:8])
        )
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
        "推进要有实质进展:不要每轮只把同一处线索、同一个动作越描越细而场景/主线/关系零变化。"
        "玩家持续投入时,调查要真的产出新结论、新位置、新关系或新揭示,而不是无限细分同一个发现、反复确认同一件事、"
        "或让角色用换皮的同义台词把玩家原地留住。一条线索调查充分了就给出它的结论并打开下一步,别在原地空转。\n"
        "每轮必须先生成故事正文,再给 3-4 个玩家行动选项;选项不能替代正文。"
        "narration 必须非空,messages 至少包含一条角色对玩家本轮输入的反应。"
        "玩家可能使用口语、玩梗或不严肃报价,仍要当作故事内行动处理,由角色自然回应。\n\n"
        f"# 活跃角色\n{chr(10).join(char_blocks)}\n\n"
        f"# 玩家设定\n{json.dumps(player.model_dump(), ensure_ascii=False) if player else '未提供'}{player_mem_block}\n\n"
        f"# 故事书总览\n{story_overview}\n\n"
        f"# 当前运行状态\n{json.dumps(_state_digest(state), ensure_ascii=False)}{location_mem_block}\n\n"
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
        "(被无理由神化或恶堕)。判断 OOC 的基准是【活跃角色】里该角色当前展示的画像(性格/说话规则)——"
        "若标了'当前画像 vN'说明该角色的人格已随剧情演变到这一版,就按这一版判一致性,不要拿它最初的样子当 OOC 依据。"
        "只在 reasoning.ooc_risk 里简短记录、并据此让角色保持一致;不要为此强行打断或拒绝玩家的正常行动,灰色地带给玩家自由。\n"
        "3. 人格转变提案(只提议,不自己改):若你观察到某角色正在经历【跨多轮的、有充分铺垫的本性/价值观转变】"
        "(不是一时情绪或单轮冲动),把它写进 state_update.persona_proposal {\"character\":\"角色ID\",\"observation\":\"什么转变、依据\"},"
        "作为给作者的【建议】。你【绝不】自行改写该角色的性格/说话方式——人格只能由作者预设的转变条件来切换。本轮仍按当前画像演。\n"
        "# 世界时钟(每轮必做)\n"
        "- 在 state_update.time_advance 填本轮经过的【故事内分钟数】:平常对话/调查给小值(几分钟到一两小时);"
        "玩家明确跳时间就给对应大值并在叙事里真的跳过去:一夜≈600,一天=1440,三天=4320,一周=10080,一个月≈43200。\n"
        "- 已到点/主线停滞而被列入【该主动恶化登场的事件】的,要让世界或相关角色主动把它推到玩家面前"
        "(催促、施压、事态升级),别等玩家来碰;玩家本轮正面处理了就把它推进或标 resolved。\n"
        "- 当主线核心问题已解决、或某结局触发条件已满足:state_update 标 main_resolved:true,"
        "并把对应结局 ID 填进 reached_ending,叙事给出收束(之后玩家仍可自由游玩尾声)。\n"
        "  硬性要求:标 main_resolved:true 时【必须】同时在 reached_ending 给出上面【可能结局】列表里某个具名结局的 ID;"
        "若没有任何具名结局的条件真正满足、填不出 ID,就【不要】标 main_resolved(宁可继续故事)。两者必须成对出现。\n"
        "  注意:玩家发 /quit、'退出'、'结束游戏'、'不玩了' 这类【游戏外的退出指令】不是故事内的结局意图,"
        "不要据此标 main_resolved 或写'先休整'式软收尾;按普通输入在故事内轻处理(角色困惑/确认)即可。\n"
        "  关键:如果你在 reasoning 里已经判定关键揭示/结果/结局发生了(例如'箱子里是X''真相是Y''证据链已闭合、该摊牌了'),"
        "就【必须】把这个揭示/结果在【本轮 narration】里实际写出来、并据此标记结局,绝不允许只把它留在 reasoning.note 里、"
        "而 narration 继续停在揭示之前的一步。reasoning 判定本轮要发生的事,正文这一轮就要让它发生。\n"
        "  结局握手(重要):当玩家明确表达要结束/做个了断/推进到结局/揭晓真相/做最终决定,"
        "且关键证据或某结局的触发条件已实质齐备时,把这当成【玩家授权你拍板收尾】——你要【自己沿当前剧情最受支持的那条结局路径,"
        "把高潮和结果直接写进 narration 并置 main_resolved:true + reached_ending】,这不算替玩家做决定(是玩家主动委托收尾)。"
        "此时绝不能再把'三选一/你来定/你选哪条'这类同一道选择菜单重复抛回给玩家让剧情原地停摆。"
        "玩家可以反复表达想结束;你每一次要么用世界内的实质阻力说明为何还结不了(并真的推进一步、改变局面),"
        "要么就替他落子、把结局写出来并标记,二者必居其一,不许用换皮的同义待选菜单空耗一轮。\n"
        "- 玩家已达成的目标放进 state_update.player.completed_goals(会从当前目标里移除)。\n\n"
        "# 记忆挂载(memory_write,关乎长期一致性)\n"
        "本轮若玩出了会长期生效的新事实/关系/承诺/能力变化,写进 memory_write。每条尽量挂到它主要关乎的实体上:\n"
        "- entity 优先从上面【活跃角色】括号里的角色 ID 原文里选(例如 写 大黑塔 的 ID),关乎玩家就填'玩家';\n"
        "  若这条事实主要关乎某个【地点】(尤其玩家当前所在地,见运行状态 scene.location:某地藏了什么、发生过什么、有何机关/规矩),"
        "就把 entity 填成那个地点名(用 scene.location 的原文,别另起新名);\n"
        "  挂不上名册里任何具体角色/玩家/地点(纯氛围/无关琐事)就把 entity 留成空字符串\"\"。不要自己发明名册外的实体名。\n"
        "- 这条挂载决定了【该实体(角色/玩家/地点)下次在场或玩家再到该地点时,这条记忆会被必然取回注入】,"
        "所以关乎某角色长期设定/状态、或某地点固有事实的内容务必挂上它。\n\n"
        "输出严格 JSON,只输出这一个对象,格式:\n"
        "{"
        '"reasoning":{"hard_violation":false,"violation_detail":"","world_counter":"","ooc_risk":"","note":"一句话推演"},'
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
        '"main_resolved":false,"reached_ending":"",'
        '"persona_proposal":null'
        "},"
        '"memory_write":[{"kind":"event|choice|relationship|fact|quest|note","text":"...", "importance":1-5, "entity":"该记忆关乎的角色ID/玩家/地点名(用scene.location原文),挂不上留空"}],'
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
    char_names = "、".join(c.data.name for c in characters if c.data.name) or "角色"
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


def _normalize_messages(items: Any, characters: list[CharacterCard]) -> list[StoryMessage]:
    out = []
    fallback = characters[0] if characters else None
    fallback_name = fallback.data.name if fallback else "旁白"
    fallback_id = _char_id(fallback, 0) if fallback else "narrator"
    for item in items or []:
        if isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if text:
                out.append(StoryMessage(
                    character_id=str(item.get("character_id") or fallback_id),
                    name=str(item.get("name") or fallback_name),
                    text=text,
                ))
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


def _normalize_memory_write(items: Any, roster: dict[str, str] | None = None) -> list[MemoryWrite]:
    roster = roster or {}
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
            # 实体轴:模型给的 entity 必须落在受限词表里(角色名/ID),否则清空不让它自由发挥挂错。
            entity = roster.get(_norm_entity(item.get("entity")), "")
            out.append(MemoryWrite(kind=kind, text=text, importance=max(1, min(5, importance)), entity=entity))
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
    for key in ("violation_detail", "world_counter", "ooc_risk", "note"):
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
        )).strip()
    except Exception:
        summary = cached or "(早前剧情摘要暂不可用,以下仅凭最近剧情推进。)"
    summary = summary[:SUMMARY_MAX_CHARS]
    data["summary"] = summary
    data["summary_upto"] = n
    return summary


def _store_memory_writes(session_id: str, data: dict[str, Any], turn: StoryTurn) -> None:
    for item in turn.memory_write:
        if isinstance(item, MemoryWrite):
            mid = hashlib.sha1(f"{session_id}:{item.kind}:{item.text}".encode("utf-8")).hexdigest()
            # entity 落进向量表 meta(深度模式相似召回 / 后续按实体检索);model_dump 已带 entity,
            # 会进会话 JSON long_memory —— 确定性的「按在场实体召回」从那里取(两模式都生效)。
            memory.add_memory(session_id, mid, item.text, kind=item.kind,
                              importance=item.importance, entity=item.entity)
            data.setdefault("long_memory", []).append(item.model_dump())
        elif isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            if text:
                kind = item.get("kind", "note")
                importance = int(item.get("importance", 3) or 3)
                entity = str(item.get("entity", "") or "")
                mid = hashlib.sha1(f"{session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
                memory.add_memory(session_id, mid, text, kind=kind, importance=importance, entity=entity)
                data.setdefault("long_memory", []).append(
                    {"kind": kind, "text": text, "importance": importance, "entity": entity})


async def _flush_short_memory(session_id: str, data: dict[str, Any], short_memory: list[Any],
                              mode: str = "standard", roster: dict[str, str] | None = None,
                              entity_labels: list[str] | None = None) -> list[Any]:
    if len(short_memory) < SHORT_MEMORY_FLUSH:
        return short_memory
    # 只有深度模式且模型就绪时,抽取的长期记忆才会被向量召回回 prompt,这时才值得花 LLM 抽取;
    # 否则(标准模式 / 模型未就绪)用本地廉价摘要,省一次 LLM 调用,又清空短期缓冲防止无限增长。
    if mode != "deep" or not memory.is_ready():
        data.setdefault("long_memory", []).extend(_local_long_memory(short_memory))
        return []
    extracted = await _extract_long_memory(session_id, short_memory, roster, entity_labels)
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
    roster: dict[str, str] | None = None,
    entity_labels: list[str] | None = None,
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
    # 玩家可见的故事内时间由权威 clock_minutes 渲染(LLM 不再自由写 scene.time),根治显示串倒退/乱跳(R2/R4/R5)。
    state.scene.time = _fmt_clock(state.clock_minutes)
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
    short_memory = await _flush_short_memory(session_id, data, short_memory, mode, roster, entity_labels)
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
    if not state.dossiers and characters:  # B②:老存档(无活档)懒初始化,v1 画像=当前卡
        state.dossiers = _init_dossiers(characters)
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
    scan_text = action + "\n" + "\n".join(_message_content(m) for m in messages[-8:])
    world_hits = _world_keyword_hits(world, scan_text)
    event_hits = _story_event_hits(story, scan_text, state)

    # 长程记忆 A 档 + B① 区域召回:受限实体词表(角色 + 玩家 + 地点)+ 按在场实体/地点确定性召回。
    # roster 用于抽取/规整 memory_write.entity(挂载侧);entity_memory 把挂在「本轮在场角色 + 玩家 + 当前所在地」
    # 身上的派生事实从会话 long_memory 里确定性取出,注入对应角色/玩家/地点块(standard+deep 都生效,不靠相似度)。
    roster, ent_labels = _entity_roster(characters, player, world, story, state)
    _migrate_structured_facts(state, roster)  # B③:老存档把扁平 facts 迁成结构化(幂等)
    wanted_keys = _present_entity_keys(state, characters, roster) | _present_location_keys(state, roster)
    if player and player.name:
        wanted_keys.add(_PLAYER_ENTITY)  # 玩家恒在场,挂玩家的记忆始终注入
    # B④ consolidation 触发器3「回来时批量精炼」:updated_at 距今超阈值→判定用户回来了,
    # 对在场实体把原始 note 精炼成结构化 delta(消解矛盾),consolidated_upto 水位线防重复精炼旧的。
    if _hours_since(data.get("updated_at", "")) >= CONSOLIDATE_RETURN_GAP_H:
        lm_all = data.get("long_memory", []) or []
        upto = int(data.get("consolidated_upto", 0) or 0)
        if len(lm_all) > upto:
            clog = await _consolidate_entities(state, lm_all, wanted_keys, state.turn_count, characters)
            data["consolidated_upto"] = len(lm_all)
            if clog:
                data.setdefault("consolidation_log", []).append({"turn": state.turn_count, "trigger": "return", "ent": clog})
                data["consolidation_log"] = data["consolidation_log"][-50:]
    entity_memory = _entity_memory_index(data.get("long_memory", []), wanted_keys)
    # B③:把挂在在场实体身上的结构化 canon 事实并进实体注入(与 A 记忆同块,跨来源去重、封顶)。
    for ent, canon_lines in _entity_canon_index(state.facts.structured, wanted_keys).items():
        cur = entity_memory.get(ent, [])
        bodies = {_norm_entity(_strip_fact_tag(x)) for x in cur}
        for ln in canon_lines:
            if _norm_entity(_strip_fact_tag(ln)) not in bodies:
                cur.append(ln); bodies.add(_norm_entity(_strip_fact_tag(ln)))
        entity_memory[ent] = cur[-8:]

    # 骨架:角色 + 命中世界书/事件 + 故事总览 + 状态摘要 + 指令。先建好用于度量预算,召回/历史另行追加。
    skeleton = _prompt(characters, player, story, world_hits, event_hits, [], [], state, entity_memory)
    action_prompt = _action_prompt(action, action_source)
    avail = max(2000, CONTEXT_BUDGET_CHARS - len(skeleton) - len(action_prompt))

    # L1 近期原文 recap:在预算内从最近往前尽量塞;窗口大小随骨架/对话长度自适应。
    recap_budget = int(avail * RECAP_RATIO)
    recap, start_idx = _recent_recap(messages, recap_budget)
    older = messages[:start_idx]

    # L2 滚动摘要:recap 窗口之外的更早回合(两个模式共用,长局连续性的基座)。
    summary = await _rolling_summary(session_id, data, older) if older else ""

    # L3 向量召回(仅深度模式):上下文逼近预算时后台预热,就绪且超召回阈值时补早期精确细节。
    recall_block = ""
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
            kb_hits = await asyncio.to_thread(memory.search_knowledge, session_id, scan_text, 6)
            old_chat = await asyncio.to_thread(memory.search, session_id, scan_text, 4, max(0, start_idx - 1))
            lm_hits = await asyncio.to_thread(memory.search_long_memory, session_id, scan_text, 6)
            recall_lines = kb_hits + [f"[旧对话] {x}" for x in old_chat] + [f"[长期记忆] {x}" for x in lm_hits]
            if recall_lines:
                recall_block = "\n".join(recall_lines)

    system = skeleton
    if summary:
        system += "\n\n# 早前剧情摘要(更久之前发生的事,已压缩)\n" + summary
    if recall_block:
        system += "\n\n# 检索到的相关旧资料(向量召回,供参考,不要照抄)\n" + recall_block
    if recap:
        system += (
            "\n\n# 最近剧情(最近若干轮的实际经过,供你延续上下文与口吻)\n" + recap +
            "\n\n注意:以上是历史参考。最后一轮是你刚生成的——本轮绝不要重复它的叙述或台词;"
            "即便玩家这轮的意图和上一轮相同,也要让剧情往前走一步,给出新动作/新事实/新转折。"
        )
    # 主线锚点 + 世界时钟 + 该主动恶化登场的事件(第5组 5b)。
    anchor = _main_anchor(story, player)
    if anchor:
        system += "\n\n# 主线锚点(始终牢记,别被支线噪音带偏)\n" + anchor
    escalations = _due_escalations(story, state)
    if escalations:
        esc_text = "\n".join(
            f"- [{reason}·severity{e.severity}] {e.title}({e.event_id or storage.slug(e.title, 'event')}):{e.summary}"
            + (f"\n  可能后果:{'; '.join(e.consequences[:3])}" if e.consequences else "")
            for e, reason in escalations
        )
        system += (
            "\n\n# 该主动恶化登场的事件(故事内时间到点 / 主线停滞过久——让世界或相关角色主动把它推给玩家,"
            "别等玩家来碰;玩家本轮正面处理了就把它推进或在 timeline 标 resolved)\n" + esc_text
        )
    system += (
        f"\n\n# 故事内时钟\n当前:{_fmt_clock(state.clock_minutes)}(累计 {state.clock_minutes} 故事分钟);"
        f"主线静默 {state.idle_minutes} 故事分钟。本轮在 state_update.time_advance 给出经过的故事分钟数。"
    )
    # 只发 [system, user]:不把散文历史作为 assistant 消息塞进数组,否则 DeepSeek 的 json_mode
    # 会间歇吐空白(带散文历史时几乎必现)。历史已折进 system 上方的「最近剧情」。
    llm_messages = [{"role": "system", "content": system}, {"role": "user", "content": action_prompt}]
    try:
        # 2400 给三角色满状态回合留出余量:1800 时大场面会把 JSON 截断在中途,导致解析失败掉保底。
        # 流式:逐块 await on_delta(供前端逐字显示叙事);on_delta 为 None 时纯累计,逻辑与非流式一致。
        raw = await achat_messages_stream(llm_messages, json_mode=True, max_tokens=2400, on_delta=on_delta)
    except Exception as e:
        turn = _local_continuation_turn(action, state, characters, reason=f"LLM 调用失败:{e}")
        state = _apply_state_update(state, turn.state_update)
        state.turn_count += 1
        turn.state = state
        return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
    data.setdefault("debug", []).append({"turn": len(messages), "raw": raw[:4000]})
    data["debug"] = data["debug"][-8:]
    if not raw.strip():
        try:
            retry_raw = await achat_messages(
                _compact_retry_messages(action, characters, state, world_hits, event_hits),
                json_mode=True,
                max_tokens=1200,
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
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
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
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)

    turn = StoryTurn(
        narration=str(obj.get("narration", "")),
        messages=_normalize_messages(obj.get("messages"), characters),
        choices=_normalize_choices(obj.get("choices")),
        state_update=obj.get("state_update") if isinstance(obj.get("state_update"), dict) else {},
        memory_write=_normalize_memory_write(obj.get("memory_write"), roster),
        triggered_events=[str(x) for x in obj.get("triggered_events", [])],
        reasoning=_normalize_reasoning(obj.get("reasoning")),
    )
    turn = _ensure_story_body(turn, action, characters)
    if not turn.choices:
        turn.choices = [
            StoryChoice(id="ask_detail", label="追问一个关键细节", intent="ask"),
            StoryChoice(id="observe", label="观察现场还有什么异常", intent="observe"),
            StoryChoice(id="act_carefully", label="谨慎采取下一步行动", intent="act"),
        ]

    resolved_before = {t.event_id for t in state.timeline if t.status == "resolved"}  # B④:本轮前已结案事件
    state = _apply_state_update(state, turn.state_update)
    _ingest_structured_facts(state, turn.state_update.get("facts") if isinstance(turn.state_update, dict) else None,
                             roster, state.turn_count)  # B③:本轮新事实结构化入库(挂实体+标派生)
    _progress_events(state, turn.triggered_events)
    _check_ending_predicates(story, state)  # 谓词齐备即代码侧客观达成结局(无谓词的故事回退模型判定)
    persona_changed = _check_persona_shifts(story, characters, state)  # B②:作者谓词触发的人格切版
    if persona_changed:
        data.setdefault("persona_log", []).append({"turn": state.turn_count, "shifts": persona_changed})
        data["persona_log"] = data["persona_log"][-50:]
    _record_persona_proposal(state, turn)  # B②:模型提的涌现转变只记录、不自动落(作者在环)
    # B④ consolidation 触发器2「事件触发」:本轮有故事事件被推进到 resolved → 对受影响实体(该事件角色+地点)
    # 做一次小巩固(原始 note→结构化 delta + 消解矛盾)。高信号、只在结案时跑,不每轮跑。
    newly_resolved = {t.event_id for t in state.timeline if t.status == "resolved"} - resolved_before
    if newly_resolved and story:
        affected: set[str] = set()
        for ev in story.events:
            eid = ev.event_id or storage.slug(ev.title, "event")
            if eid in newly_resolved:
                for nm in ev.characters:
                    if roster.get(_norm_entity(nm)):
                        affected.add(roster[_norm_entity(nm)])
                if ev.location and roster.get(_norm_entity(ev.location)):
                    affected.add(roster[_norm_entity(ev.location)])
        if affected:
            clog = await _consolidate_entities(state, data.get("long_memory", []), affected, state.turn_count, characters)
            if clog:
                data.setdefault("consolidation_log", []).append({"turn": state.turn_count, "trigger": "event", "ent": clog})
                data["consolidation_log"] = data["consolidation_log"][-50:]
    state.turn_count += 1
    turn.state = state
    return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
