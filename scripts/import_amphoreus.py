# -*- coding: utf-8 -*-
"""一次性:把 Obsidian《如我所书》翁法罗斯素材导入引擎卡库 (Postgres)。

- 世界书:自定义逐条解析 ## 标题 + 关键词/来源/可见性/内容 → 保住 hidden gating
  (引擎 story.py:642 认 visibility=="hidden" 直接跳过注入)。免 LLM。
- 角色卡:14 公开 + 4 导演隐藏卡,走 identify() LLM。隐藏卡 lib name 加「导演隐藏卡」后缀
  (作者可见、不与公开卡撞名、默认不进玩家 roster)。
- 故事书:identify_storybook() LLM。
- 玩家卡:读手写 玩家卡/*.md(玩家自己写的版本)。每张出两版:
  A 原卡(parse_player_md 直接解析,免 LLM)+ B 模拟丢卡(同文喂 identify_player,模拟玩家前端丢卡,过 LLM);
  模板(城邦小人物/外来旅人)只出 A。预设里两版各带 variant 标注、name 保持干净。
- 设定集 / 城邦:本脚本不导入(hidden 散在正文引用块,需单独抽取 + 人工过目,防泄底)。

跑法:.venv/Scripts/python.exe scripts/import_amphoreus.py <mode>
  mode: smoke(世界书+白厄1张) | world | chars | story | players | preset | players+preset | all | full(一把梭)
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # 从 scripts/ 跑也能 import src
from dotenv import load_dotenv
load_dotenv(override=True)

from src import storage
from src.identify import identify, identify_storybook
from src.models import (
    CharacterBoundary,
    Ending,
    PlayerCard,
    StoryBook,
    StoryEvent,
    WorldBook,
    WorldEntry,
)

VAULT = Path(r"C:\Users\admin\Documents\Obsidian Vault\40-Projects\AI互动故事\崩铁\如我所书")
_VIS = {"public": "public", "hidden": "hidden", "character_only": "character_only"}


def strip_fm(t: str) -> str:
    m = re.match(r"^\s*---\n.*?\n---\n", t, re.S)
    return t[m.end():] if m else t


def parse_worldbook(text: str, name: str) -> WorldBook:
    """逐条解析结构化世界书。每条:## 标题 + - 关键词/来源/可见性/内容。内容为该条最后字段,取到块尾。"""
    text = strip_fm(text)
    entries = []
    for b in re.split(r"\n(?=##\s)", text):
        mt = re.match(r"##\s+(.*)", b)
        if not mt:
            continue
        title = mt.group(1).strip()

        def field(key, multiline=False):
            if multiline:
                m = re.search(rf"^-\s*{key}\s*[:：]\s*([\s\S]+)$", b, re.M)
            else:
                m = re.search(rf"^-\s*{key}\s*[:：]\s*(.*)$", b, re.M)
            return m.group(1).strip() if m else ""

        content = field("内容", multiline=True)
        content = re.sub(r"\n+---\s*$", "", content).strip()  # 去块尾分隔线
        if not content:
            continue  # 纯分组标题/空段跳过
        keys = [k.strip() for k in re.split(r"[,，、/]", field("关键词")) if k.strip()] or [title[:20]]
        entries.append(WorldEntry(
            keys=keys, content=content, comment=title,
            source=field("来源") or "world",
            visibility=_VIS.get(field("可见性").lower(), "public"),
        ))
    return WorldBook(name=name, entries=entries)


def do_world(save=True) -> WorldBook:
    wb = parse_worldbook((VAULT / "翁法罗斯 世界书.md").read_text(encoding="utf-8"), "翁法罗斯世界书")
    pub = [e for e in wb.entries if e.visibility == "public"]
    hid = [e for e in wb.entries if e.visibility == "hidden"]
    print(f"[世界书] {len(wb.entries)} 条  public {len(pub)} / hidden {len(hid)}")
    print("  hidden 条目(引擎默认不注入,只在揭示后引入):")
    for e in hid:
        print(f"    - {e.comment}  [keys: {', '.join(e.keys[:4])}]")
    if save:
        print(f"  → 存库 worlds/{storage.save_library('worlds', wb.name, wb.model_dump())}")
    return wb


