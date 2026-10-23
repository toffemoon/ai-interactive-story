"""自动识别 —— 把用户贴进来的散文设定,抽取成结构化 Card V2。

核心一步:用户不用手填字段,扔文档进来,AI 自己拆。
设计原则:不做纯黑箱,识别结果要回给用户确认/微调。
"""

import io
import json
import re

from .llm import chat_messages
from .models import (
    CharacterBoundary,
    CharacterCard,
    CharacterData,
    Ending,
    PlayerCard,
    StoryBook,
    StoryEvent,
    WorldBook,
    WorldEntry,
)

_SYSTEM = """You are a character-sheet parser. The user will give you descriptive text about one character (it may be prose, a short essay, or full of memes and fandom slang, and it may be written in Chinese or any other language).
Your task is to extract it into structured JSON with the following fields:

- name: the character's name (required; if none is given, invent the most fitting one based on the content)
- description: the character's core profile (background, appearance, identity, history)
- personality: a summary of their personality
- scenario: the current situation or story context they are in (empty string if there is none)
- first_mes: one in-character opening line (the first thing the character says to the player; if the source has none, write one yourself)
- mes_example: one or two lines of sample dialogue that show how this character talks
- speech_rules: array of 3-6 hard rules for how the character speaks/behaves, used to lock the voice so it does not drift
  (e.g. "Speaks in short sentences and never uses exclamation marks", "Refers to themself as 'this venerable one'", "Never shows weakness first")
- tags: array of a few tags

Requirements:
- Stay strictly faithful to the source; do not expand the character's history on your own, and do not invent experiences the source does not mention.
- speech_rules must be concrete and actionable: they describe HOW the character talks, not what their personality is.
- Language: write every free-text value (name, description, personality, scenario, first_mes, mes_example, speech_rules, tags) in English. If the source text is in Chinese or another language, translate the content into natural English while preserving its meaning; proper names may use an established English name, be romanized (e.g. pinyin), or be kept as written.
- Output only the JSON, with no explanation."""


def _hint_block(hint: str) -> str:
    """用户对本次解析/生成的额外要求 → system 追加段(F0 AI 触点可控)。

    空串返回空——所有加了 hint 参数的函数在不传时与旧行为完全一致。
    截 1000 字:hint 是"口味指示"不是素材,素材走 text/seed/refs。
    """
    h = (hint or "").strip()[:1000]
    return (
        "\n\n[Additional instructions from the user for this request. Follow them with priority, "
        "as long as they do not break the required JSON output format or the requirement that all "
        f"free-text output be in English]\n{h}"
    ) if h else ""


def identify(text: str, hint: str = "") -> CharacterCard:
    """把一段设定文字识别成 Card V2。JSON 偶发不合法时容错解析,失败重试一次再抛。

    对齐 identify_storybook / build_card 的健壮性:DeepSeek json_mode 偶尔吐出
    带 fence / 中文引号 / 尾逗号的非法 JSON,裸 json.loads 会随机崩。
    hint:可选,用户对解析口味的指示(如"重点抽性格和说话风格")。
    """
    last_err: Exception | None = None
    for _ in range(3):
        raw = chat_messages(
            [
                {"role": "system", "content": _SYSTEM + _hint_block(hint)},
                {"role": "user", "content": text.strip()},
            ],
            json_mode=True,
            max_tokens=2048,
        )
        try:
            return CharacterCard(data=CharacterData(**_loads_tolerant(raw)))
        except Exception as e:  # JSON 不合法 / 字段缺失:重试一次
            last_err = e
    raise ValueError(f"Character card recognition failed (invalid JSON after retries): {last_err}")


_WORLD_SYSTEM = """You are a worldbuilding parser. The user will give you descriptive text about a fictional world
(geography, factions, rules, history, races, important locations/items, etc.; it may be written in Chinese or any other language).
Split it into several "world book entries", each focused on one topic, and output JSON:

{"entries": [
  {"keys": ["trigger keyword 1", "keyword 2"], "content": "the lore for this topic", "comment": "entry title"},
  ...
]}

Requirements:
- Each entry's keys are the words that, as soon as they appear in the player's dialogue, should make the AI "remember" this entry (place names, faction names, terms, etc.).
- content must be self-contained: it is background knowledge that will be injected into the character AI, so keep it concise and accurate.
- Stay faithful to the source; do not invent lore that the source does not contain.
- Language: write keys, content and comment in English. If the source is in Chinese or another language, translate it into natural English while preserving its meaning; proper names may use an established English name, be romanized (e.g. pinyin), or be kept as written, and must be spelled the same way in keys and content.
- Aim for 3-12 entries. Output only the JSON."""


# 提取 keys 时跳过的通用小标题词(它们是结构词,不是触发关键词)
_KEY_STOP = {
    "代表星神", "相关势力", "相关群体", "相关事件", "相关种族", "相关角色", "相关机构",
    "特点", "职责", "注意", "示例", "核心矛盾", "角色扮演语气", "角色扮演注意",
    "标注", "目标", "原因", "表现", "社会结构", "主要势力", "核心地点", "重要机构",
    "语言风格", "关键词", "可用方向", "态度关键词", "可用表达", "可用句式",
}
# 英文停用词 / 英文结构词(按小写比较;英文标题按空白切词,所以这里只放单词)
_KEY_STOP_EN = {
    "the", "of", "and", "with", "for", "an", "in", "on", "to",
    "note", "notes", "example", "examples", "features", "overview", "related", "keywords",
}


