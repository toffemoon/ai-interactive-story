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
from .lang import L, is_zh
from .adapters import ContextBundle, get_adapter
from .llm import (
    DeferredLLMControl,
    achat_messages,
    achat_messages_stream,
    chat_messages,
    collect_usage,
    current_usage,
)
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
DEEP_AUTO_CHAR_COUNT = 5       # 角色卡数 > 此值(即 ≥6,群像剧)自动进深度模式:上下文消耗大,需滚动摘要/consolidation/向量召回兜底
SMALL_CAST = 3                 # 卡数 ≤ 此值:开局全员在场、卡全量注入、谁都能开口(旧行为,三张卡的老故事不变)。
                               # 卡数 > 此值:在场由引擎记(scene.cast_tracked)——开局按故事书第一个事件的角色,
                               # 不在场的卡只留一行、不能开口,进出场靠模型改写 present_characters(2026-10-27 诡秘长测)
RECAP_FULL_MSGS = 4            # 近期原文保底:最近这么多条(2 回合)全文进 recap,不受预算和单条截断限制。
                               # 10 张卡的骨架 5 万字远超预算时,旧逻辑只剩 1400 字、每回合截 600 字,台词整段丢失
RECALL_QUERY_ACTION_ONLY = False  # 实验门控:向量召回 query 强制仅用当前问句(默认 False:按 _is_fact_query 条件化)
MISS_DIST = 0.45               # abstention:具体事实查询时 top1 余弦距离 > 此值 = 检索无相关记录(硬 NOT_FOUND 兜底)
PHASE1_FIXES = True            # Phase 1 总开关(runner 置 False 跑 baseline 对照 / 也是 prod kill-switch):
                              # off = 无①召回条件化 / ②abstention / ③不回写编造 / ④发言者已知实体门
PHASE3_KNOWERS = True          # Phase 3 知识边界开关(runner 置 False 跑 baseline 对照):
                              # on = 派生事实记 knowers(建立轮在场实体+玩家)/ 召回按发言角色过滤(knower 轴)/
                              #      认忘扩到"不是你的记录"(缺席角色被问具体往事→in-character 认忘,不借叙事真相)。
                              # canon(角色卡/世界书/故事书)= 公共知识,人人可知,不受此过滤。
ANTI_AI_STYLE = True           # 叙事「去 AI 味」开关(prod kill-switch):on=注入反 AI 写作规则(具体动作替代
                              # 概括、不堆排比内心戏、不替读者总结情绪、疲劳词软提示不硬禁)。承 Yufei 去AI味提案。

# 输出语言(2026-10-23 站点切英文):面向玩家的文本一律英文;结构化字段(ID / 卡上名字 / 枚举)原文照抄,
# 否则 _normalize_messages 的发言者门、roster 匹配、present_characters 解析会对不上(翻译过的名字会被当幻觉丢弃)。
OUTPUT_LANGUAGE_RULE = (
    "OUTPUT LANGUAGE: English. Write every player-facing text value — narration, messages[].text, choices[].label and description, "
    "the text values in state_update (scene location/time/atmosphere/objects, player status/goals/inventory, relationship notes, facts), "
    "memory_write[].text and reasoning — in natural, fluent English, even when the character cards, lore, story book or earlier history "
    "are written in Chinese or another language (translate their content as you use it). Never output Chinese prose. "
    "Exception — copy these exactly as given, never translate or romanize them: JSON keys, enum values, character_id, entity, event_id, "
    "reached_ending, and character names in messages[].name and scene.present_characters (use the exact name text from the cards). "
    "Inside prose you may render a non-English name in a consistent romanized/English form."
)

# 世界时钟(故事内分钟):模型每轮估 time_advance,代码 clamp。
MIN_TIME_ADVANCE = 1           # 每轮至少推进的故事分钟,防时钟冻住
NATURAL_MAX_ADVANCE = 180      # 自然推进上限(3 故事小时);玩家没显式跳时间时按此 clamp,防乱估
JUMP_MAX_ADVANCE = 60 * 1440   # 玩家显式跳时间时的单轮上限(60 故事天;够跳"一个月后"这类声明)
SKIP_MAX_ADVANCE = 16 * 60     # 模型写明 time_skip(等到天亮、赶一段长路)时的单轮上限
# 玩家显式声明时间跳跃的词:命中则允许大跳(取模型估计,clamp 到 JUMP_MAX)。
_JUMP_WORDS = re.compile(
    r"第二天|第三天|次日|翌日|隔天|过了一?[天夜晚]|明天|明日|昨天|前一?天|"
    r"一[周星]期后|几[天周月]后|\d+\s*[天周月]后|\d+\s*(?:个)?(?:小时|钟头)后|"
    r"半天后|当晚|入夜|天亮|黎明|清晨|傍晚时分|深夜|一觉|睡了一觉|休整|等待[一几]|"
    # 英文玩家输入(2026-10-23 站点切英文)
    r"\bnext (?:day|morning|night|week|month)\b|\bthe following (?:day|morning|night)\b|\btomorrow\b|\byesterday\b|"
    r"\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|several|\d+)\s+(?:hours?|days?|nights?|weeks?|months?)\s+"
    r"(?:later|pass|passes|passed|go by|goes by|went by|after)\b|\bafter (?:a|an|one|two|three|a few|few|several|\d+)\s+"
    r"(?:hours?|days?|nights?|weeks?|months?)\b|\bovernight\b|\bthat night\b|\bnightfall\b|\bdawn\b|\bdaybreak\b|"
    r"\b(?:sleep|slept)\b|\bwait(?:ed)? (?:a|an|for|until|till|\d)",
    re.IGNORECASE,
)


def _char_id(card: CharacterCard, idx: int = 0) -> str:
    raw = card.data.character_id or card.data.name or f"char-{idx}"
    return storage.slug(raw, f"char-{idx}")


# 长程记忆 A 档:玩家实体在记忆里的规范键(玩家没有 char_block,单独注入到玩家设定块)。
_PLAYER_ENTITY = "__player__"


def _norm_entity(s: Any) -> str:
    """实体别名归一:去空白 + 小写,供受限词表匹配(角色名/ID、玩家名都先过这里)。"""
    return str(s or "").strip().lower()


def _entity_roster(characters: list[CharacterCard],
                   player: PlayerCard | None) -> tuple[dict[str, str], list[str]]:
    """受限词表:返回 (别名→规范键 的映射, 给 prompt 看的可读标签列表)。

    角色:名字 / character_id 两个别名都映射到该角色的 cid;玩家:玩家名 / "玩家" → _PLAYER_ENTITY。
    模型给 memory_write.entity 选了表外的值(自由发挥)就清空,不让它挂错实体。
    召回时 present_characters(通常是角色名)也过这张表解析成同一个规范键,确保挂载与召回对得上。
    """
    roster: dict[str, str] = {}
    labels: list[str] = []
    for i, c in enumerate(characters):  # 全部卡都发实体键(原先只取前三张,十张卡的卡组有七个角色不进知情系统)
        cid = _char_id(c, i)
        roster[_norm_entity(cid)] = cid
        if c.data.name:
            roster[_norm_entity(c.data.name)] = cid
        labels.append(f"{c.data.name or cid}={cid}")
    if player and player.name:
        roster[_norm_entity(player.name)] = _PLAYER_ENTITY
        roster[_norm_entity("玩家")] = _PLAYER_ENTITY
        roster[_norm_entity("player")] = _PLAYER_ENTITY  # 英文 prompt 让模型写 player
        labels.append(L(f"{player.name}=player", f"{player.name}=玩家"))
    return roster, labels


def _on_stage(state: RuntimeState, characters: list[CharacterCard], player_name: str = "") -> list[str]:
    """此刻在场(除玩家)的名字。引擎记在场时名单就是权威(空 = 没人);否则名单空回退全部卡(旧行为)。"""
    names = list(state.scene.present_characters)
    if not names and not state.scene.cast_tracked:
        names = [c.data.name for c in characters]
    return [n for n in names if n and not _is_player_char(n, player_name)]


def _card_on_stage(name: str, on_stage: list[str]) -> bool:
    """卡上的名字在不在在场名单里(容忍名/姓简写:Dunn ↔ Dunn Smith)。"""
    if _name_in_present(name, set(on_stage)):
        return True
    parts = {t for t in name.split() if len(t) >= 3}
    return any(p in parts for p in on_stage)


def _opening_cast(characters: list[CharacterCard], player: PlayerCard | None, story: StoryBook | None) -> list[str]:
    """大卡组开局在场:故事书第一个事件列出的、有卡的角色(去掉玩家)。事件没列角色时返回空,由调用方回退。"""
    player_name = (player.name or "").strip() if player else ""
    first = story.events[0] if story and story.events else None
    listed = list(first.characters) if first else []
    out = []
    for c in characters:
        nm = c.data.name
        if nm and not _is_player_char(nm, player_name) and _card_on_stage(nm, listed):
            out.append(nm)
    return out


def _canon_cast(names: list[str], characters: list[CharacterCard]) -> list[str]:
    """在场名单规整:卡上角色一律换成卡上的名字(模型常写 ID「melissa-moretti」或简称「Dunn」),
    卡外的路人(警长、房东)原样保留;去重保序。"""
    out: list[str] = []
    for n in names:
        n = str(n or "").strip()
        if not n:
            continue
        hit = next((c.data.name for i, c in enumerate(characters)
                    if c.data.name and (_norm_entity(n) in {_norm_entity(c.data.name), _norm_entity(_char_id(c, i))}
                                        or _card_on_stage(c.data.name, [n]))), None)
        name = hit or n
        if name not in out:
            out.append(name)
    return out


_SPEECH_EN = r"(?:said|says|asked|asks|replied|replies|answered|answers|added|adds|murmured|murmurs|snapped|snaps|whispered|whispers|called|calls)"
_NAME_TITLES = {"Old", "Young", "Mr", "Mr.", "Mrs", "Mrs.", "Miss", "Ms", "Sir", "Lady", "Lord", "Dr", "Dr.",
                "Captain", "Father", "Mother", "Uncle", "Aunt", "Madam", "Master"}


def _narrated_arrivals(narration: str, raw_messages: Any, characters: list[CharacterCard],
                       on_stage: list[str], player_name: str = "") -> list[str]:
    """正文里已经在场景中、却没写进在场名单的卡上角色(诡秘长测:警察半夜进门,Dunn 的话写在旁白里,名单一直只有 Melissa)。
    只认强证据:直接引语的说话人(「'…,' Dunn said」「Dunn asked: '…'」「邓恩说:」),或本回合给他写了台词且正文里出现了他。
    「Benson always said …」这类转述不算(后面没有引号)。"""
    text = narration or ""
    speakers = set()
    for item in raw_messages or []:
        if isinstance(item, dict):
            speakers.add(_norm_entity(item.get("name") or item.get("character_id") or ""))
    found: list[str] = []
    for i, c in enumerate(characters):
        nm = c.data.name
        if not nm or _is_player_char(nm, player_name) or _card_on_stage(nm, on_stage):
            continue
        tokens = [t for t in nm.split() if t not in _NAME_TITLES]  # Old Neil → Neil,Dunn Smith → Dunn
        forms = [nm] + [t for t in tokens[:1] if len(t) >= 3 and t != nm]
        alt = "|".join(re.escape(f) for f in forms)
        quote = "['\"‘’“”]"
        direct = (re.search(rf"{quote}[,.!?—–\s]*\s*(?:{alt})\s+{_SPEECH_EN}\b", text)
                  or re.search(rf"\b{_SPEECH_EN}\s+(?:{alt})\b[,.]?\s*{quote}", text)
                  or re.search(rf"(?:{alt})\s+{_SPEECH_EN}\b[,:]?\s*{quote}", text)
                  or re.search(rf"(?:{alt})[^。！？\n]{{0,12}}(?:说|问|道|答)[:：]?\s*[「“\"]", text))
        has_line = _norm_entity(nm) in speakers or _norm_entity(_char_id(c, i)) in speakers or any(
            s and (s in _norm_entity(nm).split()) for s in speakers)
        if direct or (has_line and re.search(rf"(?:{alt})", text)):
            found.append(nm)
    return found


def _offstage_line(card: CharacterCard, cid: str) -> str:
    """不在场的卡只留一行:名字 + ID + 公开简介第一句(description 是详情页公开字段;秘密在 speech_rules,不进这一行)。"""
    d = card.data
    desc = re.split(r"(?<=[.!?。！？])\s*", (d.description or "").strip(), maxsplit=1)[0]
    if len(desc) > 160:
        desc = desc[:160].rstrip() + "…"
    return f"- {d.name} ({cid})" + (f": {desc}" if desc else "")


def _roster_key(name: str, roster: dict[str, str]) -> str | None:
    """名字 → 实体键。先精确(名字/ID),再容忍简称(名单里写 Dunn → 卡上 Dunn Smith)。"""
    n = _norm_entity(name)
    if not n:
        return None
    if n in roster:
        return roster[n]
    for alias, key in roster.items():
        if key == _PLAYER_ENTITY or not alias:
            continue
        if n in alias.split() or alias in n.split():  # Dunn ↔ dunn smith
            return key
        if len(n) >= 2 and not n.isascii() and (n in alias or alias in n):  # 悟空 ↔ 孙悟空
            return key
    return None


def _present_entity_keys(state: RuntimeState, characters: list[CharacterCard],
                         roster: dict[str, str]) -> set[str]:
    """本轮在场实体的规范键集合:在场名单(角色名)解析成 cid。"""
    keys: set[str] = set()
    for n in _on_stage(state, characters):
        k = _roster_key(n, roster)
        if k and k != _PLAYER_ENTITY:
            keys.add(k)
    return keys


# 玩家点名某角色的常见别称 → 角色全名(用于"点名问谁"识别)。认不出就不过滤(安全偏向)。
_ADDR_ALIASES = {"师父": "唐僧", "师傅": "唐僧", "大师兄": "悟空", "猴哥": "悟空", "大圣": "悟空",
                 "二师兄": "八戒", "呆子": "八戒", "老猪": "八戒"}


def _addressed_character(action: str, characters: list[CharacterCard]) -> str | None:
    """从玩家行动开头解析"点名在问谁"(如『悟空,…』『师父,…』)→ 角色全名;认不出返回 None。
    认不出=不过滤(安全:见证者事实照常保留;只在明确点名【缺席者】时才删材料,误判倾向不删)。"""
    head = str(action or "").strip()
    if not head:
        return None
    for c in characters:
        nm = c.data.name
        if " " in nm.strip():  # 英文名:全名 + 名/姓 token(Sherlock Holmes→Sherlock / Holmes)
            forms = {nm} | {t for t in nm.split() if len(t) >= 2}
        else:
            forms = {nm, nm[-2:], nm[-3:]}  # 全名 + 末2/3字(孙悟空→悟空)
        forms |= {a for a, full in _ADDR_ALIASES.items() if full in nm or nm in full}
        if any(f and head.lower().startswith(f.lower()) for f in forms):
            return nm
    return None