def _base_name(path: Path) -> str:
    return re.sub(r"\s*(角色卡|导演隐藏卡)\s*$", "", path.stem).strip()


def do_char(path: Path, hidden=False):
    card = identify(strip_fm(path.read_text(encoding="utf-8")))
    base = _base_name(path)  # 用文件名锚定显示名:防 identify 把真名/别名当名(那刻夏→阿那克萨戈拉斯)
    card.data.name = base
    libname = f"{base} 导演隐藏卡" if hidden else base
    key = storage.save_library("characters", libname, card.model_dump())
    print(f"  {'[导演隐藏]' if hidden else '[公开]  '} {path.stem:22} → {base!r}  "
          f"rules={len(card.data.speech_rules)} desc={len(card.data.description)}字  lib={key}")
    return card


def do_chars():
    cdir = VAULT / "角色卡"
    pub = sorted(p for p in cdir.glob("*.md") if "导演隐藏卡" not in p.name)
    hid = sorted(cdir.glob("*导演隐藏卡*.md"))
    print(f"[角色卡] 公开 {len(pub)} + 导演隐藏 {len(hid)}")
    fails = []
    for p, hidden in [(p, False) for p in pub] + [(p, True) for p in hid]:
        try:
            do_char(p, hidden=hidden)
        except Exception as e:
            fails.append(p.stem)
            print(f"  [失败] {p.stem}: {str(e)[:90]}")
    if fails:
        print(f"  ⚠ {len(fails)} 张失败,需重跑: {fails}")


# ============ 故事书:确定性解析(免 LLM)============
# 73KB 手写故事书远超 identify_storybook 的一次性摘要上限(8K token 输出截断)。
# 它本就是「喂引擎的」结构化文本:§5 事件逐条字段对齐 StoryEvent、§6.2 结局谓词对齐
# _check_ending_predicates、§7.5 边界对齐 hard_violation。这里逐条解析,免 LLM、无 token 上限、
# 忠实保留作者手写的谓词与边界(不让模型重猜)。

_SEV = {"极高": 5, "高": 4, "中": 3, "低": 2}


def _md_clean(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)            # 去加粗
    s = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", s)  # 去 wikilink
    s = re.sub(r"`([^`]*)`", r"\1", s)               # 去行内代码反引号
    return s.strip(" *·-—\t")


def _l1_sections(text: str) -> dict[str, str]:
    """按一级 `# ` 标题切顶层段(## 不算)。返回 {标题: 正文}。"""
    secs, cur, buf = {}, None, []
    for line in text.split("\n"):
        m = re.match(r"^#\s+(.+)", line)
        if m and not line.startswith("##"):
            if cur is not None:
                secs[cur] = "\n".join(buf)
            cur, buf = m.group(1).strip(), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        secs[cur] = "\n".join(buf)
    return secs


def _sec(secs: dict[str, str], prefix: str) -> str:
    return next((v for k, v in secs.items() if k.startswith(prefix)), "")


def _subsec(body: str, sub: str) -> str:
    for b in re.split(r"\n(?=##\s)", body):
        m = re.match(r"##\s+(.*)", b)
        if m and m.group(1).strip().startswith(sub):
            return re.sub(r"^##\s+.*\n?", "", b).strip()
    return ""


def _field(blk: str, label: str) -> str:
    """取事件块里一条顶层 `- 标签：值` 的值(值续到下一条顶层 `- `;含 ## 标题缩进子项不打断)。"""
    m = re.search(rf"^-\s*\*{{0,2}}{label}\*{{0,2}}\s*[:：]\s*([\s\S]*?)(?=\n-\s|\Z)", blk, re.M)
    return m.group(1).strip() if m else ""


def _split_items(s: str) -> list[str]:
    return [x for x in (p.strip() for p in re.split(r"[、,，/;；]", _md_clean(s))) if x]


