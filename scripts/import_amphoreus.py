# -*- coding: utf-8 -*-
"""一次性:把 Obsidian《如我所书》翁法罗斯素材导入引擎卡库 (Postgres)。

- 世界书:自定义逐条解析 ## 标题 + 关键词/来源/可见性/内容 → 保住 hidden gating
  (引擎 story.py 认 visibility=="hidden" 跳过注入)。免 LLM。
- 角色卡:14 张公开卡,走 parse_character() 确定性解析(免 LLM)。知识边界(hidden)/版本人格
  只进 known_hidden/versions、不进会注入的 description(防折叠后 L4 泄漏);L4 注入+门控靠故事书 _BOUNDARIES。
  (原 4 张导演隐藏卡已折叠进公开卡 hidden + 归档 90-Archive,不再单独导入。)
- 故事书:parse_amphoreus_storybook() 确定性解析(免 LLM,大故事书不截断)。
- 演出卡:读手写 演出卡/*.md,parse_player_md 确定性解析(免 LLM),库 key「X 原卡」。
  保留开局不知道(unknown)/开局锚点(opening);不走 identify_player LLM(它会丢 unknown)。
- 设定集 / 城邦:本脚本不导入(hidden 散在正文引用块,需单独抽取 + 人工过目,防泄底)。

跑法:.venv/Scripts/python.exe scripts/import_amphoreus.py <mode>
  mode: smoke | world | chars | story | players | preset | players+preset | all | full(一把梭)
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
    CharacterCard,
    CharacterData,
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


# ============ 角色卡:确定性解析(免 LLM)============
# 角色卡走模板段确定性解析(2026-06-06,yufei 拍板),不再走 identify LLM。
# 关键:知识边界(hidden) 只进 known_hidden、版本人格只进 versions,绝不进会注入的 description——
# 折叠后公开卡正文含 L4(白厄=盗火行者 等),LLM 全文解析会把 L4 卷进 description 剧透;
# 确定性路由按段映射,L4 隔离在 known_hidden/versions(引擎默认不注入),
# 注入+门控仍靠故事书 _BOUNDARIES(已硬编码 4 主角)。

def _fm_field(t: str, key: str) -> str:
    m = re.match(r"^\s*---\n(.*?)\n---\n", t, re.S)
    if not m:
        return ""
    mm = re.search(rf"^{key}\s*[:：]\s*(.+)$", m.group(1), re.M)
    return mm.group(1).strip() if mm else ""


def _char_sections(body: str) -> list[tuple[str, str]]:
    out = []
    for blk in re.split(r"\n(?=##\s)", body):
        m = re.match(r"##\s+(.+)", blk)
        if m:
            out.append((m.group(1).strip(), blk[m.end():].strip()))
    return out


def _char_label(content: str, label: str) -> str:
    m = re.search(rf"-\s*\*\*{re.escape(label)}\*\*(?:[（(][^）)]*[）)])?\s*[:：]\s*(.+)", content)
    return m.group(1).strip() if m else ""


def _char_bullets(content: str) -> list[str]:
    out = []
    for line in content.split("\n"):
        s = line.strip()
        if s.startswith("- ") and not s.startswith("- ---"):
            out.append(re.sub(r"^-\s*", "", s).strip())
    return out


def _char_table_rules(content: str) -> list[str]:
    """引擎摘要里的 speech_rules markdown 表 → ['自称:..', '称呼玩家:..', ..]"""
    out = []
    for line in content.split("\n"):
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        k, v = cells[0], cells[1]
        if not k or k.lower() == "speech_rules" or set(k) <= set("-: "):
            continue
        if v:
            out.append(f"{k}:{v}")
    return out


def _char_keys(s: str) -> list[str]:
    return [k.strip() for k in re.split(r"[,，、/]", s) if k.strip()]


# 这些段各有去处,不进 description;其余公开叙事段(身份/外貌/核心事迹/结局/神谕/人际关系/前史…)→ description
_CHAR_SKIP = ("0. 引擎摘要", "引擎摘要", "性格", "开场白", "知识边界",
              "版本人格", "状态轴", "召回关键词", "说话规则", "说话习惯", "不可 OOC", "不可OOC")


def parse_character(text: str, name: str = "") -> CharacterCard:
    """确定性解析角色卡模板 → CharacterCard(免 LLM,L4 不泄进 description)。"""
    body = strip_fm(text)
    secs = _char_sections(body)
    get = lambda pred: next((c for t, c in secs if pred(t)), "")

    summary = get(lambda t: "引擎摘要" in t)
    rules = _char_table_rules(summary)
    rules += _char_bullets(get(lambda t: t.startswith("说话规则")))
    rules += [f"[不可OOC] {b}" for b in _char_bullets(get(lambda t: t.startswith("不可 OOC") or t.startswith("不可OOC")))]

    keys = _char_keys(_fm_field(text, "召回关键词").strip("[] "))
    if not keys:
        keys = _char_keys(_char_label(summary, "召回关键词"))
    if not keys:
        keys = _char_keys(get(lambda t: t == "召回关键词"))

    kb = get(lambda t: t.startswith("知识边界"))
    pub, hid = [], []
    for b in _char_bullets(kb):
        core = re.sub(r"^\*\*[^*]*\*\*\s*[:：]?\s*", "", b).strip()
        head = b[:16]
        (hid if "hidden" in head else pub).append(core)

    desc = "\n\n".join(f"【{t}】\n{c.strip()}" for t, c in secs
                       if c.strip() and not any(t.startswith(p) for p in _CHAR_SKIP))

    card = CharacterCard(data=CharacterData(
        name=name,
        description=desc,
        personality=get(lambda t: t.startswith("性格")),
        first_mes=get(lambda t: t.startswith("开场白")),
        mes_example=get(lambda t: t.startswith("说话习惯")),
        speech_rules=rules,
        anchor=_char_label(summary, "一句话锚点"),
        tension=_char_label(summary, "核心矛盾"),
        look=_char_label(summary, "外貌锚点"),
        keys=keys,
        versions=_char_bullets(get(lambda t: t.startswith("版本人格") or "状态轴" in t)),
        known_public=pub,
        known_hidden=hid,
        tags=_char_keys(_fm_field(text, "tags").strip("[] ")),
    ))
    return card


def do_char(path: Path, hidden=False):
    card = parse_character(path.read_text(encoding="utf-8"), _base_name(path))
    base = card.data.name
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
    CharacterBoundary(character="赛飞儿",
        public=["出身盗贼之都多洛斯的贼星(真名赛法利娅/Cifera)、捷足的旅人",
                "取「诡计」火种成诡计半神,神权=谎言只要世人相信便可弄假成真",
                "油滑爱财、用谎言行善的猫属性侠盗;搭档贼灵巴特鲁斯;曾被阿格莱雅在市集收留"],
        hidden=["巴特鲁斯其实是她当年击败后以谎保下、化形存活的诡计泰坦扎格列斯本体(仅她知此秘)",
                "她探知黎明机器只能再维持三百年便熄灭,织出『黎明机器将永远照拂圣城』的弥天大谎为奥赫玛续命",
                "因怕被阿格莱雅识破谎言而自我放逐千年(误会至死未解)"],
        hard_limits=["巴特鲁斯=扎格列斯本体、黎明机器三百年大谎 两个秘密不主动说破,问到也只按披露节奏松口",
                     "油滑玩世只是壳,底色是为众人牺牲的侠义;谎言是工具与神权,非恶意",
                     "不预知自己结局(终局受白厄之托护负世火种、拖盗火行者而被刺死)"]),
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
    # 2026-06-06 切换到通用确定性解析器 src.parsers.parse_storybook:
    # 故事书已补 §6.4 结局条目(3 结局 + required_facts 谓词) + 角色信息边界段(5 角色),
    # 通用 parser 即可解析出 14 事件 / 3 结局 / 5 边界,弃本地硬编码 parse_amphoreus_storybook(见文末,留作参考)。
    from src.parsers import parse_storybook
    f = next(VAULT.glob("故事书*.md"))
    sb = parse_storybook(f.read_text(encoding="utf-8"))
    key = storage.save_library("stories", sb.title, sb.model_dump())
    print(f"[故事书·通用确定性解析] {sb.title!r}  events={len(sb.events)} endings={len(sb.endings)} "
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
    return re.sub(r"\s*演出卡\s*$", "", path.stem).strip()


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
    """演出卡(原卡 · 确定性解析,免 LLM):全 11 张手写演出卡按模板段直接解析,库 key「X 原卡」→ 喂「如我所书」预设。
    保留「开局不知道(unknown)」「开局锚点(opening)」(折进 constraints/known_facts 带前缀);
    identify_player LLM 路径会丢掉 unknown 这类 schema 外字段,故正式上线不用 LLM 重解析。name 保持干净(=角色名)。"""
    pdir = VAULT / "演出卡"
    print("[演出卡·原卡] 全 11 张确定性解析(免 LLM):")
    for f in sorted(pdir.glob("*.md")):
        base = _player_base(f)
        c = parse_player_md(f.read_text(encoding="utf-8"), base)
        key = storage.save_library("players", f"{base} 原卡", c.model_dump())
        print(f"  [原卡] {base:6} role={c.role[:12]:12} goals={len(c.goals)} abil={len(c.abilities)} "
              f"cons={len(c.constraints)} known={len(c.known_facts)}  lib={key}")


_SYNOPSIS = ("崩坏:星穹铁道·翁法罗斯篇。一段注定失败的逐火轮回——黄金裔逐个弑泰坦回收火种、"
             "逐个牺牲,黑潮逼近,盗火行者的暗线如影随形。你从凯撒落幕、阿格莱雅起火前的交界进入,"
             "走到这一轮的终结。如昔涟所书,这只是三千万次里普通的一次。")

# 单个首页预设「如我所书」:完整世界书 + 14 张公开角色卡(确定性解析)+ 故事书 + 封面 + 11 张演出卡(原卡)。
_PRESETS = [
    ("如我所书", "原卡", "演出卡 = 手写卡确定性解析(保留开局已知 / 开局不知道边界)。"),
]
# 历次旧预设(建新版时清掉,完成「替换」):旧两变体 + 旧合并版。
_OLD_PRESETS = [
    "如我所书 · 原卡(玩家直写·未过LLM)",
    "如我所书 · 模拟丢卡(过引擎LLM)",
    "如我所书 · 某一个轮回里确实发生过",
]


def do_settings():
    """7 城邦设定卡走 src.parsers.parse_settingcard 确定性解析,存库 kind=settings。
    设定集(顶层世界母本)不导——不合设定卡模板(无引擎摘要/知识分层),其内容已在世界书 + 各城邦卡。"""
    from src.parsers import parse_settingcard
    cdir = VAULT / "城邦"
    cards = []
    for f in sorted(cdir.glob("*.md")):
        sc = parse_settingcard(f.read_text(encoding="utf-8"))
        key = storage.save_library("settings", sc.name, sc.model_dump())
        cards.append(sc.model_dump())
        print(f"  [设定卡] {sc.name[:18]:18} 类别={sc.category} 场景={sc.scene_type} "
              f"public={len(sc.public)} hidden={len(sc.hidden)} sections={len(sc.sections)} hooks={len(sc.hooks)}  lib={key}")
    print(f"  共 {len(cards)} 张城邦设定卡入库(设定集不导)")
    return cards


def _settings_to_world_entries(setting_cards: list[dict]) -> list[dict]:
    """把设定卡 public/hidden 摊平成世界书条目(复用引擎现成的关键词注入 + hidden 门控,引擎不必改)。
    每卡:1 条 public(概览+public 分层,按地点/关键词召回)+ 1 条 hidden(元真相,门控不说破)。"""
    out = []
    for sc in setting_cards:
        keys = sc.get("keys") or [sc.get("name", "")[:12]]
        pub = "；".join(sc.get("public") or [])
        content_pub = ((sc.get("overview") or "").strip() + (("　知识分层(public)：" + pub) if pub else "")).strip()
        if content_pub:
            out.append(WorldEntry(keys=keys, content=content_pub, comment=f"{sc['name']}·设定(public)",
                                  source="location", visibility="public", priority=50).model_dump())
        hid = "；".join(sc.get("hidden") or [])
        if hid:
            out.append(WorldEntry(keys=keys, content=hid, comment=f"{sc['name']}·设定(hidden·元真相)",
                                  source="location", visibility="hidden", priority=50).model_dump())
    return out


def do_preset():
    """建单个首页预设「如我所书」:完整世界书(并入 7 城邦设定卡摊平条目)+ 14 张公开角色卡 + 故事书 + 封面 + 11 张演出卡(原卡)。"""
    chars = {c["name"]: c["data"] for c in storage.list_library("characters")}
    worlds = {w["name"]: w["data"] for w in storage.list_library("worlds")}
    stories = {s["name"]: s["data"] for s in storage.list_library("stories")}
    players = {p["name"]: p["data"] for p in storage.list_library("players")}
    setting_cards = [s["data"] for s in storage.list_library("settings")]
    cast = [chars[n] for n in PUBLIC_14 if n in chars]
    missing = [n for n in PUBLIC_14 if n not in chars]
    if missing:
        print("  ⚠ 缺角色:", missing)
    world = worlds.get("翁法罗斯世界书")
    story = stories.get("某一个轮回里确实发生过")
    # 设定卡摊平成世界书条目并入 world(只进预设副本、不回写 world 库,re-run 幂等);引擎据此按地点召回 + hidden 门控注入,无需改引擎核心
    world_for_preset = world
    if world and setting_cards:
        extra = _settings_to_world_entries(setting_cards)
        world_for_preset = {**world, "entries": list(world.get("entries", [])) + extra}
        print(f"  设定卡摊平:+{len(extra)} 条并入预设 world(原 {len(world.get('entries', []))} 条 → {len(world_for_preset['entries'])} 条)")
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
            "world": world_for_preset,
            "settings": setting_cards,
            "story": story,
            "player": None,
            "mode": "deep",
            "cover": "/covers/ruwoshushu.jpg",
            "synopsis": _SYNOPSIS,
            "author": "太妃月 / Toffeemoon",
            "tags": ["崩铁", "翁法罗斯", "群像", "轮回", "逐火"],
        }
        key = storage.save_preset(name, payload)
        print(f"  preset 已存:{name!r}  playables={len(payload['playables'])}/11  "
              f"cast={len(cast)}/14  world={'✓' if world else '✗'} story={'✓' if story else '✗'}  slug={key}")

    # 清旧 = 完成「替换」:删历次旧预设 + 折叠归档后残留的 4 张「X 导演隐藏卡」库条目。
    new_slug = storage.slug("如我所书")
    for old in _OLD_PRESETS:
        if storage.delete_preset(old):
            print(f"  已删旧预设:{old!r}")
    for p in storage.list_presets():
        if p["name"].startswith("如我所书-") and p["name"] != new_slug:
            storage.delete_preset(p["name"])
            print(f"  已删残留旧预设 slug:{p['name']!r}")
    for n in ("白厄", "昔涟", "盗火行者", "来古士"):
        if storage.delete_library("characters", f"{n} 导演隐藏卡"):
            print(f"  已删折叠归档残留库条目:characters/{n} 导演隐藏卡")


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
    elif mode == "settings":
        do_settings()
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
    elif mode == "full":   # 一把梭:世界书 + 角色卡 + 故事书 + 演出卡 + 城邦设定卡 + 预设
        do_world()
        do_chars()
        do_story()
        do_players()
        do_settings()
        do_preset()

    print("\n=== 库内现状 ===")
    for kind in ("worlds", "characters", "stories", "players", "settings"):
        print(f"  {kind}: {[it['name'] for it in storage.list_library(kind)]}")
