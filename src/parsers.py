"""确定性卡片模板解析器(template → 结构化 model,零 LLM、零 API)。

对接 vault 卡片模板(`40-Projects/AI互动故事/template/`)的固定结构:
frontmatter + `## 0. 引擎摘要`(锚点 / speech_rules 表 / 召回关键词)+ 标号段 + 知识边界 public/hidden。

跟 identify.py 的关系:identify.* 是「散文 → LLM 识别」路径,本模块是「已按模板结构化的卡 → 确定性抽取」路径。
**不动 identify 的 LLM 路径**;模板格式齐全时用这里(快、稳、零成本),散文 / 半成品仍走 identify。

只产出结构化 model;把解析结果接进引擎注入 / 求值是 Gengyue 决策域,本模块不碰。
"""

from __future__ import annotations

import re

from .models import (
    CharacterBoundary,
    CharacterCard,
    CharacterData,
    Ending,
    PlayerCard,
    SettingCard,
    StoryBook,
    StoryEvent,
    WorldBook,
    WorldEntry,
)

# ---------------- 通用工具 ----------------

_FM_RE = re.compile(r"^\s*---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def _clean(s: str) -> str:
    """清洗一个值:去首尾空白 / 引号;整体是 `<...>` 占位的视为空。"""
    s = (s or "").strip().strip('"').strip("'").strip()
    if not s:
        return ""
    if s.startswith("<") and s.endswith(">") and "\n" not in s:
        return ""  # 未填的占位符
    return s


def _split_list(s: str) -> list[str]:
    """把 `a, b, c` / `a、b` / `a；b` 切成清洗后的非空列表,丢掉占位符。"""
    s = (s or "").strip().lstrip("[").rstrip("]")
    parts = re.split(r"[,，、;；]", s)
    out = []
    for p in parts:
        c = _clean(p)
        if c:
            out.append(c)
    return out


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """剥 YAML-lite frontmatter。返回 (frontmatter dict, 正文)。无 frontmatter 时 dict 为空。

    只处理本项目模板用到的形态:`key: 标量` / `key: [a, b]` / `key: "..."`,行尾 ` # 注释` 截掉。
    标量返回原始字符串(未 _clean,保留 `[a,b]` 原样供调用方按需 _split_list)。
    """
    # 剥 UTF-8 BOM(U+FEFF):Windows 编辑器 / Obsidian 存的卡常带 BOM,而 _FM_RE 的 `\s` 不吃它,
    # 不剥会导致 frontmatter 检测不到 → detect_kind 空 → parse_card 误判卡种。放函数最前,覆盖所有解析入口。
    text = text.lstrip("\ufeff")
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    block, body = m.group(1), m.group(2)
    fm: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = re.sub(r"\s+#.*$", "", val).strip()  # 截行尾注释
        if key:
            fm[key] = val
    return fm, body


class Section:
    """一个 markdown 标题段:级别 / 标题 / 正文行(不含标题行,含子段前的内容)。"""

    __slots__ = ("level", "title", "lines")

    def __init__(self, level: int, title: str, lines: list[str]):
        self.level = level
        self.title = title
        self.lines = lines

    @property
    def text(self) -> str:
        return clean_block(self.lines)


def split_sections(body: str) -> list[Section]:
    """按 markdown 标题切段。跳过 ``` 代码围栏内的内容(模板里 §1 教学示例不算真条目)。"""
    sections: list[Section] = []
    cur: Section | None = None
    in_fence = False
    for raw in body.splitlines():
        if raw.lstrip().startswith("```"):
            in_fence = not in_fence
            if cur is not None:
                cur.lines.append(raw)
            continue
        m = _HEADING_RE.match(raw) if not in_fence else None
        if m:
            cur = Section(len(m.group(1)), m.group(2).strip(), [])
            sections.append(cur)
        elif cur is not None:
            cur.lines.append(raw)
    return sections


def clean_block(lines: list[str]) -> str:
    """正文段 → 干净文本:丢 `>` 指引行、代码围栏、纯占位行,保留实义行。"""
    out: list[str] = []
    in_fence = False
    for line in lines:
        s = line.rstrip()
        if s.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if s.lstrip().startswith(">"):  # 模板指引,不入内容
            continue
        if not s.strip():
            if out and out[-1] != "":
                out.append("")
            continue
        if _clean(s) == "" and s.strip().startswith("<"):  # 纯占位行
            continue
        out.append(s)
    return "\n".join(out).strip()


def bullets(lines: list[str]) -> list[str]:
    """抽 `- ` / `* ` 列表项(清洗、丢占位与指引)。嵌套 / 续行不深究,够模板用。"""
    out: list[str] = []
    in_fence = False
    for line in lines:
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or s.startswith(">"):
            continue
        m = re.match(r"^[-*]\s+(.*)$", s)
        if not m:
            continue
        c = _clean(m.group(1))
        if c:
            out.append(c)
    return out


def labeled(lines: list[str]) -> dict[str, str]:
    """抽 `- **标签**:值` / `- 标签: 值` → {标签: 值}。标签去掉「(可选)」「(必填…)」等尾注。"""
    out: dict[str, str] = {}
    for item in _raw_bullets(lines):
        m = re.match(r"^\*\*(.+?)\*\*\s*[:：]\s*(.*)$", item) or re.match(r"^(.+?)\s*[:：]\s*(.*)$", item)
        if not m:
            continue
        label = re.sub(r"[(（].*?[)）]\s*$", "", m.group(1)).strip().strip("*").strip()
        val = _clean(m.group(2))
        if label and label not in out:
            out[label] = val
    return out


def _raw_bullets(lines: list[str]) -> list[str]:
    """像 bullets 但不清洗值(给 labeled 用,因为值可能为占位但标签仍要见到)。"""
    out: list[str] = []
    in_fence = False
    for line in lines:
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or s.startswith(">"):
            continue
        m = re.match(r"^[-*]\s+(.*)$", s)
        if m:
            out.append(m.group(1).strip())
    return out


def parse_md_table(lines: list[str]) -> list[tuple[str, str]]:
    """解析两列 markdown 表 `| a | b |` → [(a, b)]。跳过表头与分隔行、占位行。"""
    rows: list[tuple[str, str]] = []
    for line in lines:
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 2:
            continue
        a, b = cells[0], cells[1]
        if set(a) <= set("-: ") or a in ("speech_rules",) or "---" in a:  # 分隔行 / 表头
            continue
        bv = _clean(b)
        if a and bv:
            rows.append((_clean(a) or a, bv))
    return rows


def _title_first_token(heading: str) -> str:
    """`# <角色名> 角色卡` / `结局 A·名（id: x）` → 取主名(去后缀标记与括注)。"""
    h = heading.strip().strip("#").strip()
    h = re.sub(r"[（(].*?[)）]\s*$", "", h).strip()
    for suffix in ("角色卡", "玩家卡", "设定卡", "世界书", "事件卡", "故事书"):
        if h.endswith(suffix):
            h = h[: -len(suffix)].strip()
    return h.strip("《》 ·-—")


def _strip_node_marker(title: str) -> str:
    """剥事件 / 结局标题的前导标记:`E01 · 名` → `名`;`结局 A·名` → `名`。阶段标题不走这个(保留「阶段一·」)。"""
    t = re.sub(r"^E?H?\d+\s*[·•・.、]\s*", "", title.strip())
    t = re.sub(r"^结局\s*[0-9A-Za-z]+\s*[·•・.、]?\s*", "", t)
    return t


def _sec_number(title: str) -> str:
    """取标号段的序号:`1. 故事前提` → '1';`A. 叙事口径` → 'A';`0. 引擎摘要` → '0'。"""
    m = re.match(r"^([0-9]+|[A-Ea-e])\s*[\.、·]", title.strip())
    return m.group(1).upper() if m else ""


def _find(sections: list[Section], *needles: str, level: int | None = None) -> Section | None:
    """找标题含任一 needle 的段(可限定级别)。"""
    for s in sections:
        if level is not None and s.level != level:
            continue
        if any(n in s.title for n in needles):
            return s
    return None


# ---------------- 各卡解析器 ----------------


def parse_character(text: str) -> CharacterCard:
    """角色卡模板(主要 / 次要 NPC)→ CharacterCard。解析引擎摘要 + 轻量档 + 知识边界 + 版本人格。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)

    h1 = next((s for s in secs if s.level == 1), None)
    name = _clean(_title_first_token(h1.title)) if h1 else ""
    if not name:
        # h1 是占位 / 缺失:frontmatter tags 末项常是角色名,再不行用 ip
        tags = _split_list(fm.get("tags", ""))
        name = tags[-1] if tags else (_clean(fm.get("ip", "")) or "角色")

    data = CharacterData(name=name)
    data.tags = _split_list(fm.get("tags", ""))

    summary = _find(secs, "引擎摘要")
    if summary:
        lab = labeled(summary.lines)
        data.anchor = lab.get("一句话锚点", "")
        data.tension = lab.get("核心矛盾", "")
        data.look = lab.get("外貌锚点", "")
        if lab.get("召回关键词"):
            data.keys = _split_list(lab["召回关键词"])
        # speech_rules 表:每行 `子项 | 内容` → "子项:内容"
        data.speech_rules = [f"{k}:{v}" for k, v in parse_md_table(summary.lines)]
    if not data.keys:
        data.keys = _split_list(fm.get("召回关键词", ""))

    if (sec := _find(secs, "身份", "description")):
        data.description = sec.text
    if (sec := _find(secs, "性格", "personality")):
        data.personality = sec.text
    if (sec := _find(secs, "开场白", "first_mes")):
        data.first_mes = sec.text
    if not data.look and (sec := _find(secs, "外貌", "形象")):
        data.look = sec.text.split("\n", 1)[0]
    if (sec := _find(secs, "当前情境")):
        data.scenario = sec.text

    if (sec := _find(secs, "知识边界")):
        lab = labeled(sec.lines)
        for k, v in lab.items():
            if not v:
                continue
            if k.startswith("public"):
                data.known_public = _split_list(v) or [v]
            elif k.startswith("hidden"):
                data.known_hidden = _split_list(v) or [v]

    if (sec := _find(secs, "版本人格", "状态轴")):
        data.versions = bullets(sec.lines) or ([sec.text] if sec.text else [])

    return CharacterCard(data=data)


def parse_player(text: str) -> PlayerCard:
    """玩家卡模板 → PlayerCard。含新增 unknown(开局不知道)/ opening(开局场景锚点)。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)
    h1 = next((s for s in secs if s.level == 1), None)
    card = PlayerCard(name=_title_first_token(h1.title) if h1 else fm.get("ip", "玩家") or "玩家")

    def sec_text(*n: str) -> str:
        s = _find(secs, *n)
        return s.text if s else ""

    def sec_bullets(*n: str) -> list[str]:
        s = _find(secs, *n)
        return bullets(s.lines) if s else []

    card.role = sec_text("身份", "role")
    card.background = sec_text("背景", "background")
    card.goals = sec_bullets("目标", "goals")
    card.abilities = sec_bullets("能力", "abilities")
    card.constraints = sec_bullets("限制", "禁忌", "constraints")
    card.known_facts = sec_bullets("开局已知", "known_facts")
    card.unknown = sec_bullets("开局不知道", "unknown")
    opening = sec_bullets("开局场景", "时间锚点", "opening")
    card.opening = " / ".join(opening) if opening else sec_text("开局场景", "opening")
    return card