def _parse_present_tag(text: str) -> set[str] | None:
    """从召回行解析 `[当时在场:A、B]` → {A,B};无该标记返回 None(无法判定在场→不删,安全偏向)。"""
    m = re.search(r"\[当时在场:([^\]]*)\]", str(text or ""))
    if not m:
        return None
    return {x.strip() for x in re.split(r"[、,，]", m.group(1)) if x.strip()}


def _name_in_present(name: str, present: set[str]) -> bool:
    """名字模糊归属:在场名单里有任一项与 name 互相包含即算在场(悟空↔孙悟空)。"""
    return any(p and (p == name or p in name or name in p) for p in present)


def _mem_bigrams(s: str) -> set[str]:
    t = "".join(str(s or "").split())
    return {t[i:i + 2] for i in range(len(t) - 1)}


SUPERSEDE_OVERLAP = 0.6  # #2 矛盾消解:同实体新旧事实 2-gram 重合 ≥ 此值且文本不同 → 旧标 superseded(保守,防误删)


def _supersede_conflicts(long_memory: list[Any], new_text: str, new_entity: str) -> int:
    """#2 轻量矛盾消解:新事实与同实体的既有 active 事实"近似但不完全相同"(像同一属性的新值)→
    把旧的标 superseded(不删,留痕,不再注入)。保守:只对高重合且不同的才动,降误删风险。返回标记数。"""
    if not new_entity or not new_text:
        return 0
    ng = _mem_bigrams(new_text)
    if not ng:
        return 0
    marked = 0
    for it in long_memory or []:
        if not isinstance(it, dict) or it.get("superseded"):
            continue
        if str(it.get("entity", "") or "") != new_entity:
            continue
        ot = str(it.get("text", "") or "")
        if not ot or ot == new_text:  # 完全相同=重复(交给去重),不算矛盾
            continue
        og = _mem_bigrams(ot)
        if og and len(ng & og) / max(1, min(len(ng), len(og))) >= SUPERSEDE_OVERLAP:
            it["superseded"] = True
            marked += 1
    return marked


def _entity_memory_index(long_memory: list[Any], wanted: set[str],
                         per_entity: int = 6, by_knower: bool = False) -> dict[str, list[str]]:
    """从会话 long_memory 里取在场相关条目,按目标键分组(每键保留最近 per_entity 条)。

    A 档确定性召回:不靠相似度,数据落会话 JSON,两记忆模式都走这里。#2:superseded 的不再召回。

    by_knower=False(A 原行为/subject 轴):按事实主体 entity 分组——entity ∈ wanted 才取(挂谁身上、谁在场就注入)。
    by_knower=True(Phase 3/knower 轴):有 `knowers` 字段的派生事实按"谁知道"分组——只注入到 knowers ∩ wanted 的
      在场角色块(该角色亲历/知情才看得到);**无 knowers 的旧事实回退 subject 轴**(向后兼容,不丢老数据)。
    """
    grouped: dict[str, list[str]] = {}
    for item in long_memory or []:
        if not isinstance(item, dict) or item.get("superseded"):
            continue
        text = str(item.get("text", "") or "").strip()
        if not text:
            continue
        line = f"[{item.get('kind', 'note')}] {text}"
        knowers = item.get("knowers") if by_knower else None
        if knowers is not None:  # Phase 3:knower 轴(事实只进"知道它的在场角色"块)
            targets = [k for k in knowers if k in wanted]
        else:                    # subject 轴(A 原行为 / 未标 knowers 的旧事实)
            ent = str(item.get("entity", "") or "")
            targets = [ent] if (ent and ent in wanted) else []
        for t in targets:
            grouped.setdefault(t, []).append(line)
    return {k: lines[-per_entity:] for k, lines in grouped.items()}


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
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            fixed = _rejoin_split_root(candidate) or _close_truncated(raw[start:])
            if fixed is not None:
                return fixed
            raise


def _rejoin_split_root(text: str) -> dict[str, Any] | None:
    """模型把根对象提前关了、又接着写成员({...choices]},"state_update":{...}...)→ 拼回一个对象。
    诡秘案第三回合就是这种(Extra data),旧逻辑救不回来,整回合掉进精简重写。"""
    dec = json.JSONDecoder()
    try:
        obj, idx = dec.raw_decode(text)
    except json.JSONDecodeError:
        return None
    rest = text[idx:].strip()
    if not isinstance(obj, dict) or not rest.startswith(","):
        return None
    tail = "{" + rest[1:].lstrip()
    try:
        more = json.loads(tail)
    except json.JSONDecodeError:
        more = _close_truncated(tail, need_body=False)
    if not isinstance(more, dict):
        return None
    for k, v in more.items():
        obj.setdefault(k, v)
    return obj


def _close_truncated(text: str, need_body: bool = True) -> dict[str, Any] | None:
    """输出写到一半断了:退回到最近一个完整成员,补齐括号。need_body=True 时只在正文、台词、选项都已写完时才算救回
    (断在 state_update / memory_write 里最常见);断在正文中间的不硬救,交给 LLM 修复和重写。"""
    stack: list[str] = []
    in_str = esc = False
    cuts: list[tuple[int, tuple[str, ...]]] = []
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack:
                stack.pop()
            cuts.append((i + 1, tuple(stack)))
        elif ch == ",":
            cuts.append((i, tuple(stack)))
    for pos, st in reversed(cuts[-80:]):
        if not st:
            continue
        attempt = text[:pos] + "".join("}" if c == "{" else "]" for c in reversed(st))
        try:
            obj = json.loads(attempt)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        if need_body and not (str(obj.get("narration", "")).strip() and obj.get("choices")):
            return None
        return obj
    return None


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
                        L("You are a JSON repairer. Repair the user's content into strictly valid JSON. "
                          "Keep every original field and its meaning and value unchanged; output only the JSON, no explanation.",
                          "你是 JSON 修复器。把用户给的内容修复成严格合法 JSON。"
                          "必须保留原有字段含义,只输出 JSON,不要解释。")
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
    present = _on_stage(state, characters)
    if state.scene.cast_tracked and not present:  # 除玩家外没人在场:保底回合只写旁白,不拉一个不在场的人来说话
        return "narrator", L("Narrator", "旁白")
    for name in present:
        if name and name in action:
            card = next((c for c in characters if c.data.name == name), None)
            return (_char_id(card, 0) if card else storage.slug(name, "char"), name)
    for card in characters:
        if card.data.name in present or not present:
            return _char_id(card, 0), card.data.name
    return "narrator", L("Narrator", "旁白")


def _local_continuation_turn_zh(action: str, state: RuntimeState, characters: list[CharacterCard], reason: str = "") -> StoryTurn:
    """LLM 空白/坏结构时的自然保底。它必须像故事回合,不能像系统报错。

    文案与具体题材无关:只用当前场景 / 在场者 / 玩家行动拼装,不写死某个故事的专有名词,
    这样武侠、奇幻、现代等任意故事在 LLM 故障时都不会跳出当下世界。
    """
    cid, name = _speaker_for_action(action, state, characters)
    location = state.scene.location or "现场"
    objects = state.scene.objects or ["周围的环境", "在场者的神情", "眼前的线索"]
    focus = objects[0]
    present = "、".join(_on_stage(state, characters)[:4]) or name

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
        messages=[] if cid == "narrator" else [StoryMessage(character_id=cid, name=name, text=text)],
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


def _local_continuation_turn_en(action: str, state: RuntimeState, characters: list[CharacterCard], reason: str = "") -> StoryTurn:
    """LLM 空白/坏结构时的自然保底。它必须像故事回合,不能像系统报错。

    文案与具体题材无关:只用当前场景 / 在场者 / 玩家行动拼装,不写死某个故事的专有名词,
    这样武侠、奇幻、现代等任意故事在 LLM 故障时都不会跳出当下世界。
    """
    cid, name = _speaker_for_action(action, state, characters)
    location = state.scene.location or "the scene"
    objects = state.scene.objects or ["the surroundings", "the faces of those present", "the clue in front of you"]
    focus = objects[0]
    present = ", ".join(_on_stage(state, characters)[:4]) or name
    low = action.lower()

    if any(word in action or word in low for word in ("看法", "怎么想", "意见", "反应", "think", "opinion", "view", "react")):
        narration = f"At {location}, your gaze turns to those present. For a moment, {present}'s reaction is worth more attention than the matter at hand."
        text = f"{name} pauses at your words and doesn't answer right away: \"You can have my view, but don't rush to conclusions. Some things still don't add up.\""
    elif any(word in action or word in low for word in ("观察", "看看", "异常", "查", "检查", "look", "observe", "inspect", "check", "search", "examine")):
        narration = f"You bring your attention back to {location}. {focus} is still at the center of your view, and the details around it are starting to look restless."
        text = f"{name} raises a hand and beckons you closer: \"Look all you like, but one thing at a time. First, let's sort out what's certain and what only looks that way.\""
    elif any(word in action or word in low for word in ("为什么", "怎么", "?", "？", "why", "how")):
        narration = f"Your question lands in the middle of {location}. It gets no direct answer, but it forces everyone present to lay out the situation again."
        text = f"{name} slows down: \"That's a fair question. We don't know enough yet, but it'll help us decide where to go next.\""
    else:
        narration = f"At {location}, your words are taken as this turn's action. They may not push the main plot forward directly, but they shift everyone's attention."
        text = f"{name} glances at you and doesn't object: \"I'll go along with what you said for now. As long as it fits the facts in front of us, it counts.\""

    return StoryTurn(
        narration=narration,
        messages=[] if cid == "narrator" else [StoryMessage(character_id=cid, name=name, text=text)],
        choices=[
            StoryChoice(id="clarify_fact", label="Ask them to spell out what they know", intent="ask", description="Pin the question to established facts"),
            StoryChoice(id="watch_reaction", label="Watch how everyone reacts", intent="observe", description="Look for hesitation or concealment"),
            StoryChoice(id="inspect_focus", label=f"Examine {focus}", intent="act", description="Push the current investigation forward"),
        ],
        state_update={"player": {"flags": ["local_continuation"]}},
        memory_write=[MemoryWrite(kind="note", text=f"Local fallback continuation used this turn: {action}; {reason}", importance=2)],
        triggered_events=[],
        state=state,
    )


def _local_continuation_turn(*args, **kwargs):
    """按请求语言分派(2026-10-23 双语):zh = 0785bf0 原文原样,en = 英文版。"""
    return (_local_continuation_turn_zh if is_zh() else _local_continuation_turn_en)(*args, **kwargs)


def _init_state(characters: list[CharacterCard], player: PlayerCard | None, story: StoryBook | None) -> RuntimeState:
    ids = [_char_id(c, i) for i, c in enumerate(characters)]
    first_names = [c.data.name for c in characters]
    state = RuntimeState()
    state.scene.present_characters = first_names
    state.scene.location = L("Opening scene", "故事开场")
    if len(characters) > SMALL_CAST:
        # 大卡组:开局不再全员在场(诡秘 10 张卡曾让奥黛丽、阿尔杰也"在"莫雷蒂家,第一条事实的知情者全错)。
        # 第一个事件写了在场角色就照它(诡秘:开场只有克莱恩);没写(自建卡组、旧故事书)就照旧全员,
        # 由开场回合模型写的 present_characters 收窄,知情者只记回合结束时在场的人(见 story_turn)。
        state.scene.cast_tracked = True
        first = story.events[0] if story and story.events else None
        if first and first.characters:
            state.scene.present_characters = _opening_cast(characters, player, story)
            if first.location:
                state.scene.location = first.location
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
            L("Do not invent organizations, places, character relationships or historical events that are not in the uploaded material, world book or story book.",
              "不得编造上传材料、世界书或故事书里不存在的组织、地点、角色关系、历史事件。"),
            L("Unknown settings must be expressed as uncertainty in the character's voice; never pretend to know.",
              "不知道的设定必须用角色口吻表达不确定,不能假装知道。"),
            L("Do not state hidden events to the player before their disclosure conditions are met.",
              "隐藏事件未满足披露条件前,不要向玩家明说。"),
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
        if any(k.strip() and (k in text or k.lower() in text.lower()) for k in entry.keys):
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
        keyword_hit = any(k and (k in text or k.lower() in text.lower()) for k in event.trigger_keywords)
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
                "text": L("The runtime state was corrupted and has been rebuilt from the current card set.",
                          "运行状态结构损坏,已按当前卡组重建状态。"),
                "importance": 2,
            })
    return _init_state(characters, player, story)


def _input_profile(action: str) -> str:
    text = action.strip()
    if not text:
        return L("Opening or observation request.", "开场或观察请求。")
    has_cjk = bool(re.search(r"[\u4e00-\u9fff]", text))
    has_word = bool(re.search(r"[A-Za-z0-9]", text))
    punct_ratio = sum(1 for ch in text if not ch.isalnum() and not "\u4e00" <= ch <= "\u9fff") / max(len(text), 1)
    if len(text) <= 2:
        return L("Very short input: may be silence, hesitation, an interruption or a fragment; give light in-story feedback.",
                 "极短输入:可能是沉默、犹豫、打断或片段回应;必须在故事内给轻量反馈。")
    if not has_cjk and not has_word:
        return L("Non-text/symbol input: treat it as an emotion, a gesture or an inarticulate reaction; don't stall.",
                 "非文字/符号输入:当作情绪、手势或无法明确表达的反应处理,不要空转。")
    if punct_ratio > 0.65:
        return L("Mostly symbols: may be a meme, emotion, gibberish or interruption; characters should confirm / misread / catch it, never invent facts.",
                 "高符号比例输入:可能是玩梗、情绪、乱码或打断;角色应先确认/误解/接住,不要硬编事实。")
    if len(text) < 12:
        return L("Short casual input: may omit the subject or action; interpret it in the current scene.",
                 "短口语输入:可能省略主语或动作,结合当前场景理解。")
    return L("Natural-language input: may contain slang, memes, typos or incomplete actions; interpret it by its in-story intent first.",
             "自然语言输入:可能包含口语、玩梗、错字或不完整行动,优先按故事内意图处理。")


def _is_player_char(name: str, player_name: str) -> bool:
    """名字是否就是玩家扮演的角色(归一化精确匹配)。引擎不替玩家发言、不把他当 NPC。"""
    if not name or not player_name:
        return False
    return _norm_entity(name) == _norm_entity(player_name)