def _split_markdown_sections(text: str) -> list[dict]:
    """按 ## / ### 标题把 markdown 切成段。# 一级标题作为上层分组,不单独成条。"""
    sections, cur, group = [], None, ""
    for line in text.split("\n"):
        h = re.match(r"^(#{1,})\s+(.*)", line)
        if h:
            level, title = len(h.group(1)), h.group(2).strip()
            if level == 1:
                group = re.sub(r"^[一二三四五六七八九十\d、.\s]+", "", title)  # 去"一、"前缀
                continue
            if cur:
                sections.append(cur)
            cur = {"title": title, "group": group, "lines": []}
        elif cur is not None:
            cur["lines"].append(line)
    if cur:
        sections.append(cur)
    return sections


def _extract_keys(title: str, content: str) -> list[str]:
    """从标题 + 正文加粗术语里抽触发关键词。"""
    keys = []
    def add(tok):
        tok = tok.strip(" *（）()【】「」:：.，、")
        if len(tok) < 2 or tok in _KEY_STOP or tok in keys:
            return
        if tok.lower() in _KEY_STOP_EN:  # 英文停用词
            return
        if re.match(r"^[\d.]+$", tok):  # 纯数字/编号如 "0."
            return
        keys.append(tok)
    splitter = r"[\s/、,，:：;；（）()\[\]「」【】·\-—]+"
    for tok in re.split(splitter, title):
        add(tok)
    for bold in re.findall(r"\*\*(.+?)\*\*", content):
        for tok in re.split(splitter, bold):
            add(tok)
    return keys[:10]


def worldbook_from_markdown(text: str, name: str = "World Book") -> WorldBook:
    """对已是 markdown 标题结构的文档,按 ## 直接切成精细条目,不经 LLM 压缩。"""
    entries = []
    for sec in _split_markdown_sections(text):
        content = "\n".join(sec["lines"]).strip()
        if len(content) < 10:  # 跳过空段/纯过渡段
            continue
        keys = _extract_keys(sec["title"], content) or [sec["title"][:20]]
        comment = f'{sec["group"]} · {sec["title"]}' if sec["group"] else sec["title"]
        entries.append(WorldEntry(keys=keys, content=content, comment=comment))
    return WorldBook(name=_infer_book_name(text, entries, name), entries=entries)


def identify_worldbook(text: str, name: str = "World Book", hint: str = "") -> WorldBook:
    """世界观文字 → 世界书。已结构化的 markdown 按标题切(不压缩);散文走 LLM 识别。

    hint 非空时跳过 markdown 快路径:用户给了解析指示=要 AI 按指示重组,
    纯代码切分吃不到指示(代价:超长结构化文档会被 LLM 压缩,如实)。
    """
    if not (hint or "").strip() and len(re.findall(r"^#{2,}\s", text, re.M)) >= 8:
        return worldbook_from_markdown(text, name)
    raw = chat_messages(
        [
            {"role": "system", "content": _WORLD_SYSTEM + _hint_block(hint)},
            {"role": "user", "content": text.strip()},
        ],
        json_mode=True,
        max_tokens=3072,
    )
    obj = json.loads(raw)
    entries = [WorldEntry(**e) for e in obj.get("entries", [])]
    return WorldBook(name=_infer_book_name(text, entries, name), entries=entries)


def _en_hit(text: str, words: tuple[str, ...]) -> bool:
    """英文关键词启发(整词、忽略大小写、允许复数 s)。条目 comment 是 LLM 输出,现在是英文。"""
    return bool(re.search(r"\b(?:" + "|".join(map(re.escape, words)) + r")s?\b", text, re.I))


_EN_ORG_WORDS = ("faction", "organization", "organisation", "alliance", "guild", "corporation")
_EN_PLACE_WORDS = ("location", "space station", "city", "cities", "planet")
_EN_RULE_WORDS = ("rule", "mechanic", "terminology", "glossary")


def _infer_book_name(text: str, entries: list[WorldEntry], fallback: str = "World Book") -> str:
    """给世界书/设定卡自动命名。优先文档标题,再按内容特征判断类型。"""
    title = re.search(r"^#\s+(.+)", text, re.M)
    if title:
        clean = title.group(1).strip().strip("《》")
        clean = re.sub(r"^《(.+)》", r"\1", clean)
        if clean:
            low = clean.lower()
            if any(word in clean for word in ["世界观", "世界书"]) or any(
                w in low for w in ["world book", "worldbook", "worldbuilding"]
            ):
                return "World Book"
            if any(word in clean for word in ["角色", "人物"]) or "character" in low:
                return clean
            if any(word in clean for word in ["组织", "公司", "派系", "势力", "空间站", "设定"]) or any(
                w in low for w in ["organization", "organisation", "faction", "company", "station", "setting"]
            ):
                return clean
            return clean[:32]

    sample = text[:6000]
    known = [
        ("星际和平公司", "Interastral Peace Corporation Setting Card"),
        ("IPC", "Interastral Peace Corporation Setting Card"),
        ("Interastral Peace", "Interastral Peace Corporation Setting Card"),
        ("黑塔空间站", "Herta Space Station Setting Card"),
        ("Herta Space Station", "Herta Space Station Setting Card"),
        ("天才俱乐部", "Genius Society Setting Card"),
        ("Genius Society", "Genius Society Setting Card"),
        ("战略投资部", "Strategic Investment Department Setting Card"),
        ("Strategic Investment Department", "Strategic Investment Department Setting Card"),
        ("石心十人", "Ten Stonehearts Setting Card"),
        ("Ten Stonehearts", "Ten Stonehearts Setting Card"),
        ("仙舟联盟", "Xianzhou Alliance Setting Card"),
        ("Xianzhou Alliance", "Xianzhou Alliance Setting Card"),
        ("星穹列车", "Astral Express Setting Card"),
        ("Astral Express", "Astral Express Setting Card"),
    ]
    for needle, label in known:
        if needle in sample:
            return label

    joined_comments = " ".join(e.comment for e in entries[:8])
    hay = f"{sample} {joined_comments}"
    if any(word in sample or word in joined_comments for word in ["派系", "势力", "组织", "阵营"]) or _en_hit(hay, _EN_ORG_WORDS):
        return "Organization/Faction Setting Card"
    if any(word in sample or word in joined_comments for word in ["地点", "空间站", "城市", "星球"]) or _en_hit(hay, _EN_PLACE_WORDS):
        return "Location Setting Card"
    if any(word in sample or word in joined_comments for word in ["规则", "机制", "术语", "命途"]) or _en_hit(hay, _EN_RULE_WORDS):
        return "Rules/Terminology Setting Card"
    return fallback


