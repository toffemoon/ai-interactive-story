"""自动识别 —— 把用户贴进来的散文设定,抽取成结构化 Card V2。

核心一步:用户不用手填字段,扔文档进来,AI 自己拆。
设计原则:不做纯黑箱,识别结果要回给用户确认/微调。
"""

import io
import json
import re

from .lang import L, is_zh
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

_SYSTEM_EN = """You are a character-sheet parser. The user will give you descriptive text about one character (it may be prose, a short essay, or full of memes and fandom slang, and it may be written in Chinese or any other language).
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

_SYSTEM_ZH = """你是一个角色设定解析器。用户会给你一段关于某个角色的设定文字(可能是散文、小作文、夹杂梗和黑话)。
你的任务是把它抽取成结构化 JSON,字段如下:

- name: 角色名(必填;找不到就根据内容起一个最贴切的)
- description: 角色主设定(背景、外貌、身份、经历)
- personality: 性格摘要
- scenario: 当前所处的情境或故事背景(没有就留空字符串)
- first_mes: 一句符合人设的开场白(角色对玩家说的第一句话;原文没有就你来写一句)
- mes_example: 一两句能体现该角色说话语气的范例对话
- speech_rules: 数组,3-6 条该角色说话/行为的硬规则,用来锁住语气不漂
  (例如 "说话简短,从不用感叹号"、"自称'本座'"、"绝不主动示弱")
- tags: 数组,几个标签

要求:
- 严格忠于原设定,不要自行扩写人物经历;原文没写的经历不要编。
- speech_rules 要具体、可执行,是"怎么说话"而不是"性格如何"。
- 只输出 JSON,不要任何解释。"""


def _hint_block(hint: str) -> str:
    """用户对本次解析/生成的额外要求 → system 追加段(F0 AI 触点可控)。

    空串返回空——所有加了 hint 参数的函数在不传时与旧行为完全一致。
    截 1000 字:hint 是"口味指示"不是素材,素材走 text/seed/refs。
    """
    h = (hint or "").strip()[:1000]
    if not h:
        return ""
    return L(
        "\n\n[Additional instructions from the user for this request. Follow them with priority, "
        "as long as they do not break the required JSON output format or the requirement that all "
        f"free-text output be in English]\n{h}",
        f"\n\n【用户对这次解析的额外要求——在不破坏输出 JSON 格式的前提下优先遵守】\n{h}",
    )


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
                {"role": "system", "content": L(_SYSTEM_EN, _SYSTEM_ZH) + _hint_block(hint)},
                {"role": "user", "content": text.strip()},
            ],
            json_mode=True,
            max_tokens=2048,
        )
        try:
            return CharacterCard(data=CharacterData(**_loads_tolerant(raw)))
        except Exception as e:  # JSON 不合法 / 字段缺失:重试一次
            last_err = e
    raise ValueError(L(
        f"Character card recognition failed (invalid JSON after retries): {last_err}",
        f"角色卡识别失败(JSON 不合法,已重试):{last_err}",
    ))


_WORLD_SYSTEM_EN = """You are a worldbuilding parser. The user will give you descriptive text about a fictional world
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

_WORLD_SYSTEM_ZH = """你是一个世界观解析器。用户会给你一段关于某个虚构世界的设定文字
(地理、势力、规则、历史、种族、重要地点/物品等)。
把它拆成若干"世界书条目",每条聚焦一个主题,输出 JSON:

{"entries": [
  {"keys": ["触发关键词1", "关键词2"], "content": "该主题的设定内容", "comment": "条目标题"},
  ...
]}

要求:
- 每条 keys 是玩家对话里一旦出现、就该让 AI"想起"这条设定的词(地名、势力名、术语等)。
- content 要自包含,是会被注入给角色 AI 的背景知识,简洁准确。
- 忠于原文,不要编造原文没有的设定。
- 拆 3-12 条为宜。只输出 JSON。"""


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


def worldbook_from_markdown(text: str, name: str | None = None) -> WorldBook:
    """对已是 markdown 标题结构的文档,按 ## 直接切成精细条目,不经 LLM 压缩。"""
    if name is None:
        name = L("World Book", "世界书")
    entries = []
    for sec in _split_markdown_sections(text):
        content = "\n".join(sec["lines"]).strip()
        if len(content) < 10:  # 跳过空段/纯过渡段
            continue
        keys = _extract_keys(sec["title"], content) or [sec["title"][:20]]
        comment = f'{sec["group"]} · {sec["title"]}' if sec["group"] else sec["title"]
        entries.append(WorldEntry(keys=keys, content=content, comment=comment))
    return WorldBook(name=_infer_book_name(text, entries, name), entries=entries)