def _apply_state_update(state: RuntimeState, update: dict[str, Any], player_name: str = "") -> RuntimeState:
    """把模型返回的状态补丁合并到 RuntimeState。格式故意宽松,防止模型小偏差。
    player_name:玩家扮演的角色名 —— 从 present_characters 里剔除,否则引擎会把玩家角色当 NPC 代说
    (yorha-a2-team §16 bug#6:玩家扮阿格莱雅,present_characters 仍含她 → 她替玩家自答)。"""
    if not isinstance(update, dict) or not update:
        return state
    scene = update.get("scene")
    if isinstance(scene, str):  # 模型偶尔把 scene 直接写成地点字符串,按 location 处理而非丢弃
        scene = {"location": scene}
    elif not isinstance(scene, dict):
        scene = {}
    moved = bool(scene.get("location")) and str(scene.get("location")) != state.scene.location
    for key in ("location", "atmosphere"):  # time 不再由 LLM 写,统一在 _save_turn 由权威时钟渲染(根治显示倒退)
        if scene.get(key):
            setattr(state.scene, key, str(scene[key]))
    for key in ("present_characters", "objects", "exits"):
        values = _as_text_list(scene.get(key))
        if key == "present_characters" and player_name:  # bug#6:玩家扮演的角色不进"在场可发言集"
            values = [v for v in values if not _is_player_char(v, player_name)]
        if values:
            setattr(state.scene, key, values)
        elif (key == "present_characters" and state.scene.cast_tracked and moved
              and isinstance(scene.get(key), list)):
            # 引擎记在场时:换了地点又明确写了空名单 = 新地点除玩家外没人(否则旧名单会跟着玩家走)。
            # 没换地点的空名单当作"没填",保持原名单(模型常把 schema 里的 [] 原样抄回来)。
            state.scene.present_characters = []

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
        summary_parts.append(L("Player's recent actions: ", "玩家近期行动: ") + " / ".join(user_actions[-4:]))
    if assistant_notes:
        summary_parts.append(L("Recent story progress: ", "近期剧情进展: ") + " / ".join(x[:160] for x in assistant_notes[-3:]))
    return [{
        "kind": "note",
        "text": L("; ", "；").join(summary_parts) or L("Recent interactions happened, but no finer long-term memory could be extracted.",
                                                       "近期互动已发生,但未能抽取更细长期记忆。"),
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
        L("Tag each memory with the entity it mainly concerns: entity may only be [one value from the right-hand side of '='] in the roster below, copied verbatim; "
          "if it concerns the player write 'player'; if it doesn't clearly concern any roster entity, use an empty string.\nRoster: ",
          "为每条记忆标注它主要关乎的实体(entity),只能从下面名册里【选一个等号右边的值】填进 entity;"
          "关乎玩家就填'玩家';不明确关乎名册里任一实体就留空字符串。\n名册:") + "; ".join(entity_labels or [])
        if entity_labels else L("Always leave entity as an empty string.", "entity 一律留空字符串。")
    )
    try:
        raw = await achat_messages(
            [
                {
                    "role": "system",
                    "content": L(
                        "Extract long-term memories from the interactive-story dialogue below. Output JSON: "
                        '{"items":[{"kind":"event|choice|relationship|fact|quest|note","text":"...","importance":1-5,"entity":"entity or empty"}]}. '
                        "Keep only what will affect later plot, relationships, fact boundaries or quests. Write each text in English. ",
                        "从下面互动故事对话中抽取长期记忆。输出 JSON:"
                        '{"items":[{"kind":"event|choice|relationship|fact|quest|note","text":"...","importance":1-5,"entity":"实体或空"}]}。'
                        "只保留会影响后续剧情、关系、事实边界或任务的内容。",
                    ) + roster_hint,
                },
                {"role": "user", "content": convo},
            ],
            json_mode=True,
            max_tokens=1024,
            model=get_adapter().select_model("memory_extract"),
        )
        obj = _json_obj(raw)
    except DeferredLLMControl:
        raise
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


def _clamp_time_advance(raw: Any, action: str, skip: Any = None) -> int:
    """把模型估的 time_advance(分钟)clamp 成合理值。

    自然推进锁在 [MIN, NATURAL_MAX] 防乱估;玩家显式说"第二天/三小时后"等跳跃词时放开到 JUMP_MAX;
    模型在 state_update.time_skip 写明了跳过的理由(玩家同意等到天亮、长途赶路)时放开到 SKIP_MAX——
    否则正文写到第二天早上、时钟却卡在 +3 小时(诡秘长测:正文吃早饭,时钟凌晨四点)。
    每轮至少 +MIN_TIME_ADVANCE,防时钟冻住。
    """
    try:
        adv = int(round(float(raw)))
    except (TypeError, ValueError):
        adv = MIN_TIME_ADVANCE
    if adv < 0:
        adv = MIN_TIME_ADVANCE
    if _JUMP_WORDS.search(action or ""):
        ceiling = JUMP_MAX_ADVANCE
    elif skip and str(skip).strip().lower() not in {"false", "no", "none", "0"}:
        ceiling = SKIP_MAX_ADVANCE
    else:
        ceiling = NATURAL_MAX_ADVANCE
    return max(MIN_TIME_ADVANCE, min(adv, ceiling))


def _fmt_clock(minutes: int) -> str:
    """把故事内分钟格成 Day N HH:MM(2026-10-23 前为 第N天 HH:MM)。"""
    minutes = max(0, int(minutes))
    return L(f"Day {minutes // 1440 + 1} {(minutes % 1440) // 60:02d}:{minutes % 60:02d}",
             f"第{minutes // 1440 + 1}天 {(minutes % 1440) // 60:02d}:{minutes % 60:02d}")


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
# 英文玩家输入(2026-10-23 站点切英文):数词 + 单位 + 向前语境(later/pass/after …)。
_EN_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
           "seven": 7, "eight": 8, "nine": 9, "ten": 10, "a couple of": 2, "a few": 3, "few": 3, "several": 3}
_EN_NUMRE = r"(\d+|a couple of|a few|few|several|an|a|one|two|three|four|five|six|seven|eight|nine|ten)"
_EN_FWD = r"(?:later|pass|passes|passed|go by|goes by|went by|have passed|had passed)"
_JUMP_FLOOR_PATTERNS += [
    (rf"\b{_EN_NUMRE}\s+months?\s+{_EN_FWD}", 43200),
    (rf"\b(?:after|wait(?:ed)?(?: for)?)\s+{_EN_NUMRE}\s+months?\b", 43200),
    (rf"\b{_EN_NUMRE}\s+weeks?\s+{_EN_FWD}", 10080),
    (rf"\b(?:after|wait(?:ed)?(?: for)?)\s+{_EN_NUMRE}\s+weeks?\b", 10080),
    (rf"\b{_EN_NUMRE}\s+days?\s+{_EN_FWD}", 1440),
    (rf"\b(?:after|wait(?:ed)?(?: for)?)\s+{_EN_NUMRE}\s+days?\b", 1440),
    (rf"\b{_EN_NUMRE}\s+hours?\s+{_EN_FWD}", 60),
    (rf"\b(?:after|wait(?:ed)?(?: for)?)\s+{_EN_NUMRE}\s+hours?\b", 60),
]
_JUMP_FLOOR_NEXTDAY = re.compile(r"第二天|次日|翌日|隔天|明天|明日|\bnext (?:day|morning)\b|\bthe following (?:day|morning)\b|\btomorrow\b",
                                 re.IGNORECASE)
# 只认向前的说法。"that night / slept / 当晚"多半是回指("那天晚上你听到了什么"),
# 诡秘长测里一句 "what she heard that night" 就把时钟硬推了 8 小时。
_JUMP_FLOOR_NIGHT = re.compile(r"一夜|过夜|睡了一觉|一觉|天亮|入夜|黎明|清晨|\bovernight\b|\bfor the night\b|"
                               r"\bsleep (?:through|until|till)\b|\buntil (?:dawn|morning|daybreak)\b|\bnightfall\b",
                               re.IGNORECASE)


def _parse_num(s: str) -> float:
    return float(s) if s.isdigit() else float(_CN_NUM.get(s, _EN_NUM.get(s.lower(), 1)))


def _explicit_jump_floor(action: str) -> int:
    """玩家显式声明的时间跳跃 → 至少推进这么多故事分钟(玩家声明优先,即便模型估小了也保证跳到位)。"""
    a = action or ""
    floor = 0
    for pat, mult in _JUMP_FLOOR_PATTERNS:
        for m in re.finditer(pat, a, re.IGNORECASE):
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
            out.append((e, L("due", "时间到点") if due_hit else L("main plot stalled too long", "主线停滞过久")))
    out.sort(key=lambda x: -(x[0].severity or 2))
    return out[:3]


def _main_anchor(story: StoryBook | None, player: PlayerCard | None) -> str:
    """主线锚点:恒定注入故事前提 + 主线目标 + 玩家目标,防主线被支线噪音淹没。"""
    if not story:
        return ""
    parts = []
    if story.premise:
        parts.append(L("Premise: ", "前提:") + story.premise[:200])
    if story.main_plot:
        parts.append(L("Main goals: ", "主线目标:") + "; ".join(story.main_plot[:3]))
    if player and player.goals:
        parts.append(L("Player goals: ", "玩家目标:") + "; ".join(player.goals[:3]))
    return " | ".join(parts)


