"""一次性:把崩铁《账单在星海里回响》与原创武侠《米商之死》做成默认故事预设。
各配一张自包含 SVG 封面(不抓任何版权图)。"""
import base64, random, sys
sys.path.insert(0, ".")
from src import storage


def starfield_cover(seed=42):
    rng = random.Random(seed)
    stars = "".join(
        f'<circle cx="{rng.randint(0,640)}" cy="{rng.randint(0,360)}" r="{rng.choice([0.5,0.7,0.9,1.1,1.4,1.9])}" '
        f'fill="#fff" opacity="{rng.choice([0.35,0.5,0.7,0.9,1.0])}"/>'
        for _ in range(80)
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
        '<defs>'
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#0b1437"/><stop offset="0.55" stop-color="#27194e"/><stop offset="1" stop-color="#070a1b"/></linearGradient>'
        '<radialGradient id="neb" cx="0.72" cy="0.32" r="0.55"><stop offset="0" stop-color="#6a7bff" stop-opacity="0.40"/><stop offset="1" stop-color="#6a7bff" stop-opacity="0"/></radialGradient>'
        '<radialGradient id="neb2" cx="0.2" cy="0.8" r="0.5"><stop offset="0" stop-color="#c86bff" stop-opacity="0.22"/><stop offset="1" stop-color="#c86bff" stop-opacity="0"/></radialGradient>'
        '</defs><rect width="640" height="360" fill="url(#g)"/><rect width="640" height="360" fill="url(#neb)"/><rect width="640" height="360" fill="url(#neb2)"/>'
        + stars + '</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def inkwash_cover():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
        '<defs>'
        '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e4d6"/><stop offset="0.55" stop-color="#9aa195"/><stop offset="1" stop-color="#2b322c"/></linearGradient>'
        '<radialGradient id="sun" cx="0.7" cy="0.28" r="0.18"><stop offset="0" stop-color="#fff6e3" stop-opacity="0.9"/><stop offset="1" stop-color="#fff6e3" stop-opacity="0"/></radialGradient>'
        '</defs>'
        '<rect width="640" height="360" fill="url(#g)"/>'
        '<circle cx="448" cy="100" r="120" fill="url(#sun)"/>'
        '<path d="M0,250 L120,170 L240,235 L360,150 L500,225 L640,180 L640,360 L0,360 Z" fill="#586057" opacity="0.55"/>'
        '<path d="M0,295 L160,235 L320,290 L470,225 L640,285 L640,360 L0,360 Z" fill="#39413a" opacity="0.7"/>'
        '<path d="M0,335 L200,300 L420,335 L640,310 L640,360 L0,360 Z" fill="#222823" opacity="0.85"/>'
        '<g stroke="#eee9da" stroke-width="2" opacity="0.5" fill="none">'
        '<path d="M70,120 q40,-20 80,0 t80,0"/><path d="M120,150 q50,-18 100,2"/></g>'
        '</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def lib(k):
    return storage.list_library(k)


def find_char(name):
    return next((c["data"] for c in lib("characters") if c["data"]["data"]["name"] == name), None)


def find_world_kw(kw):
    return next((w["data"] for w in lib("worlds") if kw.lower() in (w["data"].get("name", "") + w["name"]).lower()), None)


def find_world_slug(slug):
    return next((w["data"] for w in lib("worlds") if w["name"] == slug), None)


def find_story(kw):
    return next((s["data"] for s in lib("stories") if kw in (s["data"].get("title") or "")), None)


def find_player(kw):
    return next((p["data"] for p in lib("players") if kw in (p["data"].get("name") or "")), None)


def merge_worlds(parts):
    parts = [w for w in parts if w]
    entries = []
    for wi, w in enumerate(parts):
        for ei, e in enumerate(w.get("entries", [])):
            e = dict(e)
            e.setdefault("entry_id", f"w{wi}-{ei}")
            entries.append(e)
    return {"name": "世界书合集", "entries": entries} if entries else None


def seed(preset):
    if not preset["characters"]:
        print("跳过(缺角色卡):", preset["name"]); return
    storage.save_preset(preset["name"], preset)
    print(f"seeded: {preset['name']} | 角色 {len(preset['characters'])} | "
          f"世界书条目 {len((preset.get('world') or {}).get('entries', []))} | "
          f"story={bool(preset.get('story'))} player={bool(preset.get('player'))} | cover {len(preset['cover'])} 字节")


# 崩铁
seed({
    "name": "账单在星海里回响", "mode": "standard",
    "characters": [c for c in (find_char("托帕"), find_char("大黑塔"), find_char("艾丝妲")) if c],
    "world": merge_worlds([find_world_kw("崩铁世界书"), find_world_kw("ipc"), find_world_kw("黑塔")]),
    "story": find_story("账单"), "player": find_player("开拓"),
    "cover": starfield_cover(),
    "synopsis": "黑塔空间站收到一笔诡异增殖的天价账单,IPC 的托帕带着还款方案上门。你是开拓者,"
                "要在债务、人情与真相之间,查清这笔账单为何在星海里不断回响。",
    "author": "太妃月", "tags": ["崩坏:星穹铁道", "同人", "悬疑", "谈判", "太空"],
})

# 原创武侠
seed({
    "name": "米商之死", "mode": "standard",
    "characters": [c for c in (find_char("阿砚"), find_char("陈捕头"), find_char("老周")) if c],
    "world": find_world_slug("世界书"),
    "story": find_story("米商"), "player": find_player("新捕快"),
    "cover": inkwash_cover(),
    "synopsis": "米商横死自家米铺,城里人心浮动。你是初来乍到的新捕快,要在嫌疑、人情与真相之间,"
                "勘验现场、盘问人证,揪出藏在米香背后的凶手。",
    "author": "太妃月", "tags": ["武侠", "悬疑", "探案", "原创"],
})