def parse_worldbook(text: str, name: str = "世界书") -> WorldBook:
    """世界书模板 → WorldBook。解析 §2 显式字段条目(`- 关键词:` / `- 内容:` …);跳过 §1 教学围栏。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)
    entries: list[WorldEntry] = []
    vis_map = {"public": "public", "hidden": "hidden", "character_only": "character_only"}
    for s in secs:
        lab = labeled(s.lines)
        kw = lab.get("关键词", "")
        content = lab.get("内容", "")
        if not (kw or content):  # 不是条目段(分组标题 / 教学段)
            continue
        keys = _split_list(kw) or [_title_first_token(s.title)[:20]]
        vis = vis_map.get(_clean(lab.get("可见性", "")).split()[0] if lab.get("可见性") else "", "public")
        src = _clean(lab.get("来源", "")) or "world"
        entry = WorldEntry(
            keys=keys,
            content=content,
            comment=s.title.strip(),
            source=src.split()[0] if src else "world",
            visibility=vis,  # type: ignore[arg-type]
        )
        pr = re.search(r"-?\d+", lab.get("优先级", "") or "")
        if pr:
            # NOTE(给 Gengyue):模板「优先级」约定「数大优先」,而 WorldEntry.priority 注释是「越小越优先」。
            # 这里只忠实落原始数值,方向对齐留引擎侧决定,不在解析层擅自反转。
            entry.priority = int(pr.group())
        entries.append(entry)
    book_name = _clean(fm.get("ip", "")) and f'{_clean(fm.get("ip", ""))} 世界书' or name
    h1 = next((s for s in secs if s.level == 1), None)
    if h1:
        book_name = _title_first_token(h1.title) and f"{_title_first_token(h1.title)} 世界书" or book_name
    return WorldBook(name=book_name, entries=entries)


def parse_settingcard(text: str) -> SettingCard:
    """设定卡模板(组织 / 地点 / …)→ SettingCard。引擎摘要 + 概览 + 其余段入 sections + 钩子。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)
    h1 = next((s for s in secs if s.level == 1), None)
    card = SettingCard(
        name=_title_first_token(h1.title) if h1 else _clean(fm.get("ip", "")) or "设定",
        category=_clean(fm.get("类别", "")),
        scene_type=_clean(fm.get("场景类型", "")),
        ip=_clean(fm.get("ip", "")),
        parent_world=_clean(fm.get("母本", "")),
        tier=_clean(fm.get("档位", "")) or "轻量",
        keys=_split_list(fm.get("召回关键词", "")),
    )
    if (summary := _find(secs, "引擎摘要")):
        lab = labeled(summary.lines)
        card.anchor = lab.get("一句话锚点", "")
        card.tone = lab.get("口吻 / 禁区", "") or lab.get("口吻", "")
        if lab.get("召回关键词"):
            card.keys = _split_list(lab["召回关键词"]) or card.keys
        layer = lab.get("知识分层", "")
        if layer:
            pub = re.search(r"public\s*[:：]\s*(.*?)(?:；|;|hidden|$)", layer, re.I)
            hid = re.search(r"hidden\s*[:：]\s*(.*)$", layer, re.I)
            if pub:
                card.public = _split_list(pub.group(1)) or ([_clean(pub.group(1))] if _clean(pub.group(1)) else [])
            if hid:
                card.hidden = _split_list(hid.group(1)) or ([_clean(hid.group(1))] if _clean(hid.group(1)) else [])

    for s in secs:
        num = _sec_number(s.title)
        if not num or num == "0":
            continue
        body_text = s.text
        if "钩子" in s.title:
            card.hooks = bullets(s.lines) or ([body_text] if body_text else [])
            continue
        if "概览" in s.title:
            card.overview = body_text
            continue
        if "召回关键词" in s.title:
            if not card.keys:
                card.keys = _split_list(body_text)
            continue
        if body_text:
            card.sections[re.sub(r"^[0-9A-Ea-e]\s*[\.、·]\s*", "", s.title).strip()] = body_text
    return card