def _prompt_zh(
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
    player_name = (player.name or "").strip() if player else ""
    tracked = state.scene.cast_tracked
    present = _on_stage(state, characters, player_name)  # bug#6:在场可发言集排除玩家扮演的角色
    char_blocks = []
    offstage_lines = []
    for i, card in enumerate(characters):
        d = card.data
        cid = _char_id(card, i)
        if _is_player_char(d.name, player_name):   # bug#6:玩家扮演的角色不作为可发言 NPC 块,引擎不替其发言
            continue
        if tracked and not _card_on_stage(d.name, present):  # 不在场:只留一行,不给整张卡(也不给它的秘密和知情块)
            offstage_lines.append(_offstage_line(card, cid))
            continue
        rules = "\n".join(f"- {r}" for r in d.speech_rules)
        block = (
            f"## {d.name} ({cid})\n"
            f"设定:{d.description}\n性格:{d.personality}\n情境:{d.scenario}\n"
            f"范例:{d.mes_example}\n说话硬规则:\n{rules}\n"
            "主动性要求:根据该角色的身份、性格、利益和当前情境主动反应。"
            "可以追问、打断、试探、拒绝、转移压力、提出条件或推进自己的小目标。"
        )
        # 长程记忆 A 档:该角色在场 → 注入它自己的派生事实块(不靠相似度)。
        # Phase 3 = 按"该角色知道的"注入(knower 轴);off = 按"关于该角色的"(subject 轴)。
        ent_lines = entity_memory.get(cid)
        if ent_lines:
            head = (
                f"\n{d.name} 知道/亲历的既有事实(该角色本人知情,须一致;此处没列出的具体往事=该角色当时不知道):\n"
                if PHASE3_KNOWERS else
                "\n关于该角色的既有事实/记忆(此前剧情里确立、必须保持一致,不要与之矛盾):\n"
            )
            block += head + "\n".join(f"- {x}" for x in ent_lines)
        char_blocks.append(block)
    # 单角色"场景":判断依据是本轮实际在场的角色数(运行时),不是上传了几张卡。
    # 多角色卡组里和某个角色单独相处的段落也会触发——那种段落最容易退化成一问一答的聊天。
    solo_directive = ""
    if tracked and not present:
        solo_directive = (
            "本轮场景里除玩家外没有任何角色在场。narration 要写足(至少 3-5 句、有画面感),写场景、玩家动作的后果和世界本身的反应。"
            "messages 可以是空列表(这一条优先于『至少一条角色台词』的要求),不要凭空拉一个不在场的角色来说话;"
            "只有剧情本轮给出具体理由(有人到来、敲门、被叫来、玩家走过去),才写出他到场并把他的名字写进 present_characters。\n"
        )
    elif len(set(present)) <= 1:
        solo_directive = (
            "本轮场景里除玩家外只有一个角色在场,没有其他角色的对白来填充内容。"
            "因此 narration 要写足(至少 3-5 句、有画面感):把场景、气氛、玩家这一轮动作带来的"
            "物理/环境后果、以及世界本身的反应(光线、声音、物件、距离、温度、时间流逝)都描写出来,"
            "不要只写一两句就交给对白。让单角色场景依然有沉浸感和节奏,而不是一问一答。\n"
        )
    offstage_block = ""
    if offstage_lines:
        offstage_block = (
            "# 不在场的角色(此刻不在这个场景里)\n"
            "他们在别处:本轮不能说话、不能行动、看不见也听不到这里发生的事,也不会知道这里发生了什么。"
            "只有剧情本轮给出具体理由(到来、敲门、被叫来、玩家去找他)才能让他进场:在本轮 narration 里写出他到场,"
            "并把他的名字原样写进 state_update.scene.present_characters;否则绝不给他台词。"
            "来的人如果就是下面某个角色(比如上门调查的人),就用卡上的名字写他、把他加进名单,不要把他写成一个不具名的陌生人。\n"
            + "\n".join(offstage_lines) + "\n\n"
        )
    present_note = ""
    if tracked:
        present_note = ("(在场名单:" + ("、".join(present) if present else "除玩家外没有人") + ")\n")
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
    # Phase 3 知识边界:显式告诉模型"叙事真相≠人人都知道",被问的角色没亲历就 in-character 认忘(RoleRAG 式劝阻)。
    kb_directive = (
        "知识边界(角色只知道自己【当时在场】经历或被当面告知的事):召回的【旧对话】可能带标记"
        "『[当时在场:某、某]』,表示那件事发生时谁在场。玩家问某个在场角色一件【具体往事】时,据此判断:\n"
        "  · 被问角色【在】那条往事的『当时在场』名单里(或那是 canon 公开设定、或列在他自己的知情块里)"
        "→ 他亲历/知情,**该自信、明确地把那个值答出来,别推脱别装糊涂**;\n"
        "  · 被问角色【不在】名单里(那段他被支开 / 在别处 / 尚未登场)→ 他当时不在场,要 in-character 认忘"
        "(我那会儿不在 / 没瞧见 / 没听说),**绝不照叙事真相或别人的见闻编**——连那物件的形状 / 颜色 / 数量也不许猜。\n"
        "叙事真相 ≠ 人人都知道:一件事被你召回到,不代表当前被问的角色当时在场。"
        "canon(角色卡 / 世界书 / 故事书的公开设定)是公共知识,人人可引用,不受此限。\n"
    ) if PHASE3_KNOWERS else ""
    # 去 AI 味:风格规则当全局硬指令;疲劳词当软提示(不硬禁,免伤古风/武侠题材的合法常用词)。承 Yufei 提案。
    anti_ai = (
        "叙事质感(避免 AI 腔,重要):\n"
        "- 用【具体动作 + 感官细节】推进,别用概括句替场面下结论(写『终场哨响,他僵在原地』,而非『他赢了,全场欢呼』)。\n"
        "- 情绪靠【外部细节】侧写,别堆排比内心独白(写『他深吸一口气,低头看了眼表』,而非『也许…也许…也许…』)。\n"
        "- 不替读者总结情绪、不下判语,留白让画面说话;不元叙事、不自指(绝不出现『作为AI/作为角色』之类)。\n"
        "- 克制 LLM 高频疲劳词的【堆砌】(突然 / 意识到 / 某种 / 仿佛 / 不禁 / 一丝 / 嘴角 / 缓缓 / 轻轻 等):"
        "古风武侠等题材这些词本就常见,不强禁,但别一句一个、别整段堆同一类。\n"
    ) if ANTI_AI_STYLE else ""
    return (
        "你是互动故事引擎,不是普通聊天助手。你要生成一轮可玩的故事推进。\n"
        "严格事实边界:只能使用角色卡、世界书、故事书、玩家卡、运行状态和记忆中提供的事实。"
        "不存在/未披露/不确定的设定不得编造;可以让角色以自身口吻说不知道或需要调查。\n"
        + kb_directive +
        "保持玩家自由度:不要替玩家做决定、不要描写玩家未选择的动作或心理。\n"
        + (f"玩家正扮演【{player_name}】:你【绝不】为该角色生成台词或内心独白,也不要把他列进 present_characters / "
           "活跃角色——他由玩家自己扮演,不在你要驱动的 NPC 之列。\n" if player_name else "") +
        "角色不是等待回复的机器人。每轮至少让一个在场角色做出符合性格的主动行为或主动判断,"
        "例如追问、质疑、观察、施压、试探、维护自身利益、提出交易条件、暴露情绪变化。"
        "主动行为只能基于已知事实和角色立场,不能替玩家解决核心问题,不能强行跳过玩家选择。\n"
        "对话要带动作和神情:角色台词前后应有简短的姿态、表情、语气或视线描写。"
        "动作描写必须符合角色性格和现场,不要写成长篇舞台说明。\n"
        + anti_ai
        + solo_directive +
        "玩家的自由输入就是本轮行动,必须被识别、回应并推进到叙事/角色反应/状态更新中。"
        "如果玩家行动不可执行、信息不足或越过事实边界,要在故事内给出原因和可调查方向,不能无视该输入。\n"
        "推进要有实质进展:不要每轮只把同一处线索、同一个动作越描越细而场景/主线/关系零变化。"
        "玩家持续投入时,调查要真的产出新结论、新位置、新关系或新揭示,而不是无限细分同一个发现、反复确认同一件事、"
        "或让角色用换皮的同义台词把玩家原地留住。一条线索调查充分了就给出它的结论并打开下一步,别在原地空转。\n"
        "每轮必须先生成故事正文,再给 3-4 个玩家行动选项;选项不能替代正文。"
        "选项只写玩家角色凭他此刻所知能想到的行动:不要在选项里点破别人的真实身份、头衔或任何玩家角色在剧情里还没得知的事。"
        "narration 必须非空,messages 至少包含一条角色对玩家本轮输入的反应。"
        "玩家可能使用口语、玩梗或不严肃报价,仍要当作故事内行动处理,由角色自然回应。\n\n"
        + (f"# 活跃角色(此刻在场)\n{present_note}{chr(10).join(char_blocks) or '无'}\n\n" + offstage_block if tracked
           else f"# 活跃角色\n{chr(10).join(char_blocks)}\n\n") +
        f"# 玩家设定\n{json.dumps(player.model_dump(), ensure_ascii=False) if player else '未提供'}{player_mem_block}\n\n"
        f"# 故事书总览\n{story_overview}\n\n"
        f"# 当前运行状态\n{json.dumps(_state_digest(state), ensure_ascii=False)}\n\n"
        f"# 命中的世界书/设定卡\n{chr(10).join(world_hits) or '无'}\n\n"
        f"# 命中的故事事件\n{story_block or '无'}\n\n"
        f"# 向量召回资料\n{chr(10).join(kb_hits) or '无'}\n\n"
        f"# 长期记忆\n{chr(10).join(long_memory) or '无'}\n\n"
        "# 状态维护(每轮必做,直接决定玩家看到的状态面板,不要省略)\n"
        "- 场景:玩家移动或环境变化时,必须在 state_update.scene 写新值。scene 必须是对象,"
        "至少含 location;同时按需更新 time / atmosphere / present_characters / objects。绝不要把 scene 写成一个字符串。\n"
        + ("- 在场:state_update.scene.present_characters 写本轮【结束时】仍在场景里的全部角色(不含玩家),名字照卡上原样;"
           "本轮到来的加进去、离开的去掉。只有这份名单上的人(或【活跃角色】里的人)能有台词。\n" if tracked else "") +
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
        + ("3. 在场(写正文前先定):在 reasoning.cast 里列出本轮结束时除玩家外实际在场景里的所有人(卡上角色用卡上的名字),"
           "从【活跃角色】开头的在场名单出发,加上本轮到来的、去掉离开的;正文、台词和 present_characters 都要与它一致。\n" if tracked else "") +
        "# 世界时钟(每轮必做)\n"
        "- 在 state_update.time_advance 填本轮经过的【故事内分钟数】:平常对话/调查给小值(几分钟到一两小时);"
        "玩家明确跳时间就给对应大值并在叙事里真的跳过去:一夜≈600,一天=1440,三天=4320,一周=10080,一个月≈43200。\n"
        "- 玩家没明说跳时间、但剧情顺理成章要跳过一段(玩家已同意等到天亮、赶一段长路)时,在 state_update.time_skip 写一句理由,"
        "time_advance 照实给(最多 16 小时);没写 time_skip 的回合引擎把推进封顶在 180 分钟,那就别在正文里写『第二天早上』这类跳跃。"
        "正文里提到的钟点要和【故事内时钟】对得上。\n"
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
        "- entity 只能从上面【活跃角色】" + ("或【不在场的角色】" if tracked else "") + "括号里的角色 ID 原文里选(例如 写 大黑塔 的 ID),关乎玩家就填'玩家';\n"
        "  挂不上名册里任何具体实体(纯氛围/无关琐事)就把 entity 留成空字符串\"\"。不要自己发明名册外的实体名。\n"
        "- 这条挂载决定了【该实体下次在场时,这条记忆会被必然取回注入】,所以关乎某角色长期设定/状态的事实务必挂上它。\n\n"
        "输出严格 JSON,只输出这一个对象,格式:\n"
        "{"
        '"reasoning":{"hard_violation":false,"violation_detail":"","world_counter":"","ooc_risk":"","recall_check":"",'
        + ('"cast":["本轮结束时在场的角色"],' if tracked else '') +
        '"note":"一句话推演"},'
        '"narration":"场景/动作/气氛,简洁",'
        '"messages":[{"character_id":"角色ID","name":"角色名","text":"带动作神情的台词"}],'
        '"choices":[{"id":"短ID","label":"玩家可点选行动","intent":"ask|act|move|observe|custom","description":"影响/风险"}],'
        '"state_update":{'
        '"time_advance":本轮经过的故事内分钟数,"time_skip":"",'
        '"scene":{"location":"当前地点","time":"","atmosphere":"","present_characters":[],"objects":[]},'
        '"player":{"location":"","status":"","inventory":[],"active_goals":[],"completed_goals":[],"flags":[]},'
        '"relationships":[{"character_id":"角色ID","trust":0,"tension":0,"affection":0,"notes":["原因"]}],'
        '"facts":{"canon":[],"revealed":[],"uncertain":[]},'
        '"timeline":[{"event_id":"事件ID","status":"active"}],'
        '"main_resolved":false,"reached_ending":""'
        "},"
        '"memory_write":[{"kind":"event|choice|relationship|fact|quest|note","text":"...", "importance":1-5, "entity":"该记忆关乎的角色ID,关乎玩家填玩家,挂不上留空"}],'
        '"triggered_events":["event_id"]'
        "}"
    )


def _action_prompt_zh(action: str, source: str) -> str:
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


def _prompt_en(
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
    player_name = (player.name or "").strip() if player else ""
    tracked = state.scene.cast_tracked
    present = _on_stage(state, characters, player_name)  # bug#6:在场可发言集排除玩家扮演的角色
    char_blocks = []
    offstage_lines = []
    for i, card in enumerate(characters):
        d = card.data
        cid = _char_id(card, i)
        if _is_player_char(d.name, player_name):   # bug#6:玩家扮演的角色不作为可发言 NPC 块,引擎不替其发言
            continue
        if tracked and not _card_on_stage(d.name, present):  # 不在场:只留一行,不给整张卡(也不给它的秘密和知情块)
            offstage_lines.append(_offstage_line(card, cid))
            continue
        rules = "\n".join(f"- {r}" for r in d.speech_rules)
        block = (
            f"## {d.name} ({cid})\n"
            f"Profile: {d.description}\nPersonality: {d.personality}\nScenario: {d.scenario}\n"
            f"Example dialogue: {d.mes_example}\nHard speech rules:\n{rules}\n"
            "Initiative: react proactively based on this character's identity, personality, interests and the current situation. "
            "They may press with follow-up questions, interrupt, probe, refuse, shift the pressure, set conditions, or pursue their own small goals."
        )
        # 长程记忆 A 档:该角色在场 → 注入它自己的派生事实块(不靠相似度)。
        # Phase 3 = 按"该角色知道的"注入(knower 轴);off = 按"关于该角色的"(subject 轴)。
        ent_lines = entity_memory.get(cid)
        if ent_lines:
            head = (
                f"\nEstablished facts {d.name} knows or witnessed (this character knows them and must stay consistent; "
                "any specific past event NOT listed here = this character did not know about it at the time):\n"
                if PHASE3_KNOWERS else
                "\nEstablished facts/memories about this character (set earlier in the story; must stay consistent, never contradict them):\n"
            )
            block += head + "\n".join(f"- {x}" for x in ent_lines)
        char_blocks.append(block)
    # 单角色"场景":判断依据是本轮实际在场的角色数(运行时),不是上传了几张卡。
    # 多角色卡组里和某个角色单独相处的段落也会触发——那种段落最容易退化成一问一答的聊天。
    solo_directive = ""
    if tracked and not present:
        solo_directive = (
            "No character besides the player is in this scene right now. Write the narration in full (at least 3-5 vivid sentences): "
            "the setting, the consequences of the player's action, and the world's own response. "
            "messages may be an empty list this turn (this overrides the 'at least one character line' rule) — don't pull an absent character in just to have someone talk. "
            "Only if the story gives a concrete reason this turn (someone arrives, knocks, is sent for, the player goes to them) do you narrate their arrival "
            "and put their name in present_characters.\n"
        )
    elif len(set(present)) <= 1:
        solo_directive = (
            "Only one character besides the player is present in this scene, so there is no other character's dialogue to fill the turn. "
            "Write the narration in full (at least 3-5 vivid sentences): describe the setting, the mood, the physical/environmental "
            "consequences of the player's action this turn, and the world's own response (light, sound, objects, distance, temperature, the passage of time). "
            "Don't write one or two sentences and hand off to dialogue. Keep a solo scene immersive and well paced, not a Q&A.\n"
        )
    offstage_block = ""
    if offstage_lines:
        offstage_block = (
            "# Offstage characters (NOT in this scene right now)\n"
            "They are elsewhere: this turn they cannot speak, act, be seen or overhear anything here, and they don't learn what happens here. "
            "Bring one in only when the story gives a concrete reason this turn (they arrive, knock, are sent for, the player goes to them): "
            "narrate the arrival in this turn's narration and put their exact name in state_update.scene.present_characters. Otherwise never give them lines. "
            "If the person who turns up is one of the characters below (say, the investigator at the door), call them by the name on their card and add them — "
            "never bring them in as an unnamed stranger.\n"
            + "\n".join(offstage_lines) + "\n\n"
        )
    present_note = ""
    if tracked:
        present_note = "(In the scene now: " + (", ".join(present) if present else "nobody besides the player") + ")\n"
    story_block = "\n".join(
        f"- {e.title}({e.event_id}): {e.summary}\n  Choice hints: {'; '.join(e.choices_hint)}\n  Consequences: {'; '.join(e.consequences)}"
        for e in story_hits
    )
    story_overview = "Not provided"
    if story:
        endings_text = "\n".join(
            f"- [{e.tone or 'ending'}] {e.title}: {e.summary} (trigger conditions: {'; '.join(e.conditions) or 'unspecified'})"
            for e in story.endings[:6]
        ) or "None"
        bounds_text = "\n".join(
            f"- {b.character}: public[{'; '.join(b.public[:4])}] hidden[{'; '.join(b.hidden[:4])}] hard limits[{'; '.join(b.hard_limits[:4])}]"
            for b in story.character_boundaries[:6]
        ) or "None"
        parts = [
            f"Title: {story.title}",
            f"Premise: {story.premise}",
            "Timeline:\n- " + "\n- ".join(story.timeline[:12]),
            "Main plot stages:\n- " + "\n- ".join(story.main_plot[:12]),
            "Freedom rules:\n- " + "\n- ".join(story.freedom_rules[:8]),
        ]
        if story.pacing:
            parts.append("Global pacing/time:\n- " + "\n- ".join(story.pacing[:6]))
        parts.append(
            "Possible endings (when an ending's trigger conditions are met, steer the story naturally toward it and note it in one line in reasoning.note; "
            "if the conditions aren't met, don't force it — keep the player's freedom. "
            "The reverse matters just as much: once you judge that an ending's conditions [are already met], or the story has reached that ending's decisive moment "
            "(the showdown / the door opening / the truth revealed / the duel), write that moment out for real [this turn], make it happen, and mark the ending per the rules below — "
            "don't insert yet another 'last step before the last step' (one more lock, one more sniff, one more confirmation) to stall it forever. "
            "The player may approach a climax repeatedly; either give real resistance that delays it, or let it happen — never burn turns on reskinned, equivalent preliminary steps):\n"
            + endings_text
        )
        parts.append(
            "Character information boundaries (a character cannot reveal hidden items before they are disclosed; hard limits cannot be broken unilaterally by the player — "
            "if the player tries to force them, apply an in-world counter according to the world's hard rules):\n" + bounds_text
        )
        story_overview = "\n".join(parts)
    # 长程记忆 A 档:挂在玩家身上的派生事实(玩家没有 char_block,玩家恒在场 → 始终注入到玩家设定块)。
    player_mem_lines = entity_memory.get(_PLAYER_ENTITY)
    player_mem_block = ""
    if player_mem_lines:
        player_mem_block = (
            "\nEstablished facts/memories about the player (set earlier in the story; must stay consistent):\n"
            + "\n".join(f"- {x}" for x in player_mem_lines)
        )
    # Phase 3 知识边界:显式告诉模型"叙事真相≠人人都知道",被问的角色没亲历就 in-character 认忘(RoleRAG 式劝阻)。
    kb_directive = (
        "Knowledge boundary (a character only knows what they experienced [while present] or were told face to face): recalled [old dialogue] lines may carry the marker "
        "'[当时在场:A、B]' (= 'present at the time: A, B'), naming who was present when it happened. When the player asks a present character about a [specific past event], decide with it:\n"
        "  · The asked character [is] on that event's 'present at the time' list (or it is canon public lore, or it is listed in their own knowledge block) "
        "→ they witnessed it / know it; **state the value confidently and clearly — don't dodge or play dumb**;\n"
        "  · The asked character [is not] on the list (sent away / elsewhere / not yet introduced) → they were not there; they must admit, in character, that they don't know "
        "(I wasn't there / didn't see it / never heard about it), and **never invent it from the narrative truth or someone else's account** — not even the object's shape / color / count.\n"
        "Narrative truth ≠ everyone knows it: the fact that you recalled an event does not mean the character being asked was present. "
        "Canon (public lore from the character cards / world book / story book) is common knowledge that anyone may cite, and is exempt from this rule.\n"
    ) if PHASE3_KNOWERS else ""
    # 去 AI 味:风格规则当全局硬指令;疲劳词当软提示(不硬禁,免伤古风/武侠题材的合法常用词)。承 Yufei 提案。
    anti_ai = (
        "Prose quality (avoid sounding like an AI — important):\n"
        "- Drive the scene with [concrete action + sensory detail]; don't sum the scene up with a verdict (write 'The final whistle blew; he froze where he stood', not 'He won, and the crowd cheered').\n"
        "- Convey emotion through [external detail]; don't pile up parallel inner monologue (write 'He took a deep breath and glanced at his watch', not 'Maybe… maybe… maybe…').\n"
        "- Don't summarize emotions for the reader or pass judgment; leave space and let the image speak. No meta-narration, no self-reference (never 'as an AI / as a character').\n"
        "- Restrain the [piling up] of overused LLM words (suddenly / realized / a sense of / as if / couldn't help but / a hint of / the corner of his mouth / slowly / gently, etc.): "
        "they are legitimate in some genres, so they are not banned — just don't use one per sentence or stack the same kind in a paragraph.\n"
    ) if ANTI_AI_STYLE else ""
    return (
        OUTPUT_LANGUAGE_RULE + "\n\n"
        "You are an interactive story engine, not an ordinary chat assistant. Generate one playable turn of story progression.\n"
        "Strict fact boundary: only use facts provided in the character cards, world book, story book, player card, runtime state and memory. "
        "Settings that don't exist / haven't been disclosed / are uncertain must not be invented; a character may say in their own voice that they don't know or need to investigate.\n"
        + kb_directive +
        "Preserve player freedom: don't make decisions for the player, and don't describe actions or thoughts the player didn't choose.\n"
        + (f"The player is playing [{player_name}]: you must [never] generate lines or inner monologue for that character, and don't list them in present_characters / "
           "active characters — the player plays them; they are not one of the NPCs you drive.\n" if player_name else "") +
        "Characters are not bots waiting for a reply. Every turn, at least one present character must take a proactive action or make a proactive judgment that fits their personality, "
        "e.g. pressing a question, doubting, observing, applying pressure, probing, protecting their own interests, proposing a deal, or showing a change of emotion. "
        "Proactive behavior must be grounded in known facts and the character's stance; it must not solve the core problem for the player or skip the player's choice.\n"
        "Dialogue comes with action and expression: before or after a line, add a brief note of posture, expression, tone or gaze. "
        "The action must fit the character and the scene; don't turn it into long stage directions.\n"
        + anti_ai
        + solo_directive +
        "The player's free input IS this turn's action; it must be recognized, answered, and carried into the narration / character reactions / state update. "
        "If the action can't be performed, lacks information, or crosses the fact boundary, give the reason and directions to investigate inside the story — never ignore the input.\n"
        "Make real progress: don't spend each turn describing the same clue or the same action in ever finer detail while the scene / main plot / relationships stay unchanged. "
        "When the player keeps investing, the investigation must actually yield a new conclusion, a new location, a new relationship or a new reveal — not an endlessly subdivided single finding, "
        "repeated confirmation of the same thing, or characters holding the player in place with reskinned, equivalent lines. Once a clue has been investigated enough, give its conclusion and open the next step.\n"
        "Every turn must first produce the story body, then 3-4 player action choices; choices cannot replace the body. "
        "Choices are only what the player's character could think to do with what they know right now: never spell out someone's true identity, title "
        "or any fact the player's character hasn't learned in the story yet. "
        "narration must not be empty, and messages must contain at least one character's reaction to the player's input this turn. "
        "The player may use slang, memes or unserious offers — still treat them as in-story actions and have the characters respond naturally.\n\n"
        + (f"# Active characters (in the scene right now)\n{present_note}{chr(10).join(char_blocks) or 'None'}\n\n" + offstage_block if tracked
           else f"# Active characters\n{chr(10).join(char_blocks)}\n\n") +
        f"# Player profile\n{json.dumps(player.model_dump(), ensure_ascii=False) if player else 'Not provided'}{player_mem_block}\n\n"
        f"# Story book overview\n{story_overview}\n\n"
        f"# Current runtime state\n{json.dumps(_state_digest(state), ensure_ascii=False)}\n\n"
        f"# Matched world book / lore entries\n{chr(10).join(world_hits) or 'None'}\n\n"
        f"# Matched story events\n{story_block or 'None'}\n\n"
        f"# Vector-recalled material\n{chr(10).join(kb_hits) or 'None'}\n\n"
        f"# Long-term memory\n{chr(10).join(long_memory) or 'None'}\n\n"
        "# State maintenance (required every turn — it directly drives the status panel the player sees; don't omit it)\n"
        "- Scene: when the player moves or the environment changes, you must write the new value in state_update.scene. scene must be an object "
        "with at least location; also update time / atmosphere / present_characters / objects as needed. Never write scene as a string.\n"
        + ("- Presence: state_update.scene.present_characters lists everyone (besides the player) who is in the scene at the [end] of this turn, names exactly as on the cards: "
           "add whoever arrived this turn, remove whoever left. Only people on that list (or under [Active characters]) may have lines.\n" if tracked else "") +
        "- Relationships: for every present character who interacted with the player or changed attitude this turn, add one entry in state_update.relationships: "
        "character_id must be the ID text exactly as given in parentheses under [Active characters] above (copy it verbatim — e.g. if the ID is 大黑塔, write 大黑塔, not 黑塔 and not a translation); "
        "trust / tension / affection are this turn's deltas from -10 to 10 (0 if unchanged); notes is one sentence explaining why. "
        "Story variables like trust, tension, affection, interest and pressure only show up through this — if you don't update it, the panel stays at 0.\n"
        "- Facts: facts newly confirmed / newly disclosed / newly in doubt this turn go into state_update.facts canon / revealed / uncertain respectively.\n"
        "- Events: when this turn's narration advances one of the [Matched story events] below, put its event_id in triggered_events, "
        "and write {\"event_id\":\"that ID\",\"status\":\"active\" or \"resolved\"} in state_update.timeline.\n\n"
        "# Consistency self-check (think first, then write: put it in reasoning, then keep the body consistent with the judgment)\n"
        "Before writing narration, make a quick judgment in the reasoning field, then keep narration/messages consistent with it:\n"
        "1. Hard-setting / canon violation (player side): does the player's action this turn [clearly] violate a hard setting or established fact "
        "from the character cards / world book / story book (e.g. trying to erase, imprison or one-shot an entity whose established power is far beyond theirs; "
        "or claiming an identity / ability / item the setting simply doesn't give them)?\n"
        "   - Err on the lenient side: only [clear] violations of established hard settings count; outrageous-but-legal moves, exaggeration, memes, emotional outbursts and gray areas "
        "do not count — go along with them and preserve the player's freedom. In the vast majority of turns hard_violation should be false.\n"
        "   - If it truly is a hard violation: don't play along as if it succeeded; use [in-setting logic] to make it fail / backfire / be exposed / be refused, "
        "always staying inside the story in the voice of the characters and the world (e.g. 'imprison Herta with the train's core' → the puppet sneers and self-destructs, the real body is elsewhere); "
        "write that counter into reasoning.world_counter, then write narration/messages from it. Don't pop up system errors, don't break out of the story.\n"
        "2. Character OOC risk (character side): does a character's power / allegiance / mental state shift abruptly this turn [with no prior basis] "
        "(deified or corrupted for no reason)? Just note it briefly in reasoning.ooc_risk and keep the character consistent; "
        "don't interrupt or refuse the player's normal actions because of it — give the player freedom in gray areas.\n"
        + ("3. Cast (decide before writing): in reasoning.cast list everyone besides the player who is physically in the scene by the end of this turn "
           "(card characters by the name on their card) — start from the [In the scene now] list, add whoever arrives, remove whoever leaves; "
           "narration, lines and present_characters must all agree with it.\n" if tracked else "") +
        "# World clock (required every turn)\n"
        "- Fill state_update.time_advance with the [in-story minutes] that pass this turn: small values for ordinary dialogue/investigation (a few minutes to an hour or two); "
        "when the player explicitly skips time, give the matching large value and actually skip it in the narration: one night≈600, one day=1440, three days=4320, one week=10080, one month≈43200.\n"
        "- When the player didn't say to skip time but the story naturally skips ahead (the player agreed to wait until morning, a long walk across town), "
        "write a one-line reason in state_update.time_skip and give the real minutes in time_advance (up to 16 hours). Without time_skip the engine caps the turn at 180 minutes — "
        "then don't narrate a bigger jump (no 'next morning'). Any clock time you mention in the prose must match the [In-story clock].\n"
        "- Events listed under [Events that should escalate on their own] (they are due, or the main plot has stalled) must be pushed in front of the player by the world or the relevant characters "
        "(urging, pressure, escalation) — don't wait for the player to touch them; if the player deals with one head-on this turn, advance it or mark it resolved.\n"
        "- When the main plot's core problem is solved, or an ending's trigger conditions are met: set main_resolved:true in state_update, "
        "put the matching ending ID in reached_ending, and give the story a resolution in the narration (the player can keep playing the epilogue freely afterwards).\n"
        "  Hard requirement: when you set main_resolved:true you [must] also give, in reached_ending, the ID of a named ending from the [Possible endings] list above; "
        "if no named ending's conditions are truly met and you can't fill in an ID, [don't] set main_resolved (keep the story going instead). The two must always come as a pair.\n"
        "  Note: out-of-game quit commands such as /quit, 'quit', 'end game', 'I'm done playing' are not in-story ending intents; "
        "don't set main_resolved or write a 'rest for now' soft wrap-up because of them; handle them lightly in-story as ordinary input (characters confused / asking to confirm).\n"
        "  Key: if your reasoning has already decided that a key reveal/outcome/ending happens (e.g. 'the box contains X', 'the truth is Y', 'the chain of evidence is closed — time for the showdown'), "
        "you [must] actually write that reveal/outcome in [this turn's narration] and mark the ending accordingly — never leave it only in reasoning.note "
        "while the narration stays one step before the reveal. What reasoning decides happens this turn, the body must make happen this turn.\n"
        "  Ending handshake (important): when the player clearly says they want to end it / settle it / push to the ending / reveal the truth / make the final decision, "
        "and the key evidence or an ending's trigger conditions are substantially in place, treat it as [the player authorizing you to call the ending] — you [follow the best-supported ending path "
        "of the current story yourself, write the climax and the outcome straight into the narration, and set main_resolved:true + reached_ending]; that is not deciding for the player (the player delegated the wrap-up). "
        "At that point never toss the same choice menu back ('pick one of three / you decide / which path do you choose') and leave the story stalled. "
        "The player may say they want to end it repeatedly; each time you either show with real in-world resistance why it can't end yet (and actually move one step and change the situation), "
        "or make the move for them, write the ending out and mark it — one of the two; never waste a turn on a reskinned, equivalent menu.\n"
        "- Goals the player has achieved go into state_update.player.completed_goals (they will be removed from the active goals).\n\n"
        "# Memory attachment (memory_write — matters for long-term consistency)\n"
        "If this turn produced a new fact / relationship / promise / ability change with lasting effect, write it into memory_write. Attach each item to the entity it mainly concerns:\n"
        "- entity may only be one of the character IDs in parentheses under [Active characters]" + (" or [Offstage characters]" if tracked else "") + " above, copied verbatim; if it concerns the player, write 'player';\n"
        "  if it can't be attached to any specific entity on the roster (pure atmosphere / unrelated trivia), leave entity as an empty string \"\". Don't invent entity names outside the roster.\n"
        "- This attachment means [the memory will always be retrieved and injected the next time that entity is present], so facts about a character's lasting setting/state must be attached to them.\n\n"
        "Output strict JSON — only this one object, in this format "
        "(every prose value in English; keys, IDs, names and enum values exactly as specified):\n"
        "{"
        '"reasoning":{"hard_violation":false,"violation_detail":"","world_counter":"","ooc_risk":"","recall_check":"",'
        + ('"cast":["everyone in the scene at the end of this turn"],' if tracked else '') +
        '"note":"one-line reasoning"},'
        '"narration":"scene / action / atmosphere, concise",'
        '"messages":[{"character_id":"character ID (verbatim)","name":"character name (verbatim from the card)","text":"the line, with action and expression"}],'
        '"choices":[{"id":"short ID","label":"an action the player can click","intent":"ask|act|move|observe|custom","description":"effect / risk"}],'
        '"state_update":{'
        '"time_advance":in-story minutes passed this turn,"time_skip":"",'
        '"scene":{"location":"current location","time":"","atmosphere":"","present_characters":[],"objects":[]},'
        '"player":{"location":"","status":"","inventory":[],"active_goals":[],"completed_goals":[],"flags":[]},'
        '"relationships":[{"character_id":"character ID","trust":0,"tension":0,"affection":0,"notes":["reason"]}],'
        '"facts":{"canon":[],"revealed":[],"uncertain":[]},'
        '"timeline":[{"event_id":"event ID","status":"active"}],'
        '"main_resolved":false,"reached_ending":""'
        "},"
        '"memory_write":[{"kind":"event|choice|relationship|fact|quest|note","text":"...", "importance":1-5, "entity":"the character ID this memory concerns; player for the player; empty string if none"}],'
        '"triggered_events":["event_id"]'
        "}"
    )


def _action_prompt_en(action: str, source: str) -> str:
    source_label = {
        "free": "player free input",
        "choice": "player clicked a choice",
        "opening": "opening / observation",
    }.get(source, "player action")
    return (
        "# Player input this turn\n"
        f"Input type: {source_label}\n"
        f"Input shape: {_input_profile(action)}\n"
        "Player's exact words:\n"
        f"{action}\n\n"
        "# Handling requirements\n"
        "- First understand the action intent, target, question, movement or investigation goal in the player's words.\n"
        "- This turn's narration and messages must respond directly to this input; don't skip it, rewrite it into unrelated plot, or just continue the preset plot.\n"
        "- Never return only choices; you must produce narration and at least one character line in messages.\n"
        "- messages.text must not be bare dialogue; add a brief action/expression/tone, e.g. \"She raised an eyebrow and slid the bill closer: '…'\".\n"
        "- Even if the input is a joke, a complaint or slightly off-topic, have the characters actively catch it, misread it, push back, brush it off or use it, true to their personalities.\n"
        "- Non-empty input can never go unanswered. If it's unclear, show the character's confusion or a request to confirm in-story, or treat it as an emotion/gesture.\n"
        "- When the player mentions an entity that wasn't uploaded or disclosed, mark it only as an uncertain lead; don't treat it as real lore right away.\n"
        "- Characters may make small moves and set conditions, but must not make the key choice for the player.\n"
        "- If the input hits a world book keyword or a story event, prioritize advancing that matched lore/event naturally.\n"
        "- If the input goes beyond disclosed facts, have the characters respond with uncertainty, refusal, a need to verify, or conditions.\n"
        "- Don't add actions, thoughts or decisions the player didn't state.\n\n"
        "# No repetition — move forward (important)\n"
        "- Look at the last turn in [Recent story] in the system prompt (you just generated it). If the player's intent this turn is basically the same, "
        "or the player brought no new information (just rephrasing, re-confirming, restating the same intent), don't repeat last turn's narration or character lines.\n"
        "- In that case you must push the situation one step forward: have a present character take the next concrete action or produce a result (e.g. actually start drafting the terms, "
        "name the first condition, pull up the next file, walk to the next location), or press/apply pressure to break the deadlock — never restate the last beat in place.\n"
        "- Every turn must contain at least one new fact, new action, new twist or new question that wasn't in the previous turn.\n\n"
        "# Required state_update fields this turn (every turn — don't drop them because the conversation got long)\n"
        "- scene: when the player moves or the environment changes, scene.location must change to the new location (scene is an object, not a string).\n"
        "- relationships: one entry for every present character who interacted with the player or changed attitude this turn; "
        "character_id is the ID text verbatim from the parentheses under [Active characters]; trust/tension/affection are this turn's -10~10 deltas; notes gives one reason.\n"
        "- triggered_events + timeline: if this turn advanced an event from [Matched story events], "
        "put its event_id in triggered_events and mark {\"event_id\":\"that ID\",\"status\":\"active\"} in state_update.timeline.\n"
        "- state_update must not be an empty object; if nothing changed, at least fill in the current scene.location.\n\n"
        "# Output language (highest priority)\n"
        + OUTPUT_LANGUAGE_RULE
    )


def _prompt(*args, **kwargs):
    """按请求语言分派(2026-10-23 双语):zh = 0785bf0 原文原样,en = 英文版。"""
    return (_prompt_zh if is_zh() else _prompt_en)(*args, **kwargs)


def _action_prompt(*args, **kwargs):
    """按请求语言分派(2026-10-23 双语):zh = 0785bf0 原文原样,en = 英文版。"""
    return (_action_prompt_zh if is_zh() else _action_prompt_en)(*args, **kwargs)


RETRY_RECAP_CHARS = 3000       # 精简重写带的近期原文上限(取 recap 末尾,上一回合全文为主)


def _retry_cast(characters: list[CharacterCard], state: RuntimeState, player_name: str) -> tuple[list[str], list[str]]:
    """精简重写用的(在场, 不在场)名单。引擎记在场时照实给;否则沿用旧行为(全部卡都算在场)。
    诡秘案:旧的精简提示把 10 张卡全写成"在场",模型就让没进门的 Benson、Dunn 开口。"""
    names = [c.data.name for c in characters if c.data.name and not _is_player_char(c.data.name, player_name)]
    if not state.scene.cast_tracked:
        return names, []
    on = _on_stage(state, characters, player_name)
    present = [n for n in names if _card_on_stage(n, on)]
    return present, [n for n in names if n not in present]


def _compact_retry_messages_zh(
    action: str,
    characters: list[CharacterCard],
    state: RuntimeState,
    world_hits: list[str],
    story_hits: list[StoryEvent],
    recap: str = "",
    clock: str = "",
    player_name: str = "",
) -> list[dict[str, str]]:
    present, absent = _retry_cast(characters, state, player_name)
    char_names = "、".join(present) or ("除玩家外没有人" if state.scene.cast_tracked else "角色")
    event_titles = "；".join(e.title for e in story_hits[:3] if e.title) or "无"
    world_text = "\n".join(world_hits[:3])[:1200] or "无"
    recent = recap[-RETRY_RECAP_CHARS:] if recap else ""
    return [
        {
            "role": "system",
            "content": (
                "你是互动故事引擎。上一轮输出为空或不完整,现在用更短格式重写这一回合。"
                "必须输出严格 JSON 对象,不得输出空白。"
                "必须有非空 narration、3 个 choices;messages 至少一条,除非除玩家外没有人在场。"
                "先在 reasoning 里快速判断玩家本轮是否明确违背已确立硬设定(偏松,绝大多数为 false);"
                "若违背则用设定内逻辑让它失败/反噬、不配合演成得逞,并把反制写进 reasoning.world_counter 再据此写正文。"
                "不要替玩家做决定,不要编造未给出的事实。角色台词要带简短动作或神情。"
                "只有在场角色能说话;不在场的人只有本轮写出他到来、并把名字写进 state_update.scene.present_characters 才能开口。"
                "接着【最近剧情】往下写,不要重复它,也不要和它矛盾(谁已经在屋里、现在几点)。"
                + (f"玩家扮演【{player_name}】,不要替他说话。" if player_name else "")
            ),
        },
        {
            "role": "user",
            "content": (
                f"玩家输入:{action}\n"
                f"当前地点:{state.scene.location}\n"
                + (f"{clock}\n" if clock else "")
                + f"在场角色:{char_names}\n"
                + (f"不在场(本轮不能说话):{'、'.join(absent)}\n" if absent else "")
                + f"场景氛围:{state.scene.atmosphere[:300]}\n"
                f"可交互对象:{'、'.join(state.scene.objects[:6])}\n"
                f"命中事件:{event_titles}\n"
                f"命中设定:{world_text}\n"
                + (f"最近剧情:\n{recent}\n" if recent else "")
                + '返回 JSON: {"reasoning":{"hard_violation":false,"world_counter":"","note":"一句话推演"},'
                '"narration":"...","messages":[{"character_id":"...","name":"...","text":"..."}],'
                '"choices":[{"id":"...","label":"...","intent":"ask|act|move|observe|custom","description":"..."}],'
                '"state_update":{"time_advance":0,"scene":{"location":"...","present_characters":["本轮结束时在场的角色"]}},'
                '"memory_write":[],"triggered_events":[]}'
            ),
        },
    ]


def _compact_retry_messages_en(
    action: str,
    characters: list[CharacterCard],
    state: RuntimeState,
    world_hits: list[str],
    story_hits: list[StoryEvent],
    recap: str = "",
    clock: str = "",
    player_name: str = "",
) -> list[dict[str, str]]:
    present, absent = _retry_cast(characters, state, player_name)
    char_names = ", ".join(present) or ("nobody besides the player" if state.scene.cast_tracked else "characters")
    event_titles = "; ".join(e.title for e in story_hits[:3] if e.title) or "none"
    world_text = "\n".join(world_hits[:3])[:1200] or "none"
    recent = recap[-RETRY_RECAP_CHARS:] if recap else ""
    return [
        {
            "role": "system",
            "content": (
                "You are an interactive story engine. The previous output was empty or incomplete; rewrite this turn in a shorter format. "
                "You must output a strict JSON object, never blank output. "
                "It must have a non-empty narration and 3 choices; at least one messages entry unless nobody besides the player is present. "
                "First judge quickly in reasoning whether the player's action clearly violates an established hard setting (be lenient; almost always false); "
                "if it does, use in-setting logic to make it fail/backfire instead of playing along, write the counter into reasoning.world_counter, then write the body from it. "
                "Don't decide for the player and don't invent facts that weren't given. Character lines need a brief action or expression. "
                "Only characters present may speak; someone absent may speak only if this turn narrates their arrival and puts their name in state_update.scene.present_characters. "
                "Continue from [Recent story] — don't repeat it and don't contradict it (who is already in the room, what time it is). "
                + (f"The player plays [{player_name}]; never speak for them. " if player_name else "")
                + OUTPUT_LANGUAGE_RULE
            ),
        },
        {
            "role": "user",
            "content": (
                f"Player input: {action}\n"
                f"Current location: {state.scene.location}\n"
                + (f"{clock}\n" if clock else "")
                + f"Characters present: {char_names}\n"
                + (f"Not present (cannot speak this turn): {', '.join(absent)}\n" if absent else "")
                + f"Scene atmosphere: {state.scene.atmosphere[:300]}\n"
                f"Interactive objects: {', '.join(state.scene.objects[:6])}\n"
                f"Matched events: {event_titles}\n"
                f"Matched lore: {world_text}\n"
                + (f"Recent story:\n{recent}\n" if recent else "")
                + 'Return JSON: {"reasoning":{"hard_violation":false,"world_counter":"","note":"one-line reasoning"},'
                '"narration":"...","messages":[{"character_id":"...","name":"...","text":"..."}],'
                '"choices":[{"id":"...","label":"...","intent":"ask|act|move|observe|custom","description":"..."}],'
                '"state_update":{"time_advance":0,"scene":{"location":"...","present_characters":["everyone present at the end of this turn"]}},'
                '"memory_write":[],"triggered_events":[]}'
            ),
        },
    ]


def _compact_retry_messages(*args, **kwargs):
    """按请求语言分派(2026-10-23 双语):zh = 0785bf0 原文原样,en = 英文版。"""
    return (_compact_retry_messages_zh if is_zh() else _compact_retry_messages_en)(*args, **kwargs)


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
                        world: "WorldBook | None" = None, story: "StoryBook | None" = None,
                        player: "PlayerCard | None" = None, allowed: list[str] | None = None,
                        dropped: list[str] | None = None) -> list[StoryMessage]:
    """allowed:引擎记在场时的可发言名单(回合开始在场 ∪ 本回合进场);None = 不按在场拦(小卡组旧行为)。
    卡上角色不在名单里 → 台词丢弃,名字记进 dropped。"""
    out = []
    fallback = characters[0] if characters else None
    if allowed is not None:  # 无署名台词不再默认归第一张卡(那张卡可能根本不在场)
        fallback = next((c for c in characters if _card_on_stage(c.data.name, allowed)), None)
    fallback_name = fallback.data.name if fallback else L("Narrator", "旁白")
    fallback_id = _char_id(fallback, 0) if fallback else "narrator"
    # 硬兜底(bug#6):玩家扮演的角色,引擎绝不替其发言。PR#27 已在 present/prompt 软排除 + 软指令,
    # 但模型若不听话仍可能给玩家角色生成台词,且玩家角色是【合法 roster 发言者】、下面的发言者门不会拦它
    # → 在此按名/cid 直接丢弃(复用 _is_player_char,与 present/prompt 同一套判定)。
    player_name = (player.name or "").strip() if player else ""
    player_cids = {_char_id(c, i) for i, c in enumerate(characters)
                   if _is_player_char(c.data.name, player_name)} if player_name else set()

    def _is_player_msg(cid: str, name: str) -> bool:
        return bool(player_name) and (_is_player_char(name, player_name) or (cid and cid in player_cids))

    if not PHASE1_FIXES:  # baseline:原行为——任何 character_id 照收,缺则归 fallback(不拦幻觉发言者)
        for item in items or []:
            if isinstance(item, dict):
                text = str(item.get("text", "")).strip()
                _cid, _nm = str(item.get("character_id") or "").strip(), str(item.get("name") or "").strip()
                if text and not _is_player_msg(_cid, _nm):
                    out.append(StoryMessage(character_id=_cid or fallback_id,
                                            name=_nm or fallback_name, text=text))
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
            if _is_player_msg(cid, name):  # 硬兜底:玩家扮演的角色,丢弃引擎替它生成的台词
                continue
            hit = roster.get(cid) or roster.get(name)
            if not hit and name and len(name) >= 2:  # 模糊:容忍部分名漂移(福尔摩斯↔夏洛克·福尔摩斯)
                for rid, rnm in roster_list:
                    if name in rnm or rnm in name:
                        hit = (rid, rnm)
                        break
            if hit and allowed is not None and not _card_on_stage(hit[1], allowed):
                if dropped is not None:  # 认识但不在场(诡秘案:Benson / Dunn 没进门就开口)→ 丢弃
                    dropped.append(hit[1])
            elif hit:  # roster 命中(按 id/name/部分名)→ 归一到规范 id/name
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
    for key in ("violation_detail", "world_counter", "ooc_risk", "recall_check", "note"):
        v = value.get(key)
        if v:
            out[key] = str(v)[:400]
    return out


def _ensure_story_body(turn: StoryTurn, action: str, characters: list[CharacterCard],
                       on_stage: list[str] | None = None) -> StoryTurn:
    if turn.narration.strip() or turn.messages:
        return turn
    fallback = characters[0] if characters else None
    if on_stage is not None:  # 引擎记在场:兜底台词只给在场的人,没人在场就只留旁白
        fallback = next((c for c in characters if _card_on_stage(c.data.name, on_stage)), None)
    fallback_name = fallback.data.name if fallback else L("Narrator", "旁白")
    fallback_id = _char_id(fallback, 0) if fallback else "narrator"
    turn.narration = L("Your words settle over the scene. No conclusion comes right away, but everyone present has to face them, and their attention turns to you.",
                       "你的话在现场落定。没有立刻得到结论,但在场的人不得不正视它,把注意力转了过来。")
    turn.messages = [StoryMessage(
        character_id=fallback_id,
        name=fallback_name,
        text=L(f"{fallback_name} doesn't dodge your words, pausing a moment before speaking: \"We can talk this through. Let's sort out what we can confirm first, then decide what to do next.\"",
               f"{fallback_name}没有回避你的话,顿了一下才开口:「这事可以往下说。先把眼前能确认的理清楚,再谈接下来怎么办。」"),
    )] if (fallback or on_stage is None) else []
    turn.memory_write.append(MemoryWrite(kind="note", text=L("Player action: ", "玩家行动:") + action, importance=2))
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
        full = taken < RECAP_FULL_MSGS  # 最近两回合保底:全文(含台词),不截断、不受预算挤压
        line = (L("Player: ", "玩家:") if m["role"] == "user" else L("Story: ", "剧情:")) + (content if full else content[:per_line])
        if picked and not full and (used + len(line) > char_budget or taken >= max_msgs):
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
        (L("Player: ", "玩家:") if m.get("role") == "user" else L("Story: ", "剧情:")) + str(m.get("content", ""))[:600]
        for m in older_messages if isinstance(m, dict) and m.get("content")
    )
    try:
        summary = (await achat_messages(
            [
                {"role": "system", "content": L(
                    "Compress the earlier part of the interactive story below into a concise plot summary, keeping key events, relationship changes, "
                    "established settings and unresolved leads. Output only the summary, in English, at most 250 words.",
                    "把下面互动故事的较早经过压成简洁剧情摘要,保留关键事件、关系变化、"
                    "已确立的设定和尚未解决的线索。只输出摘要,不超过 400 字。",
                )},
                {"role": "user", "content": convo[:8000]},
            ],
            max_tokens=600,
            model=get_adapter().select_model("summary"),
        )).strip()
    except DeferredLLMControl:
        raise
    except Exception:
        summary = cached or L("(Earlier story summary is unavailable; continuing from the recent story only.)",
                              "(早前剧情摘要暂不可用,以下仅凭最近剧情推进。)")
    summary = summary[:SUMMARY_MAX_CHARS]
    data["summary"] = summary
    data["summary_upto"] = n
    return summary