def _parse_event(blk: str) -> StoryEvent | None:
    m = re.match(r"##\s+(E\d+)\s*[·.]\s*(.+)", blk)
    if not m:
        return None
    eid, title = m.group(1), _md_clean(re.split(r"[（(]", m.group(2))[0])

    summary = _md_clean(_field(blk, "摘要"))
    if not summary:
        q = re.search(r"^>\s*(.+)", blk, re.M)
        summary = _md_clean(q.group(1)) if q else title

    reveal = re.findall(r"E\d+", _field(blk, "披露条件"))
    reveal = [r for r in reveal if r != eid]
    trig_flags = re.findall(r"flag_[\w]+", _field(blk, "披露条件"))

    loc_m = re.search(r"地点[:：]\s*([^。\n]+)", blk)
    location = _md_clean(loc_m.group(1)) if loc_m else ""

    roles_raw = _field(blk, "相关角色")
    roles = [r for r in _split_items(re.split(r"[。;；]", roles_raw)[0])
             if r and "玩家" not in r and "（玩家" not in r]

    cons_src = roles_raw + " " + _field(blk, "后果")
    cons = re.findall(r"(?:火种_|flag_|fact_|item_|main_resolved|reached_ending)[\w]*", cons_src)
    cons = list(dict.fromkeys(cons))  # 去重保序

    sev_seg = re.search(r"severity[^。\n]*", blk)
    seg = sev_seg.group(0) if sev_seg else ""
    severity = next((v for k, v in _SEV.items() if k in seg), 3)

    hints = []
    cm = re.search(r"玩家可玩的\*{0,2}\s*[:：]\s*([\s\S]*?)(?=\n\s*-\s|\Z)", blk)
    if cm:
        hints = [h for h in (x.strip() for x in re.split(r"[;；]", _md_clean(cm.group(1)))) if h][:4]

    kws = _split_items(_field(blk, "触发关键词")) or _split_items(title)  # 无触发词的(E12/E13)回退用标题词
    return StoryEvent(
        event_id=eid, title=title, summary=summary,
        trigger_keywords=kws,
        trigger_flags=trig_flags, reveal_after=reveal,
        location=location, characters=roles,
        choices_hint=hints, consequences=cons,
        # 作者未给数值 due/escalate,只标了类型;留 None 由引擎按关键词/默认调度。
        due_clock=None, escalate_after_idle=None, severity=severity,
    )


# §6.2 单一结局「传火失败」的三副面孔(原作 OR 组 → 三条 ending,任一触发即收束)。
# required_facts 用子串匹配的关键词(引擎子串匹配 revealed 事实);不锁 required_events,
# 让结局可由「模型握手(main_resolved+reached_ending)」或「谓词(事实子串)」任一路径达成。
_ENDINGS = [
    Ending(ending_id="chuanhuo_fail_recreate", title="传火失败 · 再创世空转",
           summary="火种集齐(含白厄负世火种)触发再创世,世界看似得救却只是又一次重启——白厄燃尽、以记忆重造下一世,跳不出循环=失败。最贴每一次轮回。",
           conditions=["§6.2 组A:火种集齐 且 白厄负世火种 → 再创世空转重启"], tone="悲剧",
           required_events=[], required_facts=["火种集齐"]),
    Ending(ending_id="chuanhuo_fail_collapse", title="传火失败 · 功亏一篑",
           summary="最后一步崩盘——关键黄金裔在终局倒下/盗火行者夺走最后火种/黑潮破城,黄金裔暴毙、世界在残烬里归零。",
           conditions=["§6.2 组B:奥赫玛沦陷 或 存活黄金裔≤1"], tone="悲剧",
           required_events=[], required_facts=["奥赫玛沦陷"]),
    Ending(ending_id="chuanhuo_fail_lostfire", title="传火失败 · 火种收回失败",
           summary="逐火崩盘/关键火种被盗火行者夺走/黑潮破城致收集中断、十二火种集不齐→自动触发传火失败;玩家角色可仍活着见证,不必死。",
           conditions=["§6.2 组C:火种收回失败(自动触发,不依赖主角死)"], tone="悲剧",
           required_events=[], required_facts=["火种收回失败"]),
]