def identify_worldbook(text: str, name: str | None = None, hint: str = "") -> WorldBook:
    """世界观文字 → 世界书。已结构化的 markdown 按标题切(不压缩);散文走 LLM 识别。

    hint 非空时跳过 markdown 快路径:用户给了解析指示=要 AI 按指示重组,
    纯代码切分吃不到指示(代价:超长结构化文档会被 LLM 压缩,如实)。
    """
    if name is None:
        name = L("World Book", "世界书")
    if not (hint or "").strip() and len(re.findall(r"^#{2,}\s", text, re.M)) >= 8:
        return worldbook_from_markdown(text, name)
    raw = chat_messages(
        [
            {"role": "system", "content": L(_WORLD_SYSTEM_EN, _WORLD_SYSTEM_ZH) + _hint_block(hint)},
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


def _infer_book_name(text: str, entries: list[WorldEntry], fallback: str | None = None) -> str:
    """给世界书/设定卡自动命名。优先文档标题,再按内容特征判断类型。"""
    if fallback is None:
        fallback = L("World Book", "世界书")
    title = re.search(r"^#\s+(.+)", text, re.M)
    if title:
        clean = title.group(1).strip().strip("《》")
        clean = re.sub(r"^《(.+)》", r"\1", clean)
        if clean:
            low = clean.lower()
            if any(word in clean for word in ["世界观", "世界书"]) or any(
                w in low for w in ["world book", "worldbook", "worldbuilding"]
            ):
                return L("World Book", "世界书")
            if any(word in clean for word in ["角色", "人物"]) or "character" in low:
                return clean
            if any(word in clean for word in ["组织", "公司", "派系", "势力", "空间站", "设定"]) or any(
                w in low for w in ["organization", "organisation", "faction", "company", "station", "setting"]
            ):
                return clean
            return clean[:32]

    sample = text[:6000]
    ipc = L("Interastral Peace Corporation Setting Card", "星际和平公司设定卡")
    herta = L("Herta Space Station Setting Card", "黑塔空间站设定卡")
    genius = L("Genius Society Setting Card", "天才俱乐部设定卡")
    sid = L("Strategic Investment Department Setting Card", "战略投资部设定卡")
    stonehearts = L("Ten Stonehearts Setting Card", "石心十人设定卡")
    xianzhou = L("Xianzhou Alliance Setting Card", "仙舟联盟设定卡")
    express = L("Astral Express Setting Card", "星穹列车设定卡")
    known = [
        ("星际和平公司", ipc),
        ("IPC", ipc),
        ("Interastral Peace", ipc),
        ("黑塔空间站", herta),
        ("Herta Space Station", herta),
        ("天才俱乐部", genius),
        ("Genius Society", genius),
        ("战略投资部", sid),
        ("Strategic Investment Department", sid),
        ("石心十人", stonehearts),
        ("Ten Stonehearts", stonehearts),
        ("仙舟联盟", xianzhou),
        ("Xianzhou Alliance", xianzhou),
        ("星穹列车", express),
        ("Astral Express", express),
    ]
    for needle, label in known:
        if needle in sample:
            return label

    joined_comments = " ".join(e.comment for e in entries[:8])
    hay = f"{sample} {joined_comments}"
    if any(word in sample or word in joined_comments for word in ["派系", "势力", "组织", "阵营"]) or _en_hit(hay, _EN_ORG_WORDS):
        return L("Organization/Faction Setting Card", "组织/派系设定卡")
    if any(word in sample or word in joined_comments for word in ["地点", "空间站", "城市", "星球"]) or _en_hit(hay, _EN_PLACE_WORDS):
        return L("Location Setting Card", "地点设定卡")
    if any(word in sample or word in joined_comments for word in ["规则", "机制", "术语", "命途"]) or _en_hit(hay, _EN_RULE_WORDS):
        return L("Rules/Terminology Setting Card", "规则/术语设定卡")
    return fallback


_PLAYER_SYSTEM_EN = """You are a player-card parser. The user will give you a description of the player / protagonist / their own original character (it may be written in Chinese or any other language).
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

_PLAYER_SYSTEM_ZH = """你是玩家设定卡解析器。用户会给一段玩家/主角/自设角色的设定。
请抽取成 JSON:
{
  "name": "玩家名或代号",
  "role": "玩家在故事中的身份",
  "background": "背景摘要",
  "goals": ["目标"],
  "abilities": ["能力/资源"],
  "constraints": ["限制/禁忌/弱点"],
  "known_facts": ["玩家开局知道的事实"]
}
要求忠于原文,不要扩写经历。只输出 JSON。"""


def identify_player(text: str, hint: str = "") -> PlayerCard:
    """玩家设定文字 → PlayerCard。JSON 偶发不合法时容错解析 + 重试一次再抛(对齐 identify)。"""
    last_err: Exception | None = None
    for _ in range(3):
        raw = chat_messages(
            [
                {"role": "system", "content": L(_PLAYER_SYSTEM_EN, _PLAYER_SYSTEM_ZH) + _hint_block(hint)},
                {"role": "user", "content": text.strip()},
            ],
            json_mode=True,
            max_tokens=1536,
        )
        try:
            return PlayerCard(**_loads_tolerant(raw))
        except Exception as e:  # JSON 不合法 / 字段缺失:重试
            last_err = e
    raise ValueError(L(
        f"Player card recognition failed (invalid JSON after retries): {last_err}",
        f"玩家卡识别失败(JSON 不合法,已重试):{last_err}",
    ))


_STORY_SYSTEM_EN = """You are an interactive story-book parser. What the user gives you may be a complete outline, or just a few scattered ideas / setting fragments (it may be written in Chinese or any other language).
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

_STORY_SYSTEM_ZH = """你是互动故事书解析器。用户给的可能是完整大纲,也可能只是几个离散点子/设定碎片。
把它解析并补全成结构化 JSON。缺的字段可以基于已有素材合理推断,但凡是推断出来(原文没明说)的,
都要在 needs_confirm 里列一句说明,让作者回去确认。

输出 JSON:
{
  "title": "故事书标题",
  "premise": "故事前提(一两句)",
  "timeline": ["按时间顺序的关键节点"],
  "main_plot": ["主线阶段"],
  "freedom_rules": ["保证玩家自由度的规则"],
  "clock_start": 0,                  // 开局故事内时间(分钟,从 0 起算;有"傍晚/第三天"等线索可换算,默认 0)
  "pacing": ["全局节奏/时间提示,例如 账单每过几故事小时增殖一次"],
  "events": [
    {
      "event_id": "短英文或拼音 ID", "title": "事件标题", "summary": "事件内容",
      "trigger_keywords": ["玩家提到这些词可能触发"],
      "trigger_flags": ["需要已有状态 flag 才触发"],
      "reveal_after": ["需要先披露/完成的事件 ID"],
      "location": "地点", "characters": ["相关角色"],
      "choices_hint": ["适合给玩家的行动选项"], "consequences": ["可能后果"],
      "status": "pending",
      "due_clock": null,             // 故事内时钟(分钟)到此值该事件主动恶化/登场;纯时间驱动的才填,否则 null
      "escalate_after_idle": null,   // 主线静默这么多分钟后该事件升级催促;盯人/施压类填,否则 null
      "severity": 2                  // 1-5,事件恶化烈度/优先级
    }
  ],
  "endings": [
    {"ending_id":"短ID","title":"结局名","summary":"结局梗概","conditions":["触发条件,自然语言为主"],"required_events":["达成本结局必须 resolved 的 event_id(取自上面 events)"],"required_facts":["达成本结局必须已揭示的关键事实"],"tone":"好结局/悲剧/开放/隐藏"}
  ],
  "character_boundaries": [
    {"character":"角色名","public":["公开可知"],"hidden":["未披露前不能由角色说出"],"hard_limits":["身份/实力/能力上限"]}
  ],
  "needs_confirm": ["哪些字段是你推断的、建议作者确认,一句一条"]
}

原则:
- 事件节点要可触发,不要只写文学摘要;离散点子也尽量补成可玩的事件/结局。
- endings 给 1-3 个不同走向(好结局/坏结局/隐藏等),各自写清触发条件;尽量在 required_events 填达成该结局必须 resolved 的 event_id(对应上面 events 的 event_id)、required_facts 填必须揭示的关键事实,供引擎客观判定结局(没有合适的就留空数组,引擎会回退到模型判定)。
- 时间字段(clock_start / due_clock / escalate_after_idle)只在素材有时间线索、或事件本就该随时间恶化时填,
  拿不准就留默认(0/null)并在 needs_confirm 标注。
- character_boundaries 把"角色知道什么、瞒着什么、能力到哪"单列,供一致性防护用,只列主要角色。
- 未在原文出现的硬事实不要编造;凡推断必进 needs_confirm。保留玩家自由度,不要一本道。
- 输出务必精简且 JSON 完整闭合:events 控制在 12 条内、每条文字简短,绝不要写到一半被截断。只输出 JSON。"""


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
    system = L(_STORY_SYSTEM_EN, _STORY_SYSTEM_ZH) + _hint_block(hint)
    if concise:
        system += L("\n\n[REMINDER] Your previous output was too long and got truncated. This time be much leaner: "
                    "at most 8 events, one sentence per field, 1-3 endings, character_boundaries for only the 2-3 main "
                    "characters, and make sure the whole JSON is fully closed. All free-text values must still be in English.",
                    "\n\n【再次强调】上次输出过长被截断。这次务必更精简:events ≤8 条、每字段一句话、"
                    "endings 1-3 个、character_boundaries 只列 2-3 个主要角色,确保整个 JSON 完整闭合。")
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
        raise ValueError(L(
            "Story book parsing failed: the model output was too long or not valid JSON. "
            "Try splitting the material into shorter pieces and try again.",
            "故事书解析失败:模型输出过长或非合法 JSON,建议把素材拆短再试",
        ))
    events = [_story_event_from(e) for e in obj.get("events", []) if isinstance(e, dict)]
    endings = [m for e in obj.get("endings", []) if (m := _model_from(Ending, e))]
    bounds = [m for b in obj.get("character_boundaries", []) if (m := _model_from(CharacterBoundary, b))]
    return StoryBook(
        title=obj.get("title") or L("Story Book", "故事书"),
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


_CLASSIFY_SYSTEM_EN = """You are an upload-content classifier. The user pastes some setting text (it may be written in Chinese or any other language); decide which category it fits best:
- character: a character sheet for one particular character/person (name, personality, appearance, way of speaking, history)
- world: worldbuilding / setting card (geography, factions, organizations, rules, locations, terminology, history, institutions)
- story: an interactive story book (timeline, main plot, event nodes, endings, plot outline, a case to solve)
- player: the player / protagonist's own character (who the player plays, identity, goals, abilities, limits, what they know at the start)

How to decide: character focuses on "who one particular person is and how they talk"; player is "who I, the player, play and what I am here to do";
world is "the objective facts of this world/organization/place"; story is "what will happen, which clues drive it forward, and what endings exist".
Output JSON: {"kind":"character|world|story|player","confidence":a decimal between 0 and 1,"reason":"a one-sentence justification"}. Write reason in English, even if the text is in Chinese. Output only the JSON."""

_CLASSIFY_SYSTEM_ZH = """你是上传内容分类器。用户贴一段设定文字,你判断它最适合归到哪一类:
- character:某个角色/人物的设定卡(名字、性格、外貌、说话方式、经历)
- world:世界观 / 设定卡(地理、势力、组织、规则、地点、术语、历史、机构)
- story:互动故事书(时间线、主线、事件节点、结局、剧情大纲、案件)
- player:玩家 / 主角自设(玩家扮演谁、身份、目标、能力、限制、开局已知)

判断依据:character 聚焦"某一个人是谁、怎么说话";player 是"我作为玩家扮演谁、要做什么";
world 是"这个世界/组织/地点的客观设定";story 是"会发生什么、按什么线索推进、有哪些结局"。
输出 JSON:{"kind":"character|world|story|player","confidence":0到1的小数,"reason":"一句话依据"}。只输出 JSON。"""

_KINDS = {"character", "world", "story", "player"}


def classify_text(text: str) -> dict:
    """判断一段设定文字属于 角色/世界/故事/玩家 哪一类。返回 {kind, confidence, reason}。"""
    raw = chat_messages(
        [
            {"role": "system", "content": L(_CLASSIFY_SYSTEM_EN, _CLASSIFY_SYSTEM_ZH)},
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
        cls = {"kind": kind, "confidence": 1.0, "reason": L("Type specified by the user", "用户指定类型")}
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


_BUILD_SYSTEM_EN = """You are a "conversational character-card builder" assistant. Through relaxed chat, you help the user (who may have no idea how to write a character sheet) build a character card (Card V2) step by step.

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

_BUILD_SYSTEM_ZH = """你是「对话式角色建卡」助手。陪用户(可能完全不会写设定)通过轻松聊天,一步步建出一张角色卡(Card V2)。

工作方式:
- 一次只问一两个问题,别一股脑灌;像朋友聊天,顺着用户的话往下挖。
- 挖得比"性格几个词"更深:这个人怎么看世界(心智模型)、压力下怎么做决定(决策启发式)、
  说话有什么独特腔调/口头禅/句式(表达 DNA)。把这些提炼进卡的【现有字段】,不要另造新字段。
- 用户说不清时,给 2-3 个具体选项让他挑,或用例子启发;不替他拍板人物的核心。
- 不编造用户没给的硬经历;可以提议,但在 reply 里标清"这是我猜的,你来定"。

产出仍是标准 Card V2 的 data,字段:
- name:角色名
- description:背景、身份、外貌、经历(把世界观/心智模型写进这里)
- personality:性格 + 决策启发式(压力下怎么选)
- scenario:当前情境(没有可留空)
- first_mes:一句符合人设的开场白
- mes_example:一两句体现说话腔调的范例
- speech_rules:3-6 条具体可执行的说话/行为硬规则(把表达 DNA 化成规则,如"自称'本座'""从不用感叹号")
- tags:几个标签

每轮严格输出 JSON:
{
 "reply":"对用户这轮的自然回应(像聊天,别罗列字段)",
 "draft":{上面 Card V2 的 data 字段,逐步填充,把目前已知的都填上},
 "next_question":"下一个引导问题(完成时可留空)",
 "done":false,
 "filled":["本轮新填或更新的字段名"]
}
收尾规则:
- 当 name / description / personality / speech_rules(≥3 条)/ mes_example 都已合理填好,
  或用户明确表示完成("可以了""就这样""定下来""差不多了""够了"),done 置 true、
  next_question 留空、不要再追问,reply 里告诉用户"卡差不多齐了,可以进编辑器微调"。
- 别重复你上一轮已经问过的问题;用户没正面回答时,换个角度或先填别的字段,别原地打转。
只输出 JSON。"""


_BUILD_PLAYER_EN = """You are a "conversational protagonist-card builder" assistant. Through chat, you help the user (who may not know how to write a character sheet) work out the protagonist they will play in the story (the player card).

How to work: ask one or two questions at a time and follow the conversation; when the user cannot articulate something, offer 2-3 options to pick from; do not decide the core for them, and do not invent hard facts they have not stated.
Make these clear: who the player plays, their identity, what they want to do in the story (goals), what abilities/resources they have, what limits/taboos/weaknesses they have, and what they already know at the start.

The output is PlayerCard data, with these fields: name / role (identity) / background / goals (array) /
abilities (abilities and resources, array) / constraints (limits, taboos, weaknesses, array) / known_facts (known at the start, array).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{the fields above, filled in progressively},"next_question":"the next question","done":false,"filled":["fields filled this turn"]}.
When name / role / background / at least one goal are all filled, or the user says they are finished (e.g. "that's it", "done", or "可以了" / "就这样"), set done to true and stop asking questions.
Language: write reply, next_question and every free-text value in draft in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). Output only the JSON."""

_BUILD_PLAYER_ZH = """你是「对话式主角卡建卡」助手。陪用户(可能不会写设定)聊出他在故事里要扮演的主角(玩家卡)。

工作方式:一次问一两个,顺着聊;说不清就给 2-3 个选项让他挑;不替他拍板核心、不编没说的硬设定。
要挖清:玩家扮演谁、什么身份、进故事想做什么(目标)、有什么能力/资源、有什么限制/禁忌/弱点、开局就知道哪些事。

产出 PlayerCard 的 data,字段:name / role(身份)/ background(背景)/ goals(目标,数组)/
abilities(能力·资源,数组)/ constraints(限制·禁忌·弱点,数组)/ known_facts(开局已知,数组)。

每轮严格输出 JSON:{"reply":"自然回应","draft":{上面字段逐步填},"next_question":"下一个问题","done":false,"filled":["本轮填的字段"]}。
当 name / role / background / 至少一个 goal 都填好,或用户表示完成("可以了""就这样"),done 置 true、停止追问。只输出 JSON。"""

_BUILD_WORLD_EN = """You are a "conversational world book / setting card builder" assistant. Through chat, you help the user work out a world or a setting card: geography, factions, organizations, locations, rules, terminology, history, races, etc.

How to work: focus on one topic at a time and dig into it; each time a topic becomes clear, organize it into one "world book entry". When the user is vague, suggest directions; do not invent lore they have not stated.
One entry = keys (trigger keywords: place names / faction names / terms; whenever one appears in the player's dialogue, the AI should recall this entry) + content (background knowledge injected into the AI; self-contained, concise and accurate) + comment (the entry title).
If what the user describes is a SECRET / TRUTH / TWIST / FORESHADOWING (something the player should not know yet and characters should not reveal early), mark that entry visibility:"hidden" (it is still injected into the AI as background, but it is not shown to the player and the AI will not give it away early); ordinary public lore stays "public".

The output is WorldBook data, with these fields: name (the name of this setting card) + entries (array, each {"keys":[...],"content":"...","comment":"...","visibility":"public or hidden"}).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{"name":"...","entries":[...]},"next_question":"the next question","done":false,"filled":["entries added/updated this turn"]}.
When there is a name + at least 3 entries, or the user says they are finished, set done to true and stop asking questions.
Language: write reply, next_question, name, keys, content and comment in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written). visibility stays exactly "public" or "hidden". Output only the JSON."""

_BUILD_WORLD_ZH = """你是「对话式世界书/设定卡建卡」助手。陪用户聊出一个世界或设定卡:地理、势力、组织、地点、规则、术语、历史、种族等。

工作方式:一次聚焦一个主题往下挖;每聊清一块,就整理成一条「世界书条目」。说不清给方向;不编没说的设定。
一条条目 = keys(触发关键词:地名/势力名/术语,玩家对话里一出现就该让 AI 想起这条)+ content(会注入给 AI 的背景知识,自包含、简洁准确)+ comment(条目标题)。
若用户聊到的是【秘密 / 真相 / 反转 / 伏笔】(玩家此刻不该知道、角色不该提前说破的),给这条标 visibility:"hidden"(它仍会注入给 AI 当背景、但不展示给玩家、AI 也不会提前点破);普通公开设定留 "public"。

产出 WorldBook 的 data,字段:name(这套设定卡的名字)+ entries(数组,每条 {"keys":[...],"content":"...","comment":"...","visibility":"public 或 hidden"})。

每轮严格输出 JSON:{"reply":"自然回应","draft":{"name":"...","entries":[...]},"next_question":"下一个问题","done":false,"filled":["本轮新增/更新的条目"]}。
当有了名字 + 至少 3 条条目,或用户表示完成,done 置 true、停止追问。只输出 JSON。"""

_BUILD_STORY_EN = """You are a "conversational story-book builder" assistant. Through chat, you help the user work out the story book for an interactive story.

How to work: ask one or two questions at a time and dig in: what the premise is, how the main plot should go, which key events will happen, what endings are possible (and their trigger conditions), and whether there are time cues.
Missing fields may be reasonably inferred, but anything inferred (not stated explicitly by the user) must be listed with one line in needs_confirm for the user to confirm. Do not invent hard facts the user has not stated.

The output is StoryBook data, with these fields: title / premise / timeline (array) / main_plot (main-plot stages, array) /
freedom_rules (player-freedom rules, array) / events (array, each {"event_id","title","summary","trigger_keywords":[],"choices_hint":[],"consequences":[]}) /
endings (array, each {"ending_id","title","summary","conditions":[],"tone"}) / needs_confirm (array).

Each turn, output strictly this JSON: {"reply":"natural response","draft":{the fields above, filled in progressively},"next_question":"the next question","done":false,"filled":["fields filled this turn"]}.
When title / premise / at least one main-plot stage / at least one ending all exist, or the user says they are finished, set done to true and stop asking questions.
Language: write reply, next_question and every free-text value in draft in English, even when the user writes in Chinese or another language (translate their content into natural English while preserving its meaning; proper names may use an established English name, be romanized, e.g. pinyin, or be kept as written); event_id / ending_id stay short ASCII IDs. Output only the JSON."""

_BUILD_STORY_ZH = """你是「对话式故事书建卡」助手。陪用户聊出一个互动故事的故事书。

工作方式:一次问一两个,顺着挖:故事前提是什么、主线想怎么走、会发生哪些关键事件、有哪些可能结局(及触发条件)、有没有时间线索。
缺的字段可合理推断,但凡推断(原文没明说)的,在 needs_confirm 里列一句让用户确认。不编没说的硬事实。

产出 StoryBook 的 data,字段:title / premise(前提)/ timeline(时间线,数组)/ main_plot(主线阶段,数组)/
freedom_rules(自由度规则,数组)/ events(事件,数组,每个 {"event_id","title","summary","trigger_keywords":[],"choices_hint":[],"consequences":[]})/
endings(结局,数组,每个 {"ending_id","title","summary","conditions":[],"tone"})/ needs_confirm(数组)。

每轮严格输出 JSON:{"reply":"自然回应","draft":{上面字段逐步填},"next_question":"下一个问题","done":false,"filled":["本轮填的字段"]}。
当 title / premise / 至少一个主线阶段 / 至少一个结局 都有,或用户表示完成,done 置 true、停止追问。只输出 JSON。"""

_BUILD_SYSTEMS_EN = {
    "characters": _BUILD_SYSTEM_EN,
    "players": _BUILD_PLAYER_EN,
    "worlds": _BUILD_WORLD_EN,
    "stories": _BUILD_STORY_EN,
}
_BUILD_SYSTEMS_ZH = {
    "characters": _BUILD_SYSTEM_ZH,
    "players": _BUILD_PLAYER_ZH,
    "worlds": _BUILD_WORLD_ZH,
    "stories": _BUILD_STORY_ZH,
}

# —— 完整度门控(E0):understand 阶段——只评估与提问,不写卡 ——
# 设计:AI 自由度太高的病根是"用户说一句就敢写"。此阶段先自评这张卡的信息完整度(0-100),
# 低于阈值只许问(结构化选项题,复刻 StoryChoice 范式);达标改出「创作蓝图」等用户批准。
# 硬门槛在 build_card 代码里强制:understand 阶段无论模型返回什么 draft 一律丢弃(回传 prev)。
_UNDERSTAND_ASPECTS_EN = {
    "characters": "name or form of address / identity and origins / core personality and inner tension / relationship with the player (protagonist) / voice and way of speaking / the scene and atmosphere they are in",
    "players": "who they play (name, identity) / background and origins / their goal for this run / abilities and limits / what they know at the start",
    "worlds": "a one-sentence definition of the world / one or two iron laws of the world / key locations, factions and terms / atmosphere and tone / whether there is a hidden truth",
    "stories": "premise (who, where, what happened) / core conflict / main characters / rough direction or ending direction / pacing (fast or slow)",
}

_UNDERSTAND_ASPECTS_ZH = {
    "characters": "名字或称呼 / 身份与来历 / 性格底色与内在张力 / 和玩家(主角)的关系 / 说话腔调 / 所处场景氛围",
    "players": "扮演谁(名字·身份) / 来历背景 / 这一局的目标 / 能力与限制 / 开局知道什么",
    "worlds": "世界一句话定义 / 一两条世界铁则 / 关键地点·势力·术语 / 氛围基调 / 有没有隐藏真相",
    "stories": "故事前提(谁·在哪·出了什么事) / 核心冲突 / 主要角色 / 大致走向或结局方向 / 节奏快慢",
}

_UNDERSTAND_SYSTEM_TMPL_EN = """You are the ideation assistant for "conversational card building". The user wants to create a {kind_zh}. This is the IDEATION PHASE: your job is to figure out what the user wants. In this phase you must never write the card.

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

_UNDERSTAND_SYSTEM_TMPL_ZH = """你是「对话式建卡」的构思助手。用户想造一张{kind_zh},现在是【构思阶段】:你的任务是搞清楚用户想要什么,此阶段绝对不写卡。

评估维度(这张卡要立得住,大致需要这些面向):{aspects}

每轮做三件事:
1) 按上面维度自评当前信息的完整度 completeness(0-100 整数):用户已经说清了多少。只有用户明确给过或明确认可的信息才算数,你的猜测不算。注意:用户点名挂上的引用与资料(【用户引用:…】/【用户已有的资料…】段)不是你的猜测,是用户亲手给的素材——逐个维度对照,引用/资料里已覆盖的维度一律按已说清计分,不要因为信息来自引用而打折;挂了实质引用或资料时,完整度必须明显高于零素材的情形。
2) completeness < {threshold}:挑最关键的 1-3 个缺口提问。每个问题给 3-5 个具体、风格化、可直接点选的方向(不要抽象分类词,要像"满口谎话却心软的骗子"这种一眼有画面的选项),用户也可以自由回答。别重复问已经答过的。
3) completeness >= {threshold}:不再提问。给出「创作蓝图」blueprint:4-6 条要点,说清你打算怎么写这张卡(核心锚点方向 / 性格或基调 / 关系与张力 / 开场方向等),供用户批准后再动笔。

每轮严格输出 JSON:
{{
 "reply":"对用户这轮的自然回应,一两句,像聊天",
 "completeness": 0 到 100 的整数,
 "questions":[{{"id":"短id","label":"问题本身","options":["具体方向1","具体方向2","具体方向3"],"allow_free":true}}],
 "blueprint":["要点1","要点2"],
 "draft": null,
 "done": false
}}
规则:构思阶段 draft 恒为 null;completeness>={threshold} 时 questions 必须为 [],否则 blueprint 必须为 []。只输出 JSON。"""


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
            return WorldBook(name=str(rd.get("name") or prev.get("name") or L("World Book", "世界书")), entries=entries).model_dump()
        if kind == "stories":
            events = [_story_event_from(e) for e in rd.get("events", []) if isinstance(e, dict)]
            endings = [m for e in rd.get("endings", []) if (m := _model_from(Ending, e))]
            return StoryBook(
                title=str(rd.get("title") or prev.get("title") or L("Story Book", "故事书")),
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


_KIND_LABEL_EN = {
    "characters": "character card",
    "players": "player card (the protagonist the player plays)",
    "worlds": "world book / setting card",
    "stories": "story book",
}

_KIND_LABEL_ZH = {"characters": "角色卡", "players": "演出卡(玩家主角)", "worlds": "世界书 / 设定卡", "stories": "故事书"}


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
    kind = kind if kind in _BUILD_SYSTEMS_EN else "characters"
    understand = phase == "understand"
    zh = is_zh()
    try:
        threshold = max(0, min(100, int(threshold)))
    except Exception:
        threshold = 60
    msgs = messages or []
    if msgs and msgs[-1].get("role") == "user":
        history, latest = msgs[:-1], str(msgs[-1].get("content") or "")
    else:
        history, latest = msgs, (
            L("(Let's start building the card. Please ask me your first question.)", "(开始建卡,请先问我第一个问题)")
            if not understand
            else L("(I want to make a card. First help me figure out what I want.)", "(我想造一张卡,先帮我想清楚要什么)")
        )
    if understand:
        tmpl = _UNDERSTAND_SYSTEM_TMPL_ZH if zh else _UNDERSTAND_SYSTEM_TMPL_EN
        kind_label = (_KIND_LABEL_ZH if zh else _KIND_LABEL_EN)[kind]
        aspects = (_UNDERSTAND_ASPECTS_ZH if zh else _UNDERSTAND_ASPECTS_EN)[kind]
        system = tmpl.format(kind_zh=kind_label, aspects=aspects, threshold=threshold)
    else:
        system = (_BUILD_SYSTEMS_ZH if zh else _BUILD_SYSTEMS_EN)[kind]
    if seed and seed.strip():
        system += L(
            "\n\n[User's existing material / old card: refine the card based on it, and find empty or weak "
            "fields to ask targeted follow-up questions about. If it is not in English, translate what you use "
            "into English]\n",
            "\n\n【用户已有的资料 / 旧卡——基于它来完善,找出空或薄弱的字段定向追问】\n",
        ) + seed.strip()[:6000]
    for r in (refs or [])[:4]:
        if not isinstance(r, dict):
            continue
        label = str(r.get("label") or "").strip()[:60] or L("Reference", "参考")
        body = str(r.get("text") or "").strip()[:3000]
        if body:
            system += L(
                f"\n\n[User reference: {label}. The user explicitly asked you to draw on this; follow its "
                f"flavor/setting with priority, but do not copy it wholesale, and write in English]\n{body}",
                f"\n\n【用户引用:{label}——用户点名要参考的,优先照它的口味/设定来,但别整段照抄】\n{body}",
            )
    if draft:
        system += L(
            "\n\n[Current draft (keep filling it in from here; do not overturn what the user has already confirmed)]\n",
            "\n\n【当前草稿(在它基础上继续填,别推翻用户已确认的)】\n",
        ) + json.dumps(draft, ensure_ascii=False)[:4000]
    user_label, assistant_label = L("User: ", "用户:"), L("Assistant: ", "助手:")
    recap = "\n".join(
        (user_label if m.get("role") == "user" else assistant_label) + str(m.get("content") or "")[:500]
        for m in history if m.get("content")
    )
    if recap:
        system += L("\n\n[Conversation so far]\n", "\n\n【已进行的对话】\n") + recap

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