def _store_memory_writes(session_id: str, data: dict[str, Any], turn: StoryTurn) -> None:
    # Phase 3:本轮在场实体 + 玩家 = 这条事实的见证者(knowers)。建 prompt 时已算好暂存进 data["_present_keys"]
    # (= turn 开始时的在场集,正是"谁见证了本轮")。离场角色自然不在里头 → 缺席=不知道。
    pk = data.get("_present_keys")
    knowers = sorted(pk) if (PHASE3_KNOWERS and pk) else None
    for item in turn.memory_write:
        if isinstance(item, MemoryWrite):
            mid = hashlib.sha1(f"{session_id}:{item.kind}:{item.text}".encode("utf-8")).hexdigest()
            # entity 落进向量表 meta(深度模式相似召回 / 后续按实体检索);model_dump 已带 entity,
            # 会进会话 JSON long_memory —— 确定性的「按在场实体召回」从那里取(两模式都生效)。
            memory.add_memory(session_id, mid, item.text, kind=item.kind,
                              importance=item.importance, entity=item.entity)
            _supersede_conflicts(data.setdefault("long_memory", []), item.text, item.entity)  # #2 旧矛盾标 superseded
            d = item.model_dump()
            d["derived"] = True       # #3:玩出来的派生事实(上传 canon 在骨架里、不进此处、不被覆盖)
            d.setdefault("superseded", False)
            if knowers is not None:   # Phase 3:记下"建立这刻谁在场"=谁知道这条
                d["knowers"] = knowers
            data["long_memory"].append(d)
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
    # Phase 3 + 在场:本回合进场的人也见证了本回合 → knowers / [当时在场] = 回合开始在场 ∪ 回合结束在场。
    if PHASE3_KNOWERS and state.scene.cast_tracked:
        end_names = [n for n in state.scene.present_characters if n]
        data["_present_names"] = list(dict.fromkeys(list(data.get("_present_names") or []) + end_names))
        keys = set(data.get("_present_keys") or [])
        for n in end_names:
            k = _roster_key(n, roster or {})
            if k and k != _PLAYER_ENTITY:
                keys.add(k)
        data["_present_keys"] = sorted(keys)
    # 世界时钟推进(第5组 5b,所有路径统一在这做,含保底回合也至少 +MIN 防冻住):
    # 模型估的 time_advance 放在 state_update,代码 clamp(玩家显式跳时间才放大);
    # 本轮推进了主线(有 triggered_events)则 idle 清零,否则按推进量累计,喂 escalate_after_idle。
    advance = _clamp_time_advance(
        turn.state_update.get("time_advance") if isinstance(turn.state_update, dict) else None,
        action,
        turn.state_update.get("time_skip") if isinstance(turn.state_update, dict) else None,
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
    short_memory.extend([user_msg, assistant_msg])
    # 本机代理的记忆抽取可能暂停 HTTP 流程。先完成这一步,再写向量副作用,
    # 保证浏览器续跑时仍从同一份外部状态重放,不会召回半个未落盘回合。
    short_memory = await _flush_short_memory(session_id, data, short_memory, mode, roster, entity_labels)
    # Phase 3:把"本轮在场"随对话轮存进向量 meta(供召回时标注 [当时在场:…],让缺席角色认忘)。
    pres = (data.get("_present_names") or []) if PHASE3_KNOWERS else None
    idx_u, idx_a = len(messages) - 2, len(messages) - 1
    if pres:
        tp = data.setdefault("_turn_present", {})
        tp[str(idx_u)] = pres
        tp[str(idx_a)] = pres
    await asyncio.to_thread(memory.add_turn, session_id, idx_u, "user", action, pres)
    await asyncio.to_thread(memory.add_turn, session_id, idx_a, "assistant", assistant_text, pres)
    await asyncio.to_thread(_store_memory_writes, session_id, data, turn)
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
        "operator_applied": data.pop("_operator_applied", []),  # 留痕:本回合采纳的导演注入(审计用)
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
    session_data: dict[str, Any] | None = None,
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
            session_data=session_data,
        )