def parse_event(text: str) -> StoryEvent:
    """隐藏事件卡模板 → StoryEvent(hidden 档)。frontmatter 门控 + §1 触发 + §2 事件本体。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)
    h1 = next((s for s in secs if s.level == 1), None)
    ev = StoryEvent(
        title=_title_first_token(h1.title) if h1 else "",
        hidden=_clean(fm.get("默认触发", "")) in ("", "否"),  # 隐藏事件默认不触发
        trigger_keywords=_split_list(fm.get("召回关键词", "")),
    )
    if _clean(fm.get("触发条件", "")):
        ev.unlock_conditions.append(_clean(fm.get("触发条件", "")))
    ev.affects_ending = "是" in _clean(fm.get("影响结局", ""))
    trig = _clean(fm.get("触发性", ""))
    if "可重复" in trig or "cooldown" in trig.lower():
        ev.once = False

    if (sec := _find(secs, "触发", "解锁")):
        lab = labeled(sec.lines)
        if lab.get("触发条件"):
            ev.unlock_conditions.append(lab["触发条件"])
        if lab.get("触发后置位"):
            ev.set_flags = _split_list(lab["触发后置位"]) or [lab["触发后置位"]]
        if "可重复" in (lab.get("触发性", "")) or "cooldown" in lab.get("触发性", "").lower():
            ev.once = False

    if (sec := _find(secs, "事件本体")):
        lab = labeled(sec.lines)
        ev.event_id = lab.get("event_id", "") or ev.event_id
        ev.summary = lab.get("摘要", "")
        if lab.get("相关地点"):
            ev.location = lab["相关地点"]
        if lab.get("相关角色"):
            ev.characters = _split_list(lab["相关角色"])
        if lab.get("玩家可玩的"):
            ev.choices_hint = _split_list(lab["玩家可玩的"]) or [lab["玩家可玩的"]]
        if lab.get("可能后果"):
            ev.consequences = _split_list(lab["可能后果"]) or [lab["可能后果"]]
        sev = re.search(r"[1-5]", lab.get("severity", "") or "")
        if sev:
            ev.severity = int(sev.group())
    # 去重 unlock_conditions
    ev.unlock_conditions = list(dict.fromkeys([c for c in ev.unlock_conditions if c]))
    return ev


def parse_storybook(text: str) -> StoryBook:
    """故事书模板 → StoryBook。§1 前提 / §3 时间线 / §4 主线 / §5 事件 / §6 结局 / §7 自由度 / §8 边界 / §E 待确认。"""
    fm, body = split_frontmatter(text)
    secs = split_sections(body)
    h1 = next((s for s in secs if s.level == 1), None)
    book = StoryBook(title=_title_first_token(h1.title) if h1 else _clean(fm.get("ip", "")) or "故事书")

    # 把标号段归组(顶层 1..9 / A..E),其 `###` 子段也收进来
    by_num: dict[str, list[Section]] = {}
    cur_num = ""
    for s in secs:
        if s.level <= 2 and _sec_number(s.title):
            cur_num = _sec_number(s.title)
            by_num.setdefault(cur_num, []).append(s)
        elif cur_num:
            by_num.setdefault(cur_num, []).append(s)

    # §1 前提(容忍:标签 bullet 或 `## 基本前提` 子段散文)
    if "1" in by_num:
        lab = labeled(by_num["1"][0].lines)
        sub = next((s.text for s in by_num["1"] if "基本前提" in s.title), "")
        book.premise = lab.get("基本前提", "") or sub or by_num["1"][0].text
        clock = re.search(r"-?\d+", lab.get("开局时钟 / 节奏", "") or lab.get("开局时钟", "") or "")
        if clock:
            book.clock_start = int(clock.group())
        if lab.get("开局时钟 / 节奏"):
            book.pacing = [lab["开局时钟 / 节奏"]]

    # §3 时间线
    if "3" in by_num:
        tl = bullets(by_num["3"][0].lines) or [l for l in by_num["3"][0].text.splitlines() if l.strip()]
        book.timeline = [t for t in tl if t]

    # §4 主线阶段:每个 `### 阶段…` → 一条;无 L3 子段则取 §4 bullets(容忍 `- **阶段…**` 列表)
    for s in by_num.get("4", []):
        if s.level >= 3:
            lab = labeled(s.lines)
            goal = lab.get("核心目标", "")
            stage = _title_first_token(s.title)
            book.main_plot.append(f"{stage}:{goal}" if goal else stage)
    if not book.main_plot and by_num.get("4"):
        book.main_plot = bullets(by_num["4"][0].lines)

    # §5 事件节点:每个 `### E01` / `## E00` · … → StoryEvent(容忍 L2/L3 事件标题;只取 E 开头的事件,跳过节标题)
    for s in by_num.get("5", []):
        m = re.match(r"^(E\d+|EH\d+)", s.title.strip())
        if s.level < 2 or not m:
            continue
        lab = labeled(s.lines)
        eid = m.group(1)
        ev = StoryEvent(
            event_id=eid,
            title=_title_first_token(_strip_node_marker(s.title)),
            summary=lab.get("摘要", ""),
            trigger_keywords=_split_list(lab.get("触发关键词", "")),
            reveal_after=_split_list(lab.get("前置 / 披露条件", "")) if "无" not in lab.get("前置 / 披露条件", "无") else [],
            location=lab.get("相关地点", ""),
            characters=_split_list(lab.get("相关角色", "")),
            choices_hint=_split_list(lab.get("行动选项提示", "")) or ([lab["行动选项提示"]] if lab.get("行动选项提示") else []),
            consequences=_split_list(lab.get("可能后果", "")) or ([lab["可能后果"]] if lab.get("可能后果") else []),
        )
        dc = re.search(r"-?\d+", lab.get("due_clock", "") or "")
        if dc:
            ev.due_clock = int(dc.group())
        ei = re.search(r"-?\d+", lab.get("escalate_after_idle", "") or "")
        if ei:
            ev.escalate_after_idle = int(ei.group())
        sev = re.search(r"[1-5]", lab.get("severity", "") or "")
        if sev:
            ev.severity = int(sev.group())
        book.events.append(ev)

    # §6 结局:每个 `### 结局 X·名（id: …）` → Ending
    for s in by_num.get("6", []):
        if s.level < 3:
            continue
        lab = labeled(s.lines)
        eid = ""
        m = re.search(r"id\s*[:：]\s*([^)）\s]+)", s.title)
        if m:
            eid = m.group(1)
        book.endings.append(
            Ending(
                ending_id=eid,
                title=_title_first_token(_strip_node_marker(s.title)),
                conditions=_split_list(lab.get("达成条件", "")) or ([lab["达成条件"]] if lab.get("达成条件") else []),
                summary=lab.get("结局内容", ""),
                required_facts=_split_list(lab.get("required_facts", "")),
                required_events=_split_list(lab.get("required_events", "")),
            )
        )

    # §7 自由度规则(容忍:跨 7.1–7.x 子段收 bullets)
    if "7" in by_num:
        fr: list[str] = []
        for s in by_num["7"]:
            fr += bullets(s.lines)
        book.freedom_rules = fr or bullets(by_num["7"][0].lines)

    # 角色信息边界:按标题定位「角色信息边界 / 角色边界」段(不限 §8 编号,防与「引擎适配」§8 撞号),
    # 读其下 `### 角色名` 直到下一个同级或更高级标题。每个 → CharacterBoundary。
    bidx = next((i for i, s in enumerate(secs) if "角色信息边界" in s.title or "角色边界" in s.title), -1)
    if bidx >= 0:
        blevel = secs[bidx].level
        for s in secs[bidx + 1:]:
            if s.level <= blevel:
                break
            lab = labeled(s.lines)
            cb = CharacterBoundary(character=_title_first_token(s.title))
            cb.public = _split_list(lab.get("public", "")) or ([lab["public"]] if lab.get("public") else [])
            cb.hidden = _split_list(lab.get("hidden", "")) or ([lab["hidden"]] if lab.get("hidden") else [])
            cb.hard_limits = _split_list(lab.get("hard_limits", "")) or ([lab["hard_limits"]] if lab.get("hard_limits") else [])
            if cb.public or cb.hidden or cb.hard_limits:
                book.character_boundaries.append(cb)

    # §E 待确认项
    if "E" in by_num:
        book.needs_confirm = bullets(by_num["E"][0].lines)

    return book


# 卡种 → 解析器映射(给前端 / 调用方按 frontmatter type 路由用)
PARSERS = {
    "角色卡": parse_character,
    "玩家卡": parse_player,
    "世界书": parse_worldbook,
    "设定卡": parse_settingcard,
    "事件卡": parse_event,
    "故事书": parse_storybook,
}


def detect_kind(text: str) -> str:
    """从 frontmatter `type` 推断卡种;无 frontmatter 返回 ''。"""
    fm, _ = split_frontmatter(text)
    return _clean(fm.get("type", ""))


def parse_card(text: str):
    """按 frontmatter type 自动路由到对应解析器。无法识别时抛 ValueError。"""
    kind = detect_kind(text)
    if kind not in PARSERS:
        raise ValueError(f"无法识别卡种(frontmatter type={kind!r});支持:{list(PARSERS)}")
    return PARSERS[kind](text)