_PLAYER_SYSTEM = """You are a player-card parser. The user will give you a description of the player / protagonist / their own original character (it may be written in Chinese or any other language).
Extract it into JSON:
{
  "name": "player name or codename",
  "role": "the player's identity/role in the story",
  "background": "background summary",
  "goals": ["goal"],
  "abilities": ["ability/resource"],
  "constraints": ["limitation/taboo/weakness"],
  "known_facts": ["a fact the player knows at the start"]
}
Stay faithful to the source and do not expand their history.
Language: write every value in English. If the source is in Chinese or another language, translate it into natural English while preserving its meaning; proper names may use an established English name, be romanized (e.g. pinyin), or be kept as written. Output only the JSON."""


def identify_player(text: str, hint: str = "") -> PlayerCard:
    """玩家设定文字 → PlayerCard。JSON 偶发不合法时容错解析 + 重试一次再抛(对齐 identify)。"""
    last_err: Exception | None = None
    for _ in range(3):
        raw = chat_messages(
            [
                {"role": "system", "content": _PLAYER_SYSTEM + _hint_block(hint)},
                {"role": "user", "content": text.strip()},
            ],
            json_mode=True,
            max_tokens=1536,
        )
        try:
            return PlayerCard(**_loads_tolerant(raw))
        except Exception as e:  # JSON 不合法 / 字段缺失:重试
            last_err = e
    raise ValueError(f"Player card recognition failed (invalid JSON after retries): {last_err}")


_STORY_SYSTEM = """You are an interactive story-book parser. What the user gives you may be a complete outline, or just a few scattered ideas / setting fragments (it may be written in Chinese or any other language).
Parse it and complete it into structured JSON. Missing fields may be reasonably inferred from the existing material, but anything you inferred (that the source does not state explicitly)
must be listed with a one-line note in needs_confirm so the author can go back and confirm it.

Output JSON:
{
  "title": "story book title",
  "premise": "story premise (one or two sentences)",
  "timeline": ["key milestones in chronological order"],
  "main_plot": ["main-plot stages"],
  "freedom_rules": ["rules that preserve player freedom"],
  "clock_start": 0,                  // in-story time at the start (minutes, counting from 0; convert cues such as "evening" / "day three" if present; default 0)
  "pacing": ["global pacing/time hints, e.g. the debts multiply every few story hours"],
  "events": [
    {
      "event_id": "short ASCII ID in English or pinyin", "title": "event title", "summary": "what happens in the event",
      "trigger_keywords": ["words the player might mention that could trigger it"],
      "trigger_flags": ["state flags that must already exist for it to trigger"],
      "reveal_after": ["IDs of events that must be revealed/completed first"],
      "location": "location", "characters": ["related characters"],
      "choices_hint": ["action options suitable to offer the player"], "consequences": ["possible consequences"],
      "status": "pending",
      "due_clock": null,             // when the in-story clock (minutes) reaches this value the event proactively worsens/appears; fill only for purely time-driven events, otherwise null
      "escalate_after_idle": null,   // after the main plot has been idle this many minutes the event escalates to press the player; fill for pursuit/pressure events, otherwise null
      "severity": 2                  // 1-5, how severely the event escalates / its priority
    }
  ],
  "endings": [
    {"ending_id":"short ID","title":"ending name","summary":"ending synopsis","conditions":["trigger conditions, mainly in natural language"],"required_events":["event_ids (taken from the events above) that must be resolved to reach this ending"],"required_facts":["key facts that must have been revealed to reach this ending"],"tone":"good ending / tragedy / open / hidden"}
  ],
  "character_boundaries": [
    {"character":"character name","public":["publicly known"],"hidden":["must not be said by the character until revealed"],"hard_limits":["caps on identity/strength/abilities"]}
  ],
  "needs_confirm": ["which fields you inferred and suggest the author confirm, one sentence each"]
}

Principles:
- Event nodes must be triggerable, not just literary summaries; even scattered ideas should be turned into playable events/endings where possible.
- Give 1-3 endings with different directions (good ending / bad ending / hidden, etc.), each with clearly stated trigger conditions; wherever possible fill required_events with the event_ids that must be resolved to reach that ending (matching the event_id values in events above) and required_facts with the key facts that must be revealed, so the engine can judge endings objectively (leave them as empty arrays if nothing fits; the engine will fall back to model judgment).
- Fill the time fields (clock_start / due_clock / escalate_after_idle) only when the material has time cues, or when an event should naturally worsen over time;
  if unsure, leave the defaults (0/null) and flag it in needs_confirm.
- character_boundaries lists separately "what a character knows, what they hide, and how far their abilities go", for consistency guarding; list only the main characters.
- Do not invent hard facts that do not appear in the source; every inference must go into needs_confirm. Preserve player freedom; do not make it a single fixed path.
- Language: write every free-text value (title, premise, timeline, main_plot, freedom_rules, pacing, event titles/summaries/trigger_keywords/choices_hint/consequences, location, character names, endings, character_boundaries, needs_confirm) in English. If the material is in Chinese or another language, translate it into natural English while preserving its meaning; proper names may use an established English name, be romanized (e.g. pinyin), or be kept as written, and each name must be spelled the same way everywhere. event_id / ending_id stay short ASCII IDs, and status stays "pending".
- Keep the output lean and the JSON fully closed: at most 12 events, short text in each, and never get cut off halfway. Output only the JSON."""