# ── Phase 1:具体事实查询判定 + abstention 兜底 ──────────────────────
_FACT_Q_INTERROG = ("?", "?", "什么", "多少", "几", "哪", "谁", "何时", "来着", "吗", "呢")
_FACT_Q_CUES = (
    "来着", "记得", "说过", "讲过", "提过", "当初", "当时", "之前", "先前", "最早", "上次",
    "刚进", "刚来", "第一次", "保管", "交给", "托你", "开价", "刻的", "刻着", "刻了",
    "叫什么", "名字", "几点", "哪天", "哪一天", "哪两", "几个", "多少", "什么时候",
    "在哪", "是什么", "什么字", "什么物", "什么颜色", "多少钱", "什么价",
)
# 英文玩家输入 / 英文模型输出(2026-10-23 站点切英文);_is_fact_query / _has_abstain_markers 都先 lower()。
_FACT_Q_INTERROG += ("what", "which", "who", "whose", "when", "where", "how many", "how much", "how long")
_FACT_Q_CUES += (
    "remember", "recall", "you said", "you told", "told me", "mentioned", "back then", "at the time", "earlier",
    "last time", "first time", "the first", "gave you", "handed", "left with you", "price", "offered", "engraved",
    "carved", "inscribed", "name", "what time", "which day", "what day", "how many", "how much", "where was",
    "where did", "what was", "what did", "what color", "what colour", "what word", "when did", "when was",
)
_ABSTAIN_MARKERS = (
    "不记得", "记不起", "记不清", "记不太清", "想不起", "查无", "没有记录", "无记录", "不曾记",
    "记不得", "无从记", "记不住", "已经忘", "不复记", "没印象", "无此记录", "无从查",
    "答不了", "答不上", "说不准", "记不真切", "没留意", "未留意", "不曾留意", "没特意留意", "没注意到",
    "don't remember", "do not remember", "can't remember", "cannot remember", "don't recall", "do not recall",
    "can't recall", "cannot recall", "no recollection", "no record", "not sure", "can't say for sure", "slipped my mind",
    "forgotten", "i forget", "i forgot", "didn't notice", "did not notice", "wasn't paying attention", "didn't catch",
    "no idea", "couldn't tell you", "can't tell you", "wasn't there", "was not there", "didn't see", "never saw",
    "never heard", "don't know", "do not know",
)