# §2 / §7.4 / §7.5 的知识边界与 OOC 硬约束,逐条转写(不经 LLM,防剧透漂移)。
_BOUNDARIES = [
    CharacterBoundary(character="白厄",
        public=["哀丽秘榭出身的少年黄金裔(真名卡厄斯兰那)、与昔涟同乡", "取负世火种、命途毁灭",
                "真诚坚毅、想为众人带来黎明的少年", "故乡被盗火行者所毁是他的执念与伤口"],
        hidden=["自己就是盗火行者(燃尽的白厄)", "永劫回归/模拟/书写者真相", "毁村者是未来的自己"],
        hard_limits=["前期不知自己=盗火行者、不看穿循环", "真身觉醒只由终局 E12「斩落面具见己脸」触发",
                     "不被玩家三言两语点醒成全知", "不可写成开局就阴郁全知"]),
    CharacterBoundary(character="昔涟",
        public=["流着金血、与白厄同乡的少女,温柔古灵、与白厄并肩",
                "爱莉希雅式俏皮甜软:自称「人家」、对白句末加♪、爱用感叹号、常提「浪漫」"],
        hidden=["她是这个世界的造物主/书写者(PhiLia093/德谬歌/迷迷同一存在)",
                "永劫回归由她引动、让白厄以仪式剑杀己注魂续轮回"],
        hard_limits=["知道 L4 全貌但绝不说破", "即便玩家逼问也只以温柔回避、意味深长的沉默接住",
                     "绝不由她口中说破模拟/轮回/我是书写者/盗火行者是你"]),
    CharacterBoundary(character="盗火行者",
        public=["黑斗篷+鎏金甲、躯干漆黑空洞、戴金面具的剑客", "随黑潮出没、专猎黄金裔、毁城焚林",
                "冷、快、几乎不说话、出手即走、不解释"],
        hidden=["真身=燃尽的白厄"],
        hard_limits=["前中期作纯粹强敌/天灾,绝不可被击杀、只能逼退或换代价",
                     "不剖白动机,偶有破碎悲怆低语而非反派宣言", "真身只在终局 E12 斩落面具揭示,绝不提前/外溢"]),
    CharacterBoundary(character="来古士",
        public=["化名「安提基色拉的来古士」的元老/公民大会「神礼观众」"],
        hidden=["真身=赞达尔分身、翁法罗斯实验的守门人(L4,城内角色不知)"],
        hard_limits=["玩家用越界/极度非常规力量(开挂、滥用法则、逼出「逃出循环」)时出面收束",
                     "终局保证再创世运行", "结局不可篡改:逐火不能真正成功/逃出循环"]),
]

_FREEDOM = [
    "玩家不必固定站队:拼命逐火/多救人多守城/边缘苟活/试图阻止某次牺牲(多半只能改样子、不能取消)。",
    "所有路线宏观结局相同(传火失败);差异在过程姿态、谁为谁牺牲、谁多活一会儿。",
    "牺牲是涌现的:NPC 按个性在逐火危机里自然为火种/同伴赴死,引擎不照脚本在固定事件钉死某人。",
    "死法要贴合该角色的死亡预言(预言不变,可换应验形式与场景,不锁具体画面)。",
    "前史锁死:开局时间点之前的一切(角色前史/第一次逐火/世界编年)不可改;早世代角色不出现在晚世代现场。",
    "硬约束·结局不可篡改:玩家无论多强/开挂/谈条件,都不能让逐火真正成功/逃出循环;极端越界时来古士出面收束。",
    "硬约束·知识禁区:除白厄(前期)、昔涟外,任何角色开口直谈模拟/轮回/盗火行者=白厄=hard_violation,世界内反制、不跳戏。",
]

_PACING = [
    "火种回收顺序可变:玩家先打哪位泰坦自由;但每收一枚火种/每段旅程都推进世界时钟、黑潮随之逼近。",
    "黑潮逼近(E10)随时间推进、随拖延加速;盗火行者(E09)在主线长时间无推进时主动登场。",
    "群像长局建议 deep 记忆;单轮 token 偏重。",
]

_NEEDS = [
    "故事书走确定性解析器导入(免 LLM):事件/时间线/主线/自由度自动解析;结局(§6.2 三面孔)与角色边界(§7.5)按原文转写,建议过目。",
    "结局谓词用引擎子串匹配:required_events=[E12] 作终局闸门防早触发,required_facts 为 §6.2 组A/B/C 关键词;实际触发仍可由模型 main_resolved 兜底。",
    "白厄人格切版(§8 v1→v2→v3)未编码为 persona_shifts,留作后续。",
]