def _coerce_int(v, default=None):
    """把模型可能给的 "5"/"5小时"/5.0 等容错成 int;拿不到就用 default。"""
    if v is None or isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        m = re.search(r"-?\d+", v)
        return int(m.group()) if m else default
    return default


def _as_str_list(v) -> list[str]:
    """模型可能把列表字段(timeline/pacing 等)吐成字符串或单值;统一容错成 list[str]。"""
    if v is None:
        return []
    if isinstance(v, str):
        s = v.strip()
        return [s] if s else []
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    return [str(v)]


def _story_event_from(e: dict) -> StoryEvent:
    """从模型给的事件 dict 构造 StoryEvent,对新增时间字段做类型容错。"""
    e = dict(e)
    e["due_clock"] = _coerce_int(e.get("due_clock"), None)
    e["escalate_after_idle"] = _coerce_int(e.get("escalate_after_idle"), None)
    sev = _coerce_int(e.get("severity"), 2)
    e["severity"] = max(1, min(5, sev if sev is not None else 2))
    if e.get("status") not in {"pending", "active", "resolved", "locked"}:
        e["status"] = "pending"
    try:
        return StoryEvent(**e)
    except Exception:
        # 个别字段类型不对时,只用已知安全字段重建,别让整本故事书识别失败。
        def _l(x):
            return [str(i) for i in x] if isinstance(x, list) else ([str(x)] if x else [])
        return StoryEvent(
            event_id=str(e.get("event_id") or ""), title=str(e.get("title") or ""),
            summary=str(e.get("summary") or ""),
            trigger_keywords=_l(e.get("trigger_keywords")), trigger_flags=_l(e.get("trigger_flags")),
            reveal_after=_l(e.get("reveal_after")), location=str(e.get("location") or ""),
            characters=_l(e.get("characters")), choices_hint=_l(e.get("choices_hint")),
            consequences=_l(e.get("consequences")),
            due_clock=e["due_clock"], escalate_after_idle=e["escalate_after_idle"], severity=e["severity"],
        )


def _model_from(cls, item: dict):
    try:
        return cls(**item) if isinstance(item, dict) else None
    except Exception:
        return None


def _loads_tolerant(raw: str) -> dict:
    """容错解析 LLM 的 JSON:剥 markdown fence、中文引号、尾逗号;失败抛 JSONDecodeError 让上层重试。"""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            raise
        cand = raw[start:end + 1]
        cand = cand.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        cand = re.sub(r",\s*([}\]])", r"\1", cand)
        return json.loads(cand)


def _story_llm(text: str, concise: bool, hint: str = "") -> dict | None:
    """调一次故事书识别。8000 token 给丰富故事留余量;concise=True 时再压一压防大故事截断。"""
    system = _STORY_SYSTEM + _hint_block(hint)
    if concise:
        system += ("\n\n[REMINDER] Your previous output was too long and got truncated. This time be much leaner: "
                   "at most 8 events, one sentence per field, 1-3 endings, character_boundaries for only the 2-3 main "
                   "characters, and make sure the whole JSON is fully closed. All free-text values must still be in English.")
    raw = chat_messages(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": text.strip()[:16000]},
        ],
        json_mode=True,
        max_tokens=8000,
    )
    try:
        return _loads_tolerant(raw)
    except json.JSONDecodeError:
        return None


def identify_storybook(text: str, hint: str = "") -> StoryBook:
    """故事书文字 → 结构化 StoryBook(含多结局 / 时间字段 / 角色边界 / 待确认标注)。

    大故事书输出可能很长,8000 token 仍截断时,用更精简的指令重试一次,再不行才抛错。
    """
    obj = _story_llm(text, concise=False, hint=hint)
    if obj is None:
        obj = _story_llm(text, concise=True, hint=hint)
    if obj is None:
        raise ValueError(
            "Story book parsing failed: the model output was too long or not valid JSON. "
            "Try splitting the material into shorter pieces and try again."
        )
    events = [_story_event_from(e) for e in obj.get("events", []) if isinstance(e, dict)]
    endings = [m for e in obj.get("endings", []) if (m := _model_from(Ending, e))]
    bounds = [m for b in obj.get("character_boundaries", []) if (m := _model_from(CharacterBoundary, b))]
    return StoryBook(
        title=obj.get("title") or "Story Book",
        premise=str(obj.get("premise") or ""),
        timeline=_as_str_list(obj.get("timeline")),
        main_plot=_as_str_list(obj.get("main_plot")),
        freedom_rules=_as_str_list(obj.get("freedom_rules")),
        events=events,
        endings=endings,
        clock_start=_coerce_int(obj.get("clock_start"), 0) or 0,
        pacing=_as_str_list(obj.get("pacing")),
        character_boundaries=bounds,
        needs_confirm=_as_str_list(obj.get("needs_confirm")),
    )