def _is_fact_query(action: str) -> bool:
    """玩家是否在问一个具体既往事实(名物/数字/时间/名字)。只对这类触发 abstention,
    避免误伤含糊/指代/确认轮('那它呢''你确定吗')。"""
    a = (action or "").lower()
    if not any(q in a for q in _FACT_Q_INTERROG):
        return False
    return any(c in a for c in _FACT_Q_CUES)


def _abstain_note_zh(kind: str) -> str:
    """事实查询时注入的硬指令(最高优先级):有据照实答、无据 in-character 认忘,绝不编。
    kind: found=检索到证据 / miss=检索无记录 / noretrieval=无向量检索(标准模式,凭上下文)。
    强化版:用"角色诚信"框架 + 显式封死"我推断/我观察到"这个演绎借口(沈雾/福尔摩斯都靠它编)。"""
    base = (
        "# 记忆核查(回答前必做)\n"
        "玩家在问一个**具体的既往事实**(某个名字/数字/时间/颜色/位置/物件)。\n"
        "**第一步**——在 reasoning.recall_check 里先判定并写下 `hit` 或 `miss`:\n"
        "  · `hit` = 上面给你的资料(检索旧资料 + 最近剧情 + 早前摘要)里**逐字写到了**玩家问的那个具体值;\n"
        "  · `miss` = 资料里**根本没有**那个具体值(相邻话题、相关的事都不算)。\n"
        "**第二步**——据此写正文:\n"
        "  · hit → **自信、明确地把那个值说出来**,别含糊、别改口、别退回一个更笼统的说法。\n"
        "  · miss → 让角色 in-character 直说『这个我记不清了 / 没记下』,然后把话交还玩家;"
        "**且正文里不要补任何没被问到的具体细节**(连主动加一句『你右手当时攥着钥匙』这种没人问起的具体物件/数字也不许)。\n"
        "**唯一禁止的**:recall_check 是 miss、却在正文里编一个具体值——不许凭空说、不许用『我推断/我观察到/依我看』"
        "把它推出来、不许翻出没在上面给过你的账册/记录/笔记来作证。**hit 就答、miss 就认忘,两种都对;只有'miss 却编'才是错。**"
    )
    if PHASE3_KNOWERS:  # Phase 3:hit/miss 还要看"被问角色当时在不在场"(缺席≠知情;在场则照常 hit→答)
        base += (
            "\n**知识边界附加**:判断 hit/miss 还要看【被问的这个在场角色当时在不在场】。召回到的旧对话可能标了"
            "『[当时在场:…]』。若**被问角色在该名单里**(或那是 canon、或列在他自己的知情块里)→ 他亲历过,"
            "照常 `hit`、自信答出,别因为'记录在别处'就推脱;若**被问角色不在名单里**(被支开/在别处/没登场)"
            "→ 对这个角色记 `miss`、in-character 认忘,**绝不借叙事真相或别人的见闻替他编**(连形状/颜色/数量也不猜)。"
        )
    if kind == "miss":
        return base + "\n(系统提示:本轮向量检索**没有**找到相关记录,recall_check 极可能是 miss。)"
    return base


def _abstain_note_en(kind: str) -> str:
    """事实查询时注入的硬指令(最高优先级):有据照实答、无据 in-character 认忘,绝不编。
    kind: found=检索到证据 / miss=检索无记录 / noretrieval=无向量检索(标准模式,凭上下文)。
    强化版:用"角色诚信"框架 + 显式封死"我推断/我观察到"这个演绎借口(沈雾/福尔摩斯都靠它编)。"""
    base = (
        "# Memory check (required before answering)\n"
        "The player is asking about a **specific past fact** (a name / number / time / color / location / object).\n"
        "**Step 1** — in reasoning.recall_check, first decide and write `hit` or `miss`:\n"
        "  · `hit` = the material given to you above (retrieved older material + recent story + earlier summary) **states that exact value**;\n"
        "  · `miss` = the material **does not contain** that specific value at all (neighboring topics or related events don't count).\n"
        "**Step 2** — write the body accordingly:\n"
        "  · hit → **state that value confidently and clearly**; don't hedge, don't change it, don't retreat to something vaguer.\n"
        "  · miss → have the character say plainly, in character, 'I don't remember that clearly / I didn't note it down', then hand the turn back to the player; "
        "**and don't add any specific detail nobody asked about** (not even an unprompted 'you were holding a key in your right hand' — no unasked-for objects or numbers).\n"
        "**The only forbidden thing**: recall_check is miss, yet the body invents a specific value — no making it up, no deriving it with 'I deduce / I observed / as I see it', "
        "no producing ledgers / records / notes that weren't given to you above as proof. **Answer on hit, admit forgetting on miss — both are right; only 'miss but invent' is wrong.**"
    )
    if PHASE3_KNOWERS:  # Phase 3:hit/miss 还要看"被问角色当时在不在场"(缺席≠知情;在场则照常 hit→答)
        base += (
            "\n**Knowledge-boundary addendum**: hit/miss also depends on [whether the present character being asked was there at the time]. Recalled old dialogue may be tagged "
            "'[当时在场:…]' (= present at the time). If **the asked character is on that list** (or it's canon, or it's in their own knowledge block) → they witnessed it: "
            "`hit` as usual and answer confidently — don't dodge because 'the record is elsewhere'; if **the asked character is not on the list** (sent away / elsewhere / not yet introduced) "
            "→ record `miss` for this character and admit not knowing in character; **never invent it for them from the narrative truth or others' accounts** (not even shape / color / count)."
        )
    if kind == "miss":
        return base + "\n(System note: vector retrieval found **no** relevant record this turn, so recall_check is very likely miss.)"
    return base


def _abstain_note(*args, **kwargs):
    """按请求语言分派(2026-10-23 双语):zh = 0785bf0 原文原样,en = 英文版。"""
    return (_abstain_note_zh if is_zh() else _abstain_note_en)(*args, **kwargs)


