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

_SYSTEM = """你是一个角色设定解析器。用户会给你一段关于某个角色的设定文字(可能是散文、小作文、夹杂梗和黑话)。
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
    return f"\n\n【用户对这次解析的额外要求——在不破坏输出 JSON 格式的前提下优先遵守】\n{h}" if h else ""


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
    raise ValueError(f"角色卡识别失败(JSON 不合法,已重试):{last_err}")


_WORLD_SYSTEM = """你是一个世界观解析器。用户会给你一段关于某个虚构世界的设定文字
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
        if tok.lower() in {"the", "of", "and", "with", "for"}:  # 英文停用词
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


def worldbook_from_markdown(text: str, name: str = "世界书") -> WorldBook:
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


def identify_worldbook(text: str, name: str = "世界书", hint: str = "") -> WorldBook:
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


def _infer_book_name(text: str, entries: list[WorldEntry], fallback: str = "世界书") -> str:
    """给世界书/设定卡自动命名。优先文档标题,再按内容特征判断类型。"""
    title = re.search(r"^#\s+(.+)", text, re.M)
    if title:
        clean = title.group(1).strip().strip("《》")
        clean = re.sub(r"^《(.+)》", r"\1", clean)
        if clean:
            if any(word in clean for word in ["世界观", "世界书"]):
                return "世界书"
            if any(word in clean for word in ["角色", "人物"]):
                return clean
            if any(word in clean for word in ["组织", "公司", "派系", "势力", "空间站", "设定"]):
                return clean
            return clean[:32]

    sample = text[:6000]
    known = [
        ("星际和平公司", "星际和平公司设定卡"),
        ("IPC", "星际和平公司设定卡"),
        ("黑塔空间站", "黑塔空间站设定卡"),
        ("天才俱乐部", "天才俱乐部设定卡"),
        ("战略投资部", "战略投资部设定卡"),
        ("石心十人", "石心十人设定卡"),
        ("仙舟联盟", "仙舟联盟设定卡"),
        ("星穹列车", "星穹列车设定卡"),
    ]
    for needle, label in known:
        if needle in sample:
            return label

    joined_comments = " ".join(e.comment for e in entries[:8])
    if any(word in sample or word in joined_comments for word in ["派系", "势力", "组织", "阵营"]):
        return "组织/派系设定卡"
    if any(word in sample or word in joined_comments for word in ["地点", "空间站", "城市", "星球"]):
        return "地点设定卡"
    if any(word in sample or word in joined_comments for word in ["规则", "机制", "术语", "命途"]):
        return "规则/术语设定卡"
    return fallback