def parse_amphoreus_storybook(text: str) -> StoryBook:
    text = strip_fm(text)
    secs = _l1_sections(text)
    title_m = re.search(r"^#\s+([^#\n]+)", text, re.M)
    title = _md_clean(title_m.group(1)) if title_m else "某一个轮回里确实发生过"

    premise = " ".join(_md_clean(p) for p in _subsec(_sec(secs, "1."), "基本前提").split("\n\n") if p.strip())
    timeline = [_md_clean(m.group(1)) for line in _sec(secs, "3.").split("\n")
                if (m := re.match(r"^\d+\.\s+(.+)", line))]
    main_plot = [_md_clean(m.group(1)) for line in _sec(secs, "4.").split("\n")
                 if (m := re.match(r"^-\s+(.+)", line))]

    body5 = _sec(secs, "5.")
    events = [e for blk in re.split(r"\n(?=##\s+E\d)", body5) if (e := _parse_event(blk))]

    return StoryBook(
        title=title, premise=premise, timeline=timeline, main_plot=main_plot,
        events=events, freedom_rules=_FREEDOM, endings=_ENDINGS,
        clock_start=0, pacing=_PACING, character_boundaries=_BOUNDARIES, needs_confirm=_NEEDS,
    )


def do_story():
    f = next(VAULT.glob("故事书*.md"))
    sb = parse_amphoreus_storybook(f.read_text(encoding="utf-8"))
    key = storage.save_library("stories", sb.title, sb.model_dump())
    print(f"[故事书·确定性解析] {sb.title!r}  events={len(sb.events)} endings={len(sb.endings)} "
          f"boundaries={len(sb.character_boundaries)} timeline={len(sb.timeline)} "
          f"main_plot={len(sb.main_plot)} freedom={len(sb.freedom_rules)}  lib={key}")
    print("  事件:", " ".join(f"{e.event_id}({e.severity})" for e in sb.events))
    miss = [e.event_id for e in sb.events if not e.summary or not e.trigger_keywords]
    if miss:
        print("  ⚠ 摘要/关键词缺失的事件:", miss)
    return sb


def do_story_llm():
    """旧路径:走 identify_storybook LLM 摘要(大故事书会截断失败,保留作小故事书用)。"""
    f = next(VAULT.glob("故事书*.md"))
    sb = identify_storybook(strip_fm(f.read_text(encoding="utf-8")))
    key = storage.save_library("stories", sb.title, sb.model_dump())
    print(f"[故事书·LLM] {sb.title!r}  events={len(sb.events)} endings={len(sb.endings)} "
          f"boundaries={len(sb.character_boundaries)} needs_confirm={len(sb.needs_confirm)}  lib={key}")
    return sb


PUBLIC_14 = ["白厄", "盗火行者", "昔涟", "来古士", "阿格莱雅", "那刻夏", "海瑟音",
             "缇宝", "遐蝶", "赛飞儿", "风堇", "万敌", "凯妮斯", "刻律德菈"]

# 可玩主角(如我所书 line 32);白厄/昔涟/盗火行者=暗线、凯妮斯/来古士=NPC,不可玩。
PLAYABLE_9 = ["阿格莱雅", "缇宝", "万敌", "遐蝶", "那刻夏", "风堇", "赛飞儿", "海瑟音", "刻律德菈"]

PLAYER_TEMPLATES = ["城邦小人物", "外来旅人"]   # 通用模板:只出原卡(没有"模拟丢卡"对照)
# 手写玩家卡的 ## 段落,英文字段名写在括号里;只认这些键。
_PLAYER_FIELDS = {"role", "background", "goals", "abilities", "constraints", "known_facts", "unknown", "opening"}


def _player_base(path: Path) -> str:
    return re.sub(r"\s*玩家卡\s*$", "", path.stem).strip()