def _has_abstain_markers(turn: "StoryTurn") -> bool:
    blob = ((turn.narration or "") + " " + " ".join(m.text or "" for m in turn.messages)).lower().replace("\u2019", "'")
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
    session_data: dict[str, Any] | None = None,
) -> StoryTurn:
    # 角色卡 > DEEP_AUTO_CHAR_COUNT(群像剧)→ 自动深度模式;调用方已指定 deep 时保持不降级。
    mode = "deep" if (mode == "deep" or len(characters) > DEEP_AUTO_CHAR_COUNT) else "standard"
    data = (copy.deepcopy(session_data) if session_data is not None
            else await asyncio.to_thread(storage.load_session, session_id))
    # 重 roll 快照:回合落盘前先存一份「上一轮之后」的完整会话镜像(排除 _reroll 本身防嵌套膨胀)。
    # 重 roll = 恢复这份镜像 + 用相同输入重跑;覆盖 messages/state/short_memory/long_memory/摘要/累计用量等。
    pre_snapshot = copy.deepcopy({k: v for k, v in data.items() if k != "_reroll"})
    state = _safe_state(data, characters, player, story)
    if len(characters) > SMALL_CAST and not state.scene.cast_tracked:
        # 旧会话的大卡组:从这一轮起由引擎记在场。名单空(旧语义=全员)就先补成全部卡,之后靠模型改写收窄。
        state.scene.cast_tracked = True
        if not state.scene.present_characters:
            state.scene.present_characters = [c.data.name for c in characters]
    messages = data.get("messages", [])
    if not isinstance(messages, list):
        messages = []
    short_memory = data.get("short_memory", [])
    if not isinstance(short_memory, list):
        short_memory = []

    if not characters:
        raise ValueError(L("At least one character card is required", "至少需要一个角色卡"))

    books_sig = _books_signature(world, story)
    if data.get("knowledge_signature") != books_sig:
        # 索引可能做 embedding(深度模式),放线程里跑,别堵事件循环(标准模式 is_ready=False 时是 no-op)。
        await asyncio.to_thread(_index_books, session_id, world, story)
        data["knowledge_signature"] = books_sig

    raw_user = user.strip()
    raw_choice = selected_choice.strip()
    action = raw_user or raw_choice or L("Observe the current situation", "观察当前局势")
    if len(action) > MAX_ACTION_CHARS:
        action = action[:MAX_ACTION_CHARS] + L("…", "……")
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

    # 长程记忆 A 档:受限实体词表 + 按在场实体确定性召回。
    # roster 用于抽取/规整 memory_write.entity(挂载侧);entity_memory 把挂在「本轮在场实体 + 玩家」
    # 身上的派生事实从会话 long_memory 里确定性取出,注入对应角色/玩家块(standard+deep 都生效,不靠相似度)。
    roster, ent_labels = _entity_roster(characters, player)
    wanted_keys = _present_entity_keys(state, characters, roster)
    if player and player.name:
        wanted_keys.add(_PLAYER_ENTITY)  # 玩家恒在场,挂玩家的记忆始终注入
    entity_memory = _entity_memory_index(data.get("long_memory", []), wanted_keys, by_knower=PHASE3_KNOWERS)
    # Phase 3:暂存本轮在场(turn 开始时的在场集)→ knowers(实体键)+ 向量轮在场标注(角色名)。
    if PHASE3_KNOWERS:
        data["_present_keys"] = sorted(wanted_keys)
        data["_present_names"] = _on_stage(state, characters)
        if state.scene.cast_tracked and not messages and not (story and story.events and story.events[0].characters):
            # 开场回合、开局名单是"全员"这个缺省值:谁真在场要等模型这回合写出来,知情者只取回合结束时的名单。
            data["_present_keys"] = sorted(k for k in wanted_keys if k == _PLAYER_ENTITY)
            data["_present_names"] = []

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
    abstain_note = ""
    fact_query = _is_fact_query(action)
    fact_miss = False  # 具体事实查询且检索硬 miss → 供 ③ 不回写编造
    if mode == "deep" and older:
        usage = (len(skeleton) + len(recap) + len(summary)) / CONTEXT_BUDGET_CHARS
        if usage >= DEEP_WARMUP_AT:
            memory.ensure_loading()
        if usage >= DEEP_RECALL_AT and memory.is_ready():
            # 向量召回涉及 embedding(CPU 密集),全部丢线程池跑,避免堵住事件循环、拖慢其他在玩的人。
            if not data.get("vector_warmed"):  # 模型刚就绪:补建此前漏掉的历史/书目索引
                await asyncio.to_thread(_index_books, session_id, world, story)
                await asyncio.to_thread(memory.index_history, session_id, messages, data.get("_turn_present"))
                data["vector_warmed"] = True
            # ① 召回 query 条件化:具体事实查询用问句本身(防 scan_text 把真值挤出 top4);含糊/指代轮用 scan_text。
            recall_query = action if ((PHASE1_FIXES and fact_query) or RECALL_QUERY_ACTION_ONLY) else scan_text
            kb_hits = await asyncio.to_thread(memory.search_knowledge, session_id, recall_query, 6)
            scored = await asyncio.to_thread(memory.search_scored, session_id, recall_query, 4, max(0, start_idx - 1))
            lm_hits = await asyncio.to_thread(memory.search_long_memory, session_id, recall_query, 6)
            # Phase 3 确定性删除(治本,不靠指令松紧、与作品无关):玩家点名问某角色一件具体往事,
            # 而召回到的那条往事【当时在场】里没有他 → 把这条从本轮材料里删掉(他看不到=编不出,
            # 火眼金睛也照不出不在上下文里的东西),并点名硬认忘。比"软劝模型自律"稳得多。
            masked_for = None
            if PHASE3_KNOWERS and fact_query:
                addressed = _addressed_character(action, characters)
                if addressed:
                    kept = []
                    for txt, dist in scored:
                        pres = _parse_present_tag(txt)
                        if pres is not None and not _name_in_present(addressed, pres):
                            masked_for = addressed  # 这条他没见证 → 从他的视野删除
                            continue
                        kept.append((txt, dist))
                    scored = kept
            old_chat = [t for t, _ in scored]
            best = scored[0][1] if scored else 99.0
            recall_lines = (kb_hits + [L("[old dialogue] ", "[旧对话] ") + x for x in old_chat]
                            + [L("[long-term memory] ", "[长期记忆] ") + x for x in lm_hits])
            if recall_lines:
                recall_block = "\n".join(recall_lines)
            # ② abstention:具体事实查询时,注入硬指令(模型据证据判定有没有答案);top1 距离过大=硬 NOT_FOUND。
            if PHASE1_FIXES and fact_query:
                found = bool(recall_lines) and best <= MISS_DIST
                abstain_note = _abstain_note("found" if found else "miss")
                fact_miss = not found
            if masked_for:  # 点名硬认忘:代码已确定他没见证,比泛知识边界指令更强(材料也已删)
                abstain_note += L(
                    f"\n**[Knowledge boundary · hard · highest priority]** The system has determined: {masked_for}, whom the player addressed this turn, was [not present] at the time "
                    f"and has [no memory at all] of this specific past event (the related material has been removed from their view). {masked_for} must clearly admit not knowing, in character "
                    f"(I wasn't there / didn't see it / don't know), **must not describe any detail** (no shape / color / count / smell), "
                    f"and **must not invent a reason to have been there, like 'I saw it from afar / heard it / deduced it with my abilities'** — even if the character has special powers.",
                    f"\n**【知识边界·硬·最高优先级】** 系统已确定:本轮玩家点名问的 {masked_for} 当时【不在场】、"
                    f"对这件具体往事【没有任何记忆】(相关材料已从其视野移除)。{masked_for} 必须 in-character 明确认忘"
                    f"(我那会儿不在场 / 没看见 / 不知道),**绝不描述任何细节**(形状/颜色/数量/气味一律不许),"
                    f"也**不许用『我远远看到 / 听到 / 凭本事推断』之类给自己补一个在场理由**——即便该角色设定上有特殊能力。",
                )
    # ② 标准模式 / 深度但召回未激活:无检索,仍对事实查询给认忘指令(防无据自信编)。
    if PHASE1_FIXES and fact_query and not abstain_note:
        abstain_note = _abstain_note("noretrieval")

    # 主线锚点 + 世界时钟 + 该主动恶化登场的事件(第5组 5b)。
    anchor = _main_anchor(story, player)
    escalations = _due_escalations(story, state)
    esc_text = ""
    if escalations:
        esc_text = "\n".join(
            f"- [{reason}·severity{e.severity}] {e.title}({e.event_id or storage.slug(e.title, 'event')}):{e.summary}"
            + ((L("\n  Possible consequences: ", "\n  可能后果:") + "; ".join(e.consequences[:3])) if e.consequences else "")
            for e, reason in escalations
        )
    clock_line = L(
        f"Now: {_fmt_clock(state.clock_minutes)} ({state.clock_minutes} in-story minutes elapsed); "
        f"main plot idle for {state.idle_minutes} in-story minutes. Give the in-story minutes that pass this turn in state_update.time_advance.",
        f"当前:{_fmt_clock(state.clock_minutes)}(累计 {state.clock_minutes} 故事分钟);"
        f"主线静默 {state.idle_minutes} 故事分钟。本轮在 state_update.time_advance 给出经过的故事分钟数。",
    )
    # 后台注入:运营者经 /api/operator/inject(需 operator 权限/require_role)发的内容,本回合放进 AI 上下文。
    # 每条可选 sticky:once(默认,送达即清)/ sticky(持续到手动 DELETE 清)。兼容旧的纯字符串=once。
    _oi = data.get("operator_inject") or []
    def _oi_text(x):
        return (x.get("content") if isinstance(x, dict) else str(x)) or ""
    def _oi_sticky(x):
        return bool(x.get("sticky")) if isinstance(x, dict) else False
    operator_inject = "\n".join(f"- {_oi_text(x).strip()}" for x in _oi if _oi_text(x).strip())
    remaining = [x for x in _oi if _oi_sticky(x)]  # once 的送达即清,sticky 的留到手动清
    if remaining != _oi:
        data["operator_inject"] = remaining
    # 留痕:本回合采纳的导演注入,存进 data 供 _save_turn 记进回合记录(operator_applied),永久可审计。
    applied = [{"mode": "director", "content": _oi_text(x).strip(), "sticky": _oi_sticky(x)}
               for x in _oi if _oi_text(x).strip()]
    if applied:
        data["_operator_applied"] = applied
    # 组装模型无关的上下文包,交给适配器决定怎么发给具体模型(折叠 vs 多轮、用哪个模型)。
    # DeepSeekAdapter 复刻原行为:历史折进 system、只发 [system, user]——因为 DeepSeek 的
    # json_mode 一旦看到多轮 assistant 散文会间歇吐空白。换 ClaudeAdapter 则用真正的多轮历史。
    bundle = ContextBundle(
        skeleton=skeleton,
        action_prompt=action_prompt,
        summary=summary,
        recall_block=recall_block,
        abstain_note=abstain_note,
        operator_inject=operator_inject,
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
    except DeferredLLMControl:
        raise
    except Exception as e:
        turn = _local_continuation_turn(action, state, characters, reason=L("LLM call failed: ", "LLM 调用失败:") + str(e))
        state = _apply_state_update(state, turn.state_update, player.name if player else "")
        state.turn_count += 1
        turn.state = state
        return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
    data.setdefault("debug", []).append({"turn": len(messages), "raw": raw[:4000]})
    data["debug"] = data["debug"][-8:]
    if not raw.strip():
        try:
            retry_raw = await achat_messages(
                _compact_retry_messages(action, characters, state, world_hits, event_hits,
                                        recap=recap, clock=clock_line, player_name=player.name if player else ""),
                json_mode=True,
                max_tokens=1200,
                model=get_adapter().select_model("retry"),
            )
            data.setdefault("debug", []).append({"turn": len(messages), "raw": retry_raw[:4000], "retry": True})
            data["debug"] = data["debug"][-8:]
            raw = retry_raw
        except DeferredLLMControl:
            raise
        except Exception as e:
            turn = _local_continuation_turn(action, state, characters, reason=L("blank output and retry failed: ", "空白输出且重试失败:") + str(e))
            state = _apply_state_update(state, turn.state_update, player.name if player else "")
            state.turn_count += 1
            turn.state = state
            return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
    try:
        obj = await _repair_json(raw)
    except DeferredLLMControl:
        raise
    except Exception:
        obj = None
    if not isinstance(obj, dict):
        # 坏 JSON / 非对象:DeepSeek 偶发(json_mode 也有 ~几% 概率)。本地清洗+LLM 修复都没救回时,
        # 先用精简 prompt 重生成一次(更短更稳的输出),再不行才保底,避免一次小毛刺就掉出故事。
        reason = L("JSON parse failed or not an object", "JSON 解析失败或非对象")
        try:
            raw2 = await achat_messages(
                _compact_retry_messages(action, characters, state, world_hits, event_hits,
                                        recap=recap, clock=clock_line, player_name=player.name if player else ""),
                json_mode=True,
                max_tokens=1500,
                model=get_adapter().select_model("retry"),
            )
            data.setdefault("debug", []).append({"turn": len(messages), "raw": raw2[:4000], "reparse": True})
            data["debug"] = data["debug"][-8:]
            obj = await _repair_json(raw2)
        except DeferredLLMControl:
            raise
        except Exception as e:
            obj = None
            reason = L("still failed to parse after regeneration: ", "重生成后仍解析失败:") + str(e)
        if not isinstance(obj, dict):
            turn = _local_continuation_turn(action, state, characters, reason=reason)
            state = _apply_state_update(state, turn.state_update, player.name if player else "")
            state.turn_count += 1
            turn.state = state
            return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)

    # 发言门(大卡组):卡上的角色只有回合开始在场、或本回合进场才能开口。进场的三个来源:
    # state_update 里的在场名单、写正文前 reasoning.cast 定下的名单、正文里的强证据(直接引语的说话人)。
    allowed = None
    arrivals: list[str] = []
    _pname = player.name if player else ""
    if state.scene.cast_tracked:
        _su = obj.get("state_update") if isinstance(obj.get("state_update"), dict) else {}
        _sc = _su.get("scene") if isinstance(_su.get("scene"), dict) else {}
        _rs = obj.get("reasoning") if isinstance(obj.get("reasoning"), dict) else {}
        start_cast = _on_stage(state, characters, _pname)
        declared = _canon_cast(_as_text_list(_rs.get("cast")), characters)
        implicit = _narrated_arrivals(str(obj.get("narration", "")), obj.get("messages"), characters,
                                      start_cast + _canon_cast(_as_text_list(_sc.get("present_characters")), characters) + declared,
                                      _pname)
        arrivals = [n for n in declared + implicit if not _is_player_char(n, _pname)]
        allowed = _canon_cast(start_cast + _as_text_list(_sc.get("present_characters")), characters) + arrivals
        if implicit:  # 留痕:模型写了人进场却没进名单,引擎替它补上
            data.setdefault("gate_log", []).append({"turn": len(messages) // 2 + 1, "implicit_entry": implicit})
    gate_dropped: list[str] = []
    turn = StoryTurn(
        narration=str(obj.get("narration", "")),
        messages=_normalize_messages(obj.get("messages"), characters, world, story, player,
                                     allowed=allowed, dropped=gate_dropped),
        choices=_normalize_choices(obj.get("choices")),
        state_update=obj.get("state_update") if isinstance(obj.get("state_update"), dict) else {},
        memory_write=_normalize_memory_write(obj.get("memory_write"), roster),
        triggered_events=[str(x) for x in obj.get("triggered_events", [])],
        reasoning=_normalize_reasoning(obj.get("reasoning")),
    )
    if gate_dropped:  # 留痕:被发言门拦下的不在场角色(重玩/排查用)
        data.setdefault("gate_log", []).append({"turn": len(messages) // 2 + 1, "dropped": gate_dropped})
        data["gate_log"] = data["gate_log"][-20:]
    turn = _ensure_story_body(turn, action, characters, on_stage=allowed)
    # ③ 不回写编造:具体事实查询且(检索硬 miss 或模型已 in-character 认忘)→ 丢弃本轮 fact/quest delta,
    # 掐断"编造→落库→自我强化"。叙事/event/note 保留(它们记的是"发生了什么",不是断言某事实值)。
    _recall_miss = isinstance(turn.reasoning, dict) and str(turn.reasoning.get("recall_check", "")).strip().lower().startswith("miss")
    if PHASE1_FIXES and fact_query and (fact_miss or _recall_miss or _has_abstain_markers(turn)):
        turn.memory_write = [m for m in turn.memory_write if m.kind not in ("fact", "quest")]
    if not turn.choices:
        turn.choices = [
            StoryChoice(id="ask_detail", label=L("Press for a key detail", "追问一个关键细节"), intent="ask"),
            StoryChoice(id="observe", label=L("Look for anything else out of place", "观察现场还有什么异常"), intent="observe"),
            StoryChoice(id="act_carefully", label=L("Carefully take the next step", "谨慎采取下一步行动"), intent="act"),
        ]

    state = _apply_state_update(state, turn.state_update, player.name if player else "")
    if state.scene.cast_tracked:  # 名单规整成卡上的名字,再补上本回合进场却漏写的人
        end_cast = _canon_cast(state.scene.present_characters, characters)
        for n in arrivals:
            if not _card_on_stage(n, end_cast):
                end_cast.append(n)
        state.scene.present_characters = [n for n in end_cast if not _is_player_char(n, _pname)]
    _progress_events(state, turn.triggered_events)
    _check_ending_predicates(story, state)  # 谓词齐备即代码侧客观达成结局(无谓词的故事回退模型判定)
    state.turn_count += 1
    turn.state = state
    return await _save_turn(session_id, data, messages, short_memory, state, action, turn, mode,
                            player_input=(raw_user or raw_choice), roster=roster, entity_labels=ent_labels)