_CLASSIFY_SYSTEM = """You are an upload-content classifier. The user pastes some setting text (it may be written in Chinese or any other language); decide which category it fits best:
- character: a character sheet for one particular character/person (name, personality, appearance, way of speaking, history)
- world: worldbuilding / setting card (geography, factions, organizations, rules, locations, terminology, history, institutions)
- story: an interactive story book (timeline, main plot, event nodes, endings, plot outline, a case to solve)
- player: the player / protagonist's own character (who the player plays, identity, goals, abilities, limits, what they know at the start)

How to decide: character focuses on "who one particular person is and how they talk"; player is "who I, the player, play and what I am here to do";
world is "the objective facts of this world/organization/place"; story is "what will happen, which clues drive it forward, and what endings exist".
Output JSON: {"kind":"character|world|story|player","confidence":a decimal between 0 and 1,"reason":"a one-sentence justification"}. Write reason in English, even if the text is in Chinese. Output only the JSON."""

_KINDS = {"character", "world", "story", "player"}


def classify_text(text: str) -> dict:
    """判断一段设定文字属于 角色/世界/故事/玩家 哪一类。返回 {kind, confidence, reason}。"""
    raw = chat_messages(
        [
            {"role": "system", "content": _CLASSIFY_SYSTEM},
            {"role": "user", "content": text.strip()[:8000]},
        ],
        json_mode=True,
        max_tokens=256,
    )
    try:
        obj = _loads_tolerant(raw)
    except Exception:
        obj = {}
    kind = obj.get("kind")
    if kind not in _KINDS:
        kind = "character"  # 兜底:拿不准当角色卡(最常见),用户可在前端改判
    try:
        conf = float(obj.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.0
    return {"kind": kind, "confidence": max(0.0, min(1.0, conf)), "reason": str(obj.get("reason") or "")}


def identify_auto(text: str, kind: str | None = None) -> dict:
    """统一识别入口:先判类型(或用调用方指定的 kind 改判)再路由到对应解析器。

    只统一"识别入口",底层三种卡结构不变(强行统一会丢 keys / 事件触发等解析钩子)。
    返回 {kind, confidence, reason, data}(data 是对应卡的 model_dump)。
    """
    if kind in _KINDS:
        cls = {"kind": kind, "confidence": 1.0, "reason": "Type specified by the user"}
    else:
        cls = classify_text(text)
    k = cls["kind"]
    if k == "character":
        data = identify(text).model_dump()
    elif k == "world":
        data = identify_worldbook(text).model_dump()
    elif k == "story":
        data = identify_storybook(text).model_dump()
    else:  # player
        data = identify_player(text).model_dump()
    return {"kind": k, "confidence": cls["confidence"], "reason": cls["reason"], "data": data}


_BUILD_SYSTEM = """You are a "conversational character-card builder" assistant. Through relaxed chat, you help the user (who may have no idea how to write a character sheet) build a character card (Card V2) step by step.

How to work:
- Ask only one or two questions at a time; do not dump everything at once. Talk like a friend and dig deeper by following what the user says.
- Dig deeper than "a few personality adjectives": how this person sees the world (mental model), how they make decisions under pressure (decision heuristics),
  and what distinctive tone / catchphrases / sentence patterns they have (expression DNA). Distill all of this into the card's EXISTING fields; do not invent new fields.
- When the user cannot articulate something, offer 2-3 concrete options to pick from, or inspire them with examples; do not decide the core of the character for them.
- Do not invent hard history the user has not given; you may propose ideas, but mark them clearly in reply as "this is my guess, you decide".

The output is still standard Card V2 data, with these fields:
- name: the character's name
- description: background, identity, appearance, history (put their worldview / mental model here)
- personality: personality + decision heuristics (how they choose under pressure)
- scenario: the current situation (may be left empty)
- first_mes: one in-character opening line
- mes_example: one or two lines of sample dialogue that show their tone of voice
- speech_rules: 3-6 concrete, actionable hard rules for speech/behavior (turn the expression DNA into rules, e.g. "Refers to themself as 'this venerable one'", "Never uses exclamation marks")
- tags: a few tags

Each turn, output strictly this JSON:
{
 "reply":"your natural response to the user this turn (conversational; do not list fields)",
 "draft":{the Card V2 data fields above, filled in progressively; fill in everything known so far},
 "next_question":"the next guiding question (may be empty when finished)",
 "done":false,
 "filled":["names of the fields newly filled or updated this turn"]
}
Wrap-up rules:
- When name / description / personality / speech_rules (at least 3) / mes_example are all reasonably filled,
  or the user clearly says they are finished (e.g. "that's it", "good enough", "done", "lock it in", or the same in another language such as "可以了" / "就这样" / "定下来" / "差不多了" / "够了"), set done to true,
  leave next_question empty, stop asking questions, and tell the user in reply that the card is about complete and they can fine-tune it in the editor.
- Do not repeat a question you already asked last turn; if the user did not answer directly, try another angle or fill other fields first. Do not go in circles.
Language: write reply, next_question and every free-text value in draft in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). The entries in filled are field names and stay exactly as the keys above.
Output only the JSON."""


_BUILD_PLAYER = """You are a "conversational protagonist-card builder" assistant. Through chat, you help the user (who may not know how to write a character sheet) work out the protagonist they will play in the story (the player card).

How to work: ask one or two questions at a time and follow the conversation; when the user cannot articulate something, offer 2-3 options to pick from; do not decide the core for them, and do not invent hard facts they have not stated.
Make these clear: who the player plays, their identity, what they want to do in the story (goals), what abilities/resources they have, what limits/taboos/weaknesses they have, and what they already know at the start.

The output is PlayerCard data, with these fields: name / role (identity) / background / goals (array) /
abilities (abilities and resources, array) / constraints (limits, taboos, weaknesses, array) / known_facts (known at the start, array).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{the fields above, filled in progressively},"next_question":"the next question","done":false,"filled":["fields filled this turn"]}.
When name / role / background / at least one goal are all filled, or the user says they are finished (e.g. "that's it", "done", or "可以了" / "就这样"), set done to true and stop asking questions.
Language: write reply, next_question and every free-text value in draft in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). Output only the JSON."""

_BUILD_WORLD = """You are a "conversational world book / setting card builder" assistant. Through chat, you help the user work out a world or a setting card: geography, factions, organizations, locations, rules, terminology, history, races, etc.

How to work: focus on one topic at a time and dig into it; each time a topic becomes clear, organize it into one "world book entry". When the user is vague, suggest directions; do not invent lore they have not stated.
One entry = keys (trigger keywords: place names / faction names / terms; whenever one appears in the player's dialogue, the AI should recall this entry) + content (background knowledge injected into the AI; self-contained, concise and accurate) + comment (the entry title).
If what the user describes is a SECRET / TRUTH / TWIST / FORESHADOWING (something the player should not know yet and characters should not reveal early), mark that entry visibility:"hidden" (it is still injected into the AI as background, but it is not shown to the player and the AI will not give it away early); ordinary public lore stays "public".

The output is WorldBook data, with these fields: name (the name of this setting card) + entries (array, each {"keys":[...],"content":"...","comment":"...","visibility":"public or hidden"}).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{"name":"...","entries":[...]},"next_question":"the next question","done":false,"filled":["entries added/updated this turn"]}.
When there is a name + at least 3 entries, or the user says they are finished, set done to true and stop asking questions.
Language: write reply, next_question, name, keys, content and comment in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). visibility stays exactly "public" or "hidden". Output only the JSON."""

_BUILD_STORY = """You are a "conversational story-book builder" assistant. Through chat, you help the user work out the story book for an interactive story.

How to work: ask one or two questions at a time and dig in: what the premise is, how the main plot should go, which key events will happen, what endings are possible (and their trigger conditions), and whether there are time cues.
Missing fields may be reasonably inferred, but anything inferred (not stated explicitly by the user) must be listed with one line in needs_confirm for the user to confirm. Do not invent hard facts the user has not stated.

The output is StoryBook data, with these fields: title / premise / timeline (array) / main_plot (main-plot stages, array) /
freedom_rules (player-freedom rules, array) / events (array, each {"event_id","title","summary","trigger_keywords":[],"choices_hint":[],"consequences":[]}) /
endings (array, each {"ending_id","title","summary","conditions":[],"tone"}) / needs_confirm (array).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{the fields above, filled in progressively},"next_question":"the next question","done":false,"filled":["fields filled this turn"]}.
When title / premise / at least one main-plot stage / at least one ending all exist, or the user says they are finished, set done to true and stop asking questions.
Language: write reply, next_question and every free-text value in draft in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written); event_id / ending_id stay short ASCII IDs. Output only the JSON."""

_BUILD_SYSTEMS = {
    "characters": _BUILD_SYSTEM,
    "players": _BUILD_PLAYER,
    "worlds": _BUILD_WORLD,
    "stories": _BUILD_STORY,
}

# —— 完整度门控(E0):understand 阶段——只评估与提问,不写卡 ——
# 设计:AI 自由度太高的病根是"用户说一句就敢写"。此阶段先自评这张卡的信息完整度(0-100),
# 低于阈值只许问(结构化选项题,复刻 StoryChoice 范式);达标改出「创作蓝图」等用户批准。
# 硬门槛在 build_card 代码里强制:understand 阶段无论模型返回什么 draft 一律丢弃(回传 prev)。
_UNDERSTAND_ASPECTS = {
    "characters": "name or form of address / identity and origins / core personality and inner tension / relationship with the player (protagonist) / voice and way of speaking / the scene and atmosphere they are in",
    "players": "who they play (name, identity) / background and origins / their goal for this run / abilities and limits / what they know at the start",
    "worlds": "a one-sentence definition of the world / one or two iron laws of the world / key locations, factions and terms / atmosphere and tone / whether there is a hidden truth",
    "stories": "premise (who, where, what happened) / core conflict / main characters / rough direction or ending direction / pacing (fast or slow)",
}

_UNDERSTAND_SYSTEM_TMPL = """You are the ideation assistant for "conversational card building". The user wants to create a {kind_zh}. This is the IDEATION PHASE: your job is to figure out what the user wants. In this phase you must never write the card.

Assessment dimensions (roughly what this card needs in order to hold up): {aspects}

Each turn, do three things:
1) Score the completeness of the current information against the dimensions above (completeness, an integer 0-100): how much the user has already made clear. Only information the user has explicitly given or explicitly approved counts; your own guesses do not. Note: references and materials that the user explicitly attached (the [User reference: ...] / [User's existing material ...] sections) are not your guesses; they are material the user personally provided. Check them dimension by dimension: any dimension already covered by a reference or material counts as made clear, and do not discount it just because it came from a reference. When substantive references or materials are attached, completeness must be clearly higher than it would be with no material at all.
2) If completeness < {threshold}: pick the 1-3 most critical gaps and ask about them. Give each question 3-5 concrete, flavorful, directly clickable directions (not abstract category words; options that paint a picture at a glance, like "a compulsive liar with a soft heart"); the user may also answer freely. Do not re-ask anything that has already been answered.
3) If completeness >= {threshold}: stop asking questions. Give a "creative blueprint" (blueprint): 4-6 bullet points explaining how you plan to write this card (core anchor direction / personality or tone / relationships and tension / opening direction, etc.), for the user to approve before you start writing.

Each turn, output strictly this JSON:
{{
 "reply":"your natural response to the user this turn, one or two sentences, conversational",
 "completeness": an integer from 0 to 100,
 "questions":[{{"id":"short id","label":"the question itself","options":["concrete direction 1","concrete direction 2","concrete direction 3"],"allow_free":true}}],
 "blueprint":["point 1","point 2"],
 "draft": null,
 "done": false
}}
Rules: in the ideation phase draft is always null; when completeness>={threshold}, questions must be [], otherwise blueprint must be [].
Language: write reply, every question label and option, and every blueprint point in English, even when the user, the references or the materials are in Chinese or another language (proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). Output only the JSON."""


def _normalize_questions(raw) -> list[dict]:
    """规整 understand 阶段的结构化问题(镜像 story._normalize_choices 的容错姿势)。
    接受 dict 或纯字符串;每题 {id,label,options[≤5],allow_free};最多 3 题。"""
    out: list[dict] = []
    for i, q in enumerate((raw or [])[:3]):
        if isinstance(q, str):
            label, options, allow_free, qid = q.strip(), [], True, f"q{i + 1}"
        elif isinstance(q, dict):
            label = str(q.get("label") or q.get("q") or q.get("question") or "").strip()
            options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:5]
            allow_free = bool(q.get("allow_free", True))
            qid = str(q.get("id") or f"q{i + 1}").strip() or f"q{i + 1}"
        else:
            continue
        if not label:
            continue
        out.append({"id": qid, "label": label, "options": options, "allow_free": allow_free})
    return out