def parse_player_md(text: str, name: str) -> PlayerCard:
    """逐段解析手写玩家卡(免 LLM,= 版本 A 原卡)。
    ## 标题里括号内的英文键定段;role/background 取散文,其余取 - 列表项。
    PlayerCard schema 外的「开局不知道(unknown)」「开局锚点(opening)」分别折进
    constraints / known_facts(带 [前缀]),不丢这两段防全知/定位信息。"""
    text = strip_fm(text)
    sec: dict[str, list[str]] = {}
    cur = None
    for line in text.split("\n"):
        h = re.match(r"^##\s+(.*)", line)
        if h:
            m = re.search(r"[（(]\s*([a-zA-Z_]+)", h.group(1))
            cur = m.group(1).lower() if m and m.group(1).lower() in _PLAYER_FIELDS else None
            if cur:
                sec.setdefault(cur, [])
        elif cur is not None:
            sec[cur].append(line)

    def items(key):
        out = []
        for l in sec.get(key, []):
            l = l.strip()
            if l and not l.startswith(">"):
                out.append(re.sub(r"^[-*]\s*", "", l).strip())
        return [x for x in out if x]

    constraints = items("constraints") + [f"[开局不知道] {x}" for x in items("unknown")]
    known = items("known_facts") + [f"[开局锚点] {x}" for x in items("opening")]
    return PlayerCard(
        name=name, role=" ".join(items("role")), background=" ".join(items("background")),
        goals=items("goals"), abilities=items("abilities"),
        constraints=constraints, known_facts=known,
    )


def do_players():
    """玩家卡两套,都来自手写 玩家卡/*.md(改后的「玩家自己写的版本」),供两个预设各用一套:
    - A 原卡(免 LLM):全 11 张直接解析,库 key「X 原卡」→ 喂「未过LLM」预设。
    - B 模拟丢卡(过 LLM):全 11 张同文喂 identify_player(= 玩家前端丢卡的真实流程),库 key「X 模拟丢卡」
      → 喂「过LLM」预设。能暴露引擎管线吃不吃得下「开局不知道」这类 schema 外字段。
    两套 name 都保持干净(=角色名),区分落在库 key 与预设名,不污染叙事/选人页同名删除。"""
    from src.identify import identify_player
    pdir = VAULT / "玩家卡"
    all_names = PLAYABLE_9 + PLAYER_TEMPLATES  # 11 名(9 黄金裔 + 2 模板),两套对齐
    print("[玩家卡 A·原卡] 全 11 张直接解析(免 LLM):")
    for f in sorted(pdir.glob("*.md")):
        base = _player_base(f)
        c = parse_player_md(f.read_text(encoding="utf-8"), base)
        key = storage.save_library("players", f"{base} 原卡", c.model_dump())
        print(f"  [原卡] {base:6} role={c.role[:12]:12} goals={len(c.goals)} abil={len(c.abilities)} "
              f"cons={len(c.constraints)} known={len(c.known_facts)}  lib={key}")
    print("[玩家卡 B·模拟丢卡] 全 11 张走 identify_player(过 LLM):")
    for base in all_names:
        f = pdir / f"{base} 玩家卡.md"
        try:
            pc = identify_player(strip_fm(f.read_text(encoding="utf-8")))
            d = pc.model_dump()
            d["name"] = base  # 锚定干净名字(防 identify 把"X(玩家卡)"当名)
            key = storage.save_library("players", f"{base} 模拟丢卡", d)
            print(f"  [丢卡] {base:6} role={d.get('role','')[:12]:12} goals={len(d.get('goals',[]))} "
                  f"abil={len(d.get('abilities',[]))} cons={len(d.get('constraints',[]))} "
                  f"known={len(d.get('known_facts',[]))}  lib={key}")
        except Exception as e:
            print(f"  [失败] {base}: {str(e)[:80]}")


_SYNOPSIS = ("崩坏:星穹铁道·翁法罗斯篇。一段注定失败的逐火轮回——黄金裔逐个弑泰坦回收火种、"
             "逐个牺牲,黑潮逼近,盗火行者的暗线如影随形。你从凯撒落幕、阿格莱雅起火前的交界进入,"
             "走到这一轮的终结。如昔涟所书,这只是三千万次里普通的一次。")

