# -*- coding: utf-8 -*-
"""一次性:把 Obsidian《如我所书》翁法罗斯素材导入引擎卡库 (Postgres)。

- 世界书:自定义逐条解析 ## 标题 + 关键词/来源/可见性/内容 → 保住 hidden gating
  (引擎 story.py:642 认 visibility=="hidden" 直接跳过注入)。免 LLM。
- 角色卡:14 公开 + 4 导演隐藏卡,走 identify() LLM。隐藏卡 lib name 加「导演隐藏卡」后缀
  (作者可见、不与公开卡撞名、默认不进玩家 roster)。
- 故事书:identify_storybook() LLM。
- 设定集 / 城邦:本脚本不导入(hidden 散在正文引用块,需单独抽取 + 人工过目,防泄底)。

跑法:.venv/Scripts/python.exe _import_amphoreus.py <mode>
  mode: smoke(世界书+白厄1张) | world | chars | story | all
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
from dotenv import load_dotenv
load_dotenv(override=True)

from src import storage
from src.identify import identify, identify_storybook
from src.models import WorldBook, WorldEntry

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


def do_story():
    f = next(VAULT.glob("故事书*.md"))
    sb = identify_storybook(strip_fm(f.read_text(encoding="utf-8")))
    key = storage.save_library("stories", sb.title, sb.model_dump())
    print(f"[故事书] {sb.title!r}  events={len(sb.events)} endings={len(sb.endings)} "
          f"boundaries={len(sb.character_boundaries)} needs_confirm={len(sb.needs_confirm)}  lib={key}")
    if sb.needs_confirm:
        print("  needs_confirm(模型推断,待你确认):")
        for x in sb.needs_confirm[:8]:
            print(f"    · {x}")
    return sb


PUBLIC_14 = ["白厄", "盗火行者", "昔涟", "来古士", "阿格莱雅", "那刻夏", "海瑟音",
             "缇宝", "遐蝶", "赛飞儿", "风堇", "万敌", "凯妮斯", "刻律德菈"]

# 可玩主角(如我所书 line 32);白厄/昔涟/盗火行者=暗线、凯妮斯/来古士=NPC,不可玩。
PLAYABLE_9 = ["阿格莱雅", "缇宝", "万敌", "遐蝶", "那刻夏", "风堇", "赛飞儿", "海瑟音", "刻律德菈"]

ARCHETYPES = [
    {
        "name": "城邦小人物", "role": "翁法罗斯某城邦的普通居民(工匠/商贩/守卫/信徒等,开局可定)",
        "background": "不是黄金裔、没有金血,只是黑潮逼近、诸神陨落的乱世里努力活着的凡人。见证神话与战争,却无力左右大局。",
        "goals": ["在黑潮与诸神的夹缝里活下去", "守住自己在乎的人与日常"],
        "abilities": ["对市井与本城邦内情的熟悉", "凡人的机敏、韧性与不起眼"],
        "constraints": ["无金血、无神权,不能弑泰坦、行神权", "实力有限,硬刚半神/泰坦必死"],
        "known_facts": ["神话常识:泰坦创世、黑潮为灾、黄金裔逐火撑天", "本城邦的现状、传闻与人情"],
    },
    {
        "name": "外来旅人", "role": "流落翁法罗斯的外乡旅人(非破局的开拓者)",
        "background": "因缘际会进入翁法罗斯的外来者,对这个神话世界既陌生又好奇。不是注定破局的那一个,只是一个想看清、想离开、或想留下的旅人。",
        "goals": ["弄清自己为何身处此地", "在这座崩塌中的世界找到立足点"],
        "abilities": ["外来者视角,不被本地神话先入为主", "随身的旅人技艺(由玩家定)"],
        "constraints": ["不是破局的开拓者,无主角光环", "对本地真相所知有限,需亲历才知"],
        "known_facts": ["道听途说的神话常识", "自己从何而来(由玩家定)"],
    },
]


def do_players():
    """9 可玩黄金裔玩家卡(从角色卡派生)+ 2 模板。存进 players 库。"""
    from src.identify import identify_player
    existing = {p["name"] for p in storage.list_library("players")}
    cdir = VAULT / "角色卡"
    for name in PLAYABLE_9:
        if name in existing:
            print(f"  [跳过] {name} 已有玩家卡")
            continue
        try:
            pc = identify_player(strip_fm((cdir / f"{name} 角色卡.md").read_text(encoding="utf-8")))
            d = pc.model_dump()
            d["name"] = name  # 锚定名字
            key = storage.save_library("players", name, d)
            print(f"  [玩家卡] {name:5} role={d.get('role','')[:18]:18} goals={len(d.get('goals',[]))} "
                  f"abilities={len(d.get('abilities',[]))}  lib={key}")
        except Exception as e:
            print(f"  [失败] {name}: {str(e)[:80]}")
    for a in ARCHETYPES:
        print(f"  [模板]  {a['name']}  → lib={storage.save_library('players', a['name'], a)}")


def do_preset():
    """建首页故事预设:内嵌 完整世界书 + 14 张公开卡(不含导演隐藏卡)+ 故事书 + 封面。"""
    chars = {c["name"]: c["data"] for c in storage.list_library("characters")}
    worlds = {w["name"]: w["data"] for w in storage.list_library("worlds")}
    stories = {s["name"]: s["data"] for s in storage.list_library("stories")}
    cast = [chars[n] for n in PUBLIC_14 if n in chars]
    missing = [n for n in PUBLIC_14 if n not in chars]
    if missing:
        print("  ⚠ 缺角色:", missing)
    players = {p["name"]: p["data"] for p in storage.list_library("players")}
    want_play = PLAYABLE_9 + [a["name"] for a in ARCHETYPES]
    playables = [players[n] for n in want_play if n in players]
    miss_p = [n for n in want_play if n not in players]
    if miss_p:
        print("  ⚠ 缺玩家卡:", miss_p)
    payload = {
        "name": "如我所书 · 某一个轮回里确实发生过",
        "characters": cast,
        "playables": playables,
        "world": worlds.get("翁法罗斯世界书"),
        "story": stories.get("某一个轮回里确实发生过"),
        "player": None,
        "mode": "deep",
        "cover": "/covers/ruwoshushu.jpg",
        "synopsis": ("崩坏:星穹铁道·翁法罗斯篇。一段注定失败的逐火轮回——黄金裔逐个弑泰坦回收火种、"
                     "逐个牺牲,黑潮逼近,盗火行者的暗线如影随形。你从凯撒落幕、阿格莱雅起火前的交界进入,"
                     "走到这一轮的终结。如昔涟所书,这只是三千万次里普通的一次。"),
        "author": "太妃月 / Toffeemoon",
        "tags": ["崩铁", "翁法罗斯", "群像", "轮回", "逐火"],
    }
    key = storage.save_preset(payload["name"], payload)
    print(f"  preset 已存:{payload['name']!r}")
    print(f"    cast={len(cast)}/14  playables={len(playables)}  world={'✓' if payload['world'] else '✗'}  "
          f"story={'✓' if payload['story'] else '✗'}  cover={payload['cover']}  slug={key}")


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

print("\n=== 库内现状 ===")
for kind in ("worlds", "characters", "stories"):
    print(f"  {kind}: {[it['name'] for it in storage.list_library(kind)]}")