def _validate_build_draft(kind: str, raw_draft: dict, prev: dict | None) -> dict:
    """把模型给的草稿按 kind 校验成对应卡的合法 data。失败回退上一版草稿。"""
    rd = raw_draft if isinstance(raw_draft, dict) else {}
    prev = prev or {}
    try:
        if kind == "players":
            clean = {k: v for k, v in rd.items() if k in PlayerCard.model_fields}
            return PlayerCard(**clean).model_dump()
        if kind == "worlds":
            entries = []
            for e in rd.get("entries") or []:
                if not isinstance(e, dict):
                    continue
                keys = [str(x) for x in (e.get("keys") or []) if str(x).strip()]
                # #4 修复:用 model_fields 过滤,保全 visibility/truth_status/source/priority。
                # 此前只传 keys/content/comment → visibility 恒回退 public → 对话建卡里标了"隐藏"的
                # 设定真相被剥成公开 → 直接剧透。现在透传模型给的合法字段。
                clean = {k: v for k, v in e.items() if k in WorldEntry.model_fields}
                clean["keys"] = keys
                clean.setdefault("content", str(e.get("content") or ""))
                clean.setdefault("comment", keys[0] if keys else "")
                try:
                    entries.append(WorldEntry(**clean))
                except Exception:
                    continue
            return WorldBook(name=str(rd.get("name") or prev.get("name") or "World Book"), entries=entries).model_dump()
        if kind == "stories":
            events = [_story_event_from(e) for e in rd.get("events", []) if isinstance(e, dict)]
            endings = [m for e in rd.get("endings", []) if (m := _model_from(Ending, e))]
            return StoryBook(
                title=str(rd.get("title") or prev.get("title") or "Story Book"),
                premise=str(rd.get("premise") or ""),
                timeline=[str(x) for x in (rd.get("timeline") or [])],
                main_plot=[str(x) for x in (rd.get("main_plot") or [])],
                freedom_rules=[str(x) for x in (rd.get("freedom_rules") or [])],
                events=events, endings=endings,
                clock_start=_coerce_int(rd.get("clock_start"), 0) or 0,
                pacing=[str(x) for x in (rd.get("pacing") or [])],
                needs_confirm=[str(x) for x in (rd.get("needs_confirm") or []) if str(x).strip()],
            ).model_dump()
        # characters(默认)
        clean = {k: v for k, v in rd.items() if k in CharacterData.model_fields}
        clean.setdefault("name", prev.get("name") or "")
        return CharacterData(**clean).model_dump()
    except Exception:
        return prev or ({"name": ""} if kind != "stories" else {"title": ""})