# 两个预设,世界/角色/故事/封面全相同,只差玩家卡来源(整套过 / 不过引擎 LLM)。
_PRESETS = [
    ("如我所书 · 原卡(玩家直写·未过LLM)", "原卡", "玩家卡 = 手写卡直采,未过引擎 LLM。"),
    ("如我所书 · 模拟丢卡(过引擎LLM)", "模拟丢卡", "玩家卡 = 手写卡丢进引擎 identify_player 后的产物。"),
]
_OLD_PRESET = "如我所书 · 某一个轮回里确实发生过"  # 旧合并版(20 张混一页),建新两版时删掉


def do_preset():
    """建两个首页预设:除玩家卡来源外完全相同——一个整套「原卡(未过LLM)」、一个整套「模拟丢卡(过LLM)」。
    各内嵌 完整世界书 + 14 张公开卡 + 故事书 + 封面 + 11 张对应来源的玩家卡。"""
    chars = {c["name"]: c["data"] for c in storage.list_library("characters")}
    worlds = {w["name"]: w["data"] for w in storage.list_library("worlds")}
    stories = {s["name"]: s["data"] for s in storage.list_library("stories")}
    players = {p["name"]: p["data"] for p in storage.list_library("players")}
    cast = [chars[n] for n in PUBLIC_14 if n in chars]
    missing = [n for n in PUBLIC_14 if n not in chars]
    if missing:
        print("  ⚠ 缺角色:", missing)
    world = worlds.get("翁法罗斯世界书")
    story = stories.get("某一个轮回里确实发生过")
    roster = PLAYABLE_9 + PLAYER_TEMPLATES  # 11 名,两套对齐

    def pick(suffix):
        out, miss = [], []
        for n in roster:
            d = players.get(storage.slug(f"{n} {suffix}"))
            (out.append(d) if d else miss.append(n))
        if miss:
            print(f"  ⚠ 缺玩家卡[{suffix}]:", miss)
        return out

    for name, suffix, note in _PRESETS:
        payload = {
            "name": name,
            "characters": cast,
            "playables": pick(suffix),
            "world": world,
            "story": story,
            "player": None,
            "mode": "deep",
            "cover": "/covers/ruwoshushu.jpg",
            "synopsis": _SYNOPSIS + "  【" + note + "】",
            "author": "太妃月 / Toffeemoon",
            "tags": ["崩铁", "翁法罗斯", "群像", "轮回", "逐火"],
        }
        key = storage.save_preset(name, payload)
        print(f"  preset 已存:{name!r}  playables={len(payload['playables'])}/11  "
              f"cast={len(cast)}/14  world={'✓' if world else '✗'} story={'✓' if story else '✗'}  slug={key}")

    if storage.delete_preset(_OLD_PRESET):
        print(f"  已删旧合并版预设:{_OLD_PRESET!r}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "smoke"
    if mode == "smoke":
        do_world()
        print("[smoke 角色卡] 白厄 公开卡:")
        do_char(VAULT / "角色卡" / "白厄 角色卡.md", hidden=False)
    elif mode == "world":
        do_world()
    elif mode == "chars":
        do_chars()
    elif mode == "story":
        do_story()
    elif mode == "story-llm":
        do_story_llm()
    elif mode == "players":
        do_players()
    elif mode == "preset":
        do_preset()
    elif mode == "players+preset":
        do_players()
        do_preset()
    elif mode == "retry":
        for fn in ("海瑟音 角色卡", "阿格莱雅 角色卡", "那刻夏 角色卡"):
            try:
                do_char(VAULT / "角色卡" / f"{fn}.md", hidden=False)
            except Exception as e:
                print(f"  [失败] {fn}: {str(e)[:90]}")
        if storage.delete_library("characters", "阿那克萨戈拉斯"):
            print("  已删错名遗留 characters/阿那克萨戈拉斯")
        do_story()
    elif mode == "all":
        do_world()
        do_chars()
        do_story()
    elif mode == "full":   # 一把梭:世界书 + 角色卡 + 故事书 + 玩家卡(A/B) + 预设
        do_world()
        do_chars()
        do_story()
        do_players()
        do_preset()

    print("\n=== 库内现状 ===")
    for kind in ("worlds", "characters", "stories", "players"):
        print(f"  {kind}: {[it['name'] for it in storage.list_library(kind)]}")