_PLAYER_SYSTEM = """你是玩家设定卡解析器。用户会给一段玩家/主角/自设角色的设定。
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
    raise ValueError(f"玩家卡识别失败(JSON 不合法,已重试):{last_err}")


_STORY_SYSTEM = """你是互动故事书解析器。用户给的可能是完整大纲,也可能只是几个离散点子/设定碎片。
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
    system = _STORY_SYSTEM + _hint_block(hint)
    if concise:
        system += ("\n\n【再次强调】上次输出过长被截断。这次务必更精简:events ≤8 条、每字段一句话、"
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
        raise ValueError("故事书解析失败:模型输出过长或非合法 JSON,建议把素材拆短再试")
    events = [_story_event_from(e) for e in obj.get("events", []) if isinstance(e, dict)]
    endings = [m for e in obj.get("endings", []) if (m := _model_from(Ending, e))]
    bounds = [m for b in obj.get("character_boundaries", []) if (m := _model_from(CharacterBoundary, b))]
    return StoryBook(
        title=obj.get("title") or "故事书",
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


_CLASSIFY_SYSTEM = """你是上传内容分类器。用户贴一段设定文字,你判断它最适合归到哪一类:
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
        cls = {"kind": kind, "confidence": 1.0, "reason": "用户指定类型"}
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


_BUILD_SYSTEM = """你是「对话式角色建卡」助手。陪用户(可能完全不会写设定)通过轻松聊天,一步步建出一张角色卡(Card V2)。

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


_BUILD_PLAYER = """你是「对话式主角卡建卡」助手。陪用户(可能不会写设定)聊出他在故事里要扮演的主角(玩家卡)。

工作方式:一次问一两个,顺着聊;说不清就给 2-3 个选项让他挑;不替他拍板核心、不编没说的硬设定。
要挖清:玩家扮演谁、什么身份、进故事想做什么(目标)、有什么能力/资源、有什么限制/禁忌/弱点、开局就知道哪些事。

产出 PlayerCard 的 data,字段:name / role(身份)/ background(背景)/ goals(目标,数组)/
abilities(能力·资源,数组)/ constraints(限制·禁忌·弱点,数组)/ known_facts(开局已知,数组)。

每轮严格输出 JSON:{"reply":"自然回应","draft":{上面字段逐步填},"next_question":"下一个问题","done":false,"filled":["本轮填的字段"]}。
当 name / role / background / 至少一个 goal 都填好,或用户表示完成("可以了""就这样"),done 置 true、停止追问。只输出 JSON。"""

_BUILD_WORLD = """你是「对话式世界书/设定卡建卡」助手。陪用户聊出一个世界或设定卡:地理、势力、组织、地点、规则、术语、历史、种族等。

工作方式:一次聚焦一个主题往下挖;每聊清一块,就整理成一条「世界书条目」。说不清给方向;不编没说的设定。
一条条目 = keys(触发关键词:地名/势力名/术语,玩家对话里一出现就该让 AI 想起这条)+ content(会注入给 AI 的背景知识,自包含、简洁准确)+ comment(条目标题)。
若用户聊到的是【秘密 / 真相 / 反转 / 伏笔】(玩家此刻不该知道、角色不该提前说破的),给这条标 visibility:"hidden"(它仍会注入给 AI 当背景、但不展示给玩家、AI 也不会提前点破);普通公开设定留 "public"。

产出 WorldBook 的 data,字段:name(这套设定卡的名字)+ entries(数组,每条 {"keys":[...],"content":"...","comment":"...","visibility":"public 或 hidden"})。

每轮严格输出 JSON:{"reply":"自然回应","draft":{"name":"...","entries":[...]},"next_question":"下一个问题","done":false,"filled":["本轮新增/更新的条目"]}。
当有了名字 + 至少 3 条条目,或用户表示完成,done 置 true、停止追问。只输出 JSON。"""

_BUILD_STORY = """你是「对话式故事书建卡」助手。陪用户聊出一个互动故事的故事书。

工作方式:一次问一两个,顺着挖:故事前提是什么、主线想怎么走、会发生哪些关键事件、有哪些可能结局(及触发条件)、有没有时间线索。
缺的字段可合理推断,但凡推断(原文没明说)的,在 needs_confirm 里列一句让用户确认。不编没说的硬事实。

产出 StoryBook 的 data,字段:title / premise(前提)/ timeline(时间线,数组)/ main_plot(主线阶段,数组)/
freedom_rules(自由度规则,数组)/ events(事件,数组,每个 {"event_id","title","summary","trigger_keywords":[],"choices_hint":[],"consequences":[]})/
endings(结局,数组,每个 {"ending_id","title","summary","conditions":[],"tone"})/ needs_confirm(数组)。

每轮严格输出 JSON:{"reply":"自然回应","draft":{上面字段逐步填},"next_question":"下一个问题","done":false,"filled":["本轮填的字段"]}。
当 title / premise / 至少一个主线阶段 / 至少一个结局 都有,或用户表示完成,done 置 true、停止追问。只输出 JSON。"""

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
    "characters": "名字或称呼 / 身份与来历 / 性格底色与内在张力 / 和玩家(主角)的关系 / 说话腔调 / 所处场景氛围",
    "players": "扮演谁(名字·身份) / 来历背景 / 这一局的目标 / 能力与限制 / 开局知道什么",
    "worlds": "世界一句话定义 / 一两条世界铁则 / 关键地点·势力·术语 / 氛围基调 / 有没有隐藏真相",
    "stories": "故事前提(谁·在哪·出了什么事) / 核心冲突 / 主要角色 / 大致走向或结局方向 / 节奏快慢",
}

_UNDERSTAND_SYSTEM_TMPL = """你是「对话式建卡」的构思助手。用户想造一张{kind_zh},现在是【构思阶段】:你的任务是搞清楚用户想要什么,此阶段绝对不写卡。

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
            return WorldBook(name=str(rd.get("name") or prev.get("name") or "世界书"), entries=entries).model_dump()
        if kind == "stories":
            events = [_story_event_from(e) for e in rd.get("events", []) if isinstance(e, dict)]
            endings = [m for e in rd.get("endings", []) if (m := _model_from(Ending, e))]
            return StoryBook(
                title=str(rd.get("title") or prev.get("title") or "故事书"),
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


_KIND_ZH = {"characters": "角色卡", "players": "演出卡(玩家主角)", "worlds": "世界书 / 设定卡", "stories": "故事书"}


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
        history, latest = msgs, "(开始建卡,请先问我第一个问题)" if not understand else "(我想造一张卡,先帮我想清楚要什么)"
    system = (
        _UNDERSTAND_SYSTEM_TMPL.format(kind_zh=_KIND_ZH[kind], aspects=_UNDERSTAND_ASPECTS[kind], threshold=threshold)
        if understand
        else _BUILD_SYSTEMS[kind]
    )
    if seed and seed.strip():
        system += "\n\n【用户已有的资料 / 旧卡——基于它来完善,找出空或薄弱的字段定向追问】\n" + seed.strip()[:6000]
    for r in (refs or [])[:4]:
        if not isinstance(r, dict):
            continue
        label = str(r.get("label") or "").strip()[:60] or "参考"
        body = str(r.get("text") or "").strip()[:3000]
        if body:
            system += f"\n\n【用户引用:{label}——用户点名要参考的,优先照它的口味/设定来,但别整段照抄】\n{body}"
    if draft:
        system += "\n\n【当前草稿(在它基础上继续填,别推翻用户已确认的)】\n" + json.dumps(draft, ensure_ascii=False)[:4000]
    recap = "\n".join(
        ("用户:" if m.get("role") == "user" else "助手:") + str(m.get("content") or "")[:500]
        for m in history if m.get("content")
    )
    if recap:
        system += "\n\n【已进行的对话】\n" + recap

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