_KIND_ZH = {
    "characters": "character card",
    "players": "player card (the protagonist the player plays)",
    "worlds": "world book / setting card",
    "stories": "story book",
}


def build_card(
    kind: str,
    messages: list[dict],
    draft: dict | None = None,
    seed: str = "",
    phase: str = "drafting",
    threshold: int = 60,
    refs: list[dict] | None = None,
) -> dict:
    """对话式建卡一轮(无状态),kind ∈ characters/players/worlds/stories。

    messages:[{role, content}] 至今的对话(前端维护);draft:当前草稿(对应卡的 data);
    seed:可选,已有资料/旧卡文本(完善模式,针对空/弱字段定向追问)。
    refs(F0 AI 触点可控):可选,用户点名引用的参考物 [{label, text}](已有卡/提示词等),
    ≤4 条、单条 text 截 3000;不传=旧行为零影响。与 seed 双轨:seed=散文资料,refs=结构化引用。
    phase(E0 完整度门控):"drafting"(默认,原行为不变——旧前端/MCP/冒烟脚本零影响)|
      "understand"(构思阶段:只评完整度+提问/出蓝图,**代码强制不写卡**——无论模型返回什么
      draft 一律丢弃、回传 prev。这是「评分之下不得 AI 写」的硬门槛,prompt 约定+代码强制双保险)。
    threshold:完整度阈值(0-100,默认 60),仅 understand 阶段生效。
    把对话历史折进 system(避免 DeepSeek json_mode 遇多轮 assistant 散文吐空白),只发 [system, user]。
    返回 {reply, draft, next_question, done, filled};understand 阶段另带
    {completeness, questions[{id,label,options,allow_free}], blueprint[], phase}。
    """
    kind = kind if kind in _BUILD_SYSTEMS else "characters"
    understand = phase == "understand"
    try:
        threshold = max(0, min(100, int(threshold)))
    except Exception:
        threshold = 60
    msgs = messages or []
    if msgs and msgs[-1].get("role") == "user":
        history, latest = msgs[:-1], str(msgs[-1].get("content") or "")
    else:
        history, latest = msgs, (
            "(Let's start building the card. Please ask me your first question.)"
            if not understand
            else "(I want to make a card. First help me figure out what I want.)"
        )
    system = (
        _UNDERSTAND_SYSTEM_TMPL.format(kind_zh=_KIND_ZH[kind], aspects=_UNDERSTAND_ASPECTS[kind], threshold=threshold)
        if understand
        else _BUILD_SYSTEMS[kind]
    )
    if seed and seed.strip():
        system += (
            "\n\n[User's existing material / old card: refine the card based on it, and find empty or weak "
            "fields to ask targeted follow-up questions about. If it is not in English, translate what you use "
            "into English]\n" + seed.strip()[:6000]
        )
    for r in (refs or [])[:4]:
        if not isinstance(r, dict):
            continue
        label = str(r.get("label") or "").strip()[:60] or "Reference"
        body = str(r.get("text") or "").strip()[:3000]
        if body:
            system += (
                f"\n\n[User reference: {label}. The user explicitly asked you to draw on this; follow its "
                f"flavor/setting with priority, but do not copy it wholesale, and write in English]\n{body}"
            )
    if draft:
        system += (
            "\n\n[Current draft (keep filling it in from here; do not overturn what the user has already confirmed)]\n"
            + json.dumps(draft, ensure_ascii=False)[:4000]
        )
    recap = "\n".join(
        ("User: " if m.get("role") == "user" else "Assistant: ") + str(m.get("content") or "")[:500]
        for m in history if m.get("content")
    )
    if recap:
        system += "\n\n[Conversation so far]\n" + recap

    raw = chat_messages(
        [{"role": "system", "content": system}, {"role": "user", "content": latest}],
        json_mode=True,
        max_tokens=2400,
    )
    try:
        obj = _loads_tolerant(raw)
    except Exception:
        obj = {}

    if understand:
        try:
            comp = max(0, min(100, int(obj.get("completeness"))))
        except Exception:
            comp = 0
        questions = _normalize_questions(obj.get("questions"))
        blueprint = [str(x).strip() for x in (obj.get("blueprint") or []) if str(x).strip()][:8]
        # 按分数整理互斥(模型两个都给/都不给时以分数为准):达标=只留蓝图;未达标=只留问题。
        if comp >= threshold:
            questions = []
        else:
            blueprint = []
        return {
            "reply": str(obj.get("reply") or ""),
            # 硬门槛:构思阶段不写卡。draft 原样回传(prev 规整),模型输出的 draft 一律丢弃。
            "draft": _validate_build_draft(kind, draft or {}, draft),
            # 纯文本降级路径:不认识 questions 的消费方至少能拿到第一题当追问。
            "next_question": str(obj.get("next_question") or "") or (questions[0]["label"] if questions else ""),
            "done": False,
            "filled": [],
            "completeness": comp,
            "questions": questions,
            "blueprint": blueprint,
            "phase": "understand",
        }

    raw_draft = obj.get("draft") if isinstance(obj.get("draft"), dict) else (draft or {})
    return {
        "reply": str(obj.get("reply") or ""),
        "draft": _validate_build_draft(kind, raw_draft, draft),
        "next_question": str(obj.get("next_question") or ""),
        "done": bool(obj.get("done")),
        "filled": [str(x) for x in (obj.get("filled") or [])],
    }


def extract_text_from_file(filename: str, raw: bytes) -> str:
    """从上传文件提取纯文本。支持 .txt / .md / .docx。"""
    lower = filename.lower()
    if lower.endswith(".docx"):
        from docx import Document  # python-docx
        doc = Document(io.BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs)
    # .txt / .md / 其它纯文本:按 UTF-8 解码,失败退回 GBK
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gbk", errors="replace")


if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    sample = "阿砚,二十出头的剑修,沉默寡言,门派被灭后独自下山复仇。说话很冲,从不解释自己。"
    card = identify(sample)
    print(json.dumps(card.model_dump(), ensure_ascii=False, indent=2))
