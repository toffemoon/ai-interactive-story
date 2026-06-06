# -*- coding: utf-8 -*-
"""通用故事导入器:扫一个 Obsidian 故事文件夹 → 确定性解析 → 入库 + 拼首页预设。

跟 import_amphoreus.py 的区别:那个是写死翁法罗斯结构的一次性脚本;**这个不写死任何故事**,
靠两条约定把「一套卡组」自动装配成一个可玩的故事预设:

  约定 1(卡种路由):每个 .md 的 frontmatter `type` 决定它是什么卡,路由到 src.parsers 的对应解析器。
    角色卡 → characters(cast,AI 扮演的 NPC)
    演出卡 / 玩家卡 → players(playables,玩家可选的主角)
    世界书 → world          设定卡 → settings(并摊平成世界书条目,复用引擎关键词注入+hidden 门控)
    故事书 → story          事件卡 → 暂不入库(引擎从故事书读事件;独立隐藏事件卡引擎待补)
    索引 / 无 type → 跳过(但顺手抓预设元数据:名字 / 简介 / 作者 / tags)

  约定 2(预设装配):characters=全部角色卡、playables=全部演出卡、world=唯一世界书、story=唯一故事书,
    设定卡摊平并入 world 副本。元数据从索引文件 frontmatter/首段引用块取,缺了有兜底。

确定性、零 LLM、零 token;save_* 全是 upsert,可重复跑(幂等)。

时钟归一化:若故事书用 `W周D日_时段`(W01D1_AM)这种符号时钟,引擎吃的是整数分钟,直接解析会把
  due_clock 误读成 1~8(周号)反而让事件开局即「到点」打乱节奏。检测到符号时钟 → 把 due_clock/
  clock_start 清空,事件改由关键词/前置条件触发(= import_amphoreus 当初的处理)。

跑法:
  .venv/Scripts/python.exe scripts/import_story.py "<故事文件夹>" [--dry-run] [选项]
选项:
  --dry-run            只解析 + 预览,不写库(无需连库)
  --no-preset          只把卡入库,不拼预设
  --name NAME          预设名(默认:索引 H1 / 文件夹名 / 故事书标题)
  --mode standard|deep 预设记忆模式(默认 standard;引擎对 >5 角色会自动转 deep)
  --cover PATH         封面路径(默认空 → 引擎按故事名生成渐变封面)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # 从 scripts/ 跑也能 import src
from dotenv import load_dotenv

load_dotenv(override=True)

from src.models import WorldEntry
from src.parsers import (
    detect_kind,
    parse_character,
    parse_event,
    parse_player,
    parse_settingcard,
    parse_storybook,
    parse_worldbook,
    split_frontmatter,
)

# 卡种 → (库 kind, 解析器)。演出卡复用玩家卡解析器(演出卡 = 主角玩家卡)。
ROUTES = {
    "角色卡": ("characters", parse_character),
    "玩家卡": ("players", parse_player),
    "演出卡": ("players", parse_player),
    "世界书": ("worlds", parse_worldbook),
    "设定卡": ("settings", parse_settingcard),
    "故事书": ("stories", parse_storybook),
    "事件卡": ("events", parse_event),  # 收集但不入库(引擎从故事书读事件)
}
SKIP_KINDS = {"索引", ""}
_SYMBOLIC_CLOCK = re.compile(r"\bW\d+D\d+")


def lib_name(kind: str, obj) -> str:
    """取该对象在库里的 name(= slug 前的原名)。"""
    if kind == "角色卡":
        return obj.data.name
    if kind in ("玩家卡", "演出卡"):
        return obj.name
    if kind == "世界书":
        return obj.name
    if kind == "设定卡":
        return obj.name
    if kind == "故事书":
        return obj.title
    return getattr(obj, "title", "") or getattr(obj, "name", "")


def normalize_symbolic_clock(book, raw_text: str) -> bool:
    """符号时钟(W周D日)→ 引擎读不懂的分钟;清空 due_clock/clock_start,事件改由关键词/前置触发。"""
    if not _SYMBOLIC_CLOCK.search(raw_text):
        return False
    book.clock_start = 0
    for ev in book.events:
        ev.due_clock = None
        ev.escalate_after_idle = None
    return True


def first_blockquote(body: str) -> str:
    for line in body.splitlines():
        s = line.strip()
        if s.startswith(">"):
            return s.lstrip(">").strip()
    return ""


def first_h1(body: str) -> str:
    for line in body.splitlines():
        m = re.match(r"^#\s+(.+)", line)
        if m:
            return m.group(1).strip()
    return ""


def fm_list(fm: dict, key: str) -> list[str]:
    raw = (fm.get(key, "") or "").strip().lstrip("[").rstrip("]")
    return [x.strip() for x in re.split(r"[,，、;；]", raw) if x.strip()]


_TAG_NOISE = {"AI互动故事", "故事书", "角色卡", "世界书", "设定卡", "演出卡", "玩家卡", "索引", "AI工程"}


def settings_to_world_entries(setting_dumps: list[dict]) -> list[dict]:
    """设定卡 public/hidden 摊平成世界书条目(复用引擎关键词注入 + hidden 门控,引擎不必改)。"""
    out: list[dict] = []
    for sc in setting_dumps:
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


def main() -> int:
    ap = argparse.ArgumentParser(description="通用故事导入器(确定性解析 → 入库 + 拼预设)")
    ap.add_argument("folder", help="故事文件夹(含世界书/故事书/角色卡/演出卡/设定卡 的 .md)")
    ap.add_argument("--dry-run", action="store_true", help="只解析预览,不写库")
    ap.add_argument("--no-preset", action="store_true", help="只入库,不拼预设")
    ap.add_argument("--name", default="", help="预设名(默认:索引 H1 / 文件夹名 / 故事书标题)")
    ap.add_argument("--mode", default="standard", choices=["standard", "deep"], help="预设记忆模式")
    ap.add_argument("--cover", default="", help="封面路径(默认空 → 引擎生成渐变封面)")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        print(f"[错误] 不是文件夹:{folder}")
        return 2

    # 收集:按库 kind 分桶 + 索引元数据
    bucket: dict[str, list] = {"characters": [], "players": [], "worlds": [], "settings": [], "stories": [], "events": []}
    src_text: dict[int, str] = {}  # id(obj) → 原文(给故事书做时钟归一化)
    index_meta = {"name": "", "synopsis": "", "author": "", "tags": []}
    skipped: list[str] = []
    failed: list[str] = []

    for f in sorted(folder.rglob("*.md")):
        rel = f.relative_to(folder)
        text = f.read_text(encoding="utf-8")
        kind = detect_kind(text)
        if kind in SKIP_KINDS or kind not in ROUTES:
            # 索引 / 无 type:抓预设元数据(取第一个见到的)
            fm, body = split_frontmatter(text)
            if kind == "索引" or (not kind and not index_meta["name"]):
                index_meta["name"] = index_meta["name"] or first_h1(body)
                index_meta["synopsis"] = index_meta["synopsis"] or first_blockquote(body)
                index_meta["author"] = index_meta["author"] or fm.get("作者", "")
                index_meta["tags"] = index_meta["tags"] or [t for t in fm_list(fm, "tags") if t not in _TAG_NOISE]
            skipped.append(f"{rel}  (type={kind!r})")
            continue
        lib_kind, parser = ROUTES[kind]
        try:
            obj = parser(text)
        except Exception as e:  # noqa: BLE001
            failed.append(f"{rel}: {str(e)[:90]}")
            continue
        if kind == "故事书":
            if normalize_symbolic_clock(obj, text):
                print(f"  [时钟] {rel}:检测到 W周D日 符号时钟 → due_clock/clock_start 清空,事件改由关键词/前置触发")
        src_text[id(obj)] = text
        bucket[lib_kind].append((lib_name(kind, obj), obj))

    # ---- 解析结果总览 ----
    print(f"\n=== 解析 {folder.name} ===")
    for lib_kind, label in [("worlds", "世界书"), ("stories", "故事书"), ("characters", "角色卡"),
                            ("players", "演出/玩家卡"), ("settings", "设定卡"), ("events", "事件卡")]:
        items = bucket[lib_kind]
        if items:
            print(f"  {label}({len(items)}): {', '.join(n for n, _ in items)}")
    if skipped:
        print(f"  跳过 {len(skipped)}: {'; '.join(skipped)}")
    if failed:
        print(f"  [失败] {len(failed)}: {'; '.join(failed)}")
        return 1
    if bucket["events"]:
        print(f"  ⚠ {len(bucket['events'])} 张独立事件卡未入库(引擎从故事书读事件;隐藏事件卡引擎待补)")

    # ---- 写库 ----
    if not args.dry_run:
        from src import storage
        for lib_kind in ("worlds", "characters", "stories", "players", "settings"):
            for name, obj in bucket[lib_kind]:
                key = storage.save_library(lib_kind, name, obj.model_dump())
                print(f"  → {lib_kind}/{key}")

    # ---- 拼预设 ----
    if args.no_preset:
        print("\n(--no-preset:跳过预设装配)")
        return 0

    worlds, stories = bucket["worlds"], bucket["stories"]
    if len(worlds) != 1:
        print(f"  ⚠ 世界书数量={len(worlds)}(预设需正好 1 本){'  → 用第一本' if worlds else '  → 无法拼预设'}")
    if len(stories) != 1:
        print(f"  ⚠ 故事书数量={len(stories)}(预设需正好 1 本){'  → 用第一本' if stories else '  → 无法拼预设'}")
    if not worlds or not stories:
        print("  无法拼预设(缺世界书或故事书);卡已入库,可在 UI 手动组局。")
        return 0

    world_dump = worlds[0][1].model_dump()
    story_dump = stories[0][1].model_dump()
    setting_dumps = [o.model_dump() for _, o in bucket["settings"]]
    world_for_preset = world_dump
    if setting_dumps:
        extra = settings_to_world_entries(setting_dumps)
        world_for_preset = {**world_dump, "entries": list(world_dump.get("entries", [])) + extra}
        print(f"  设定卡摊平:+{len(extra)} 条并入预设 world(原 {len(world_dump.get('entries', []))} → {len(world_for_preset['entries'])})")

    name = args.name or index_meta["name"] or folder.name or stories[0][0]
    synopsis = index_meta["synopsis"] or (story_dump.get("premise", "") or "")[:120]
    author = index_meta["author"] or "太妃月 / Toffeemoon"
    tags = index_meta["tags"] or []

    payload = {
        "name": name,
        "characters": [o.model_dump() for _, o in bucket["characters"]],
        "playables": [o.model_dump() for _, o in bucket["players"]],
        "world": world_for_preset,
        "settings": setting_dumps,
        "story": story_dump,
        "player": None,
        "mode": args.mode,
        "cover": args.cover,
        "synopsis": synopsis,
        "author": author,
        "tags": tags,
    }

    print(f"\n=== 预设「{name}」===")
    print(f"  cast={len(payload['characters'])}  playables={len(payload['playables'])}  "
          f"world_entries={len(world_for_preset.get('entries', []))}  "
          f"events={len(story_dump.get('events', []))}  endings={len(story_dump.get('endings', []))}  "
          f"boundaries={len(story_dump.get('character_boundaries', []))}")
    print(f"  mode={args.mode}  cover={args.cover or '(渐变)'}  author={author}  tags={tags}")
    print(f"  synopsis: {synopsis[:80]}")

    if args.dry_run:
        print("\n(--dry-run:未写库 / 未存预设)")
        return 0

    from src import storage
    key = storage.save_preset(name, payload)
    print(f"  preset 已存:{name!r}  slug={key}")
    print("\n=== 库内现状 ===")
    for kind in ("worlds", "characters", "stories", "players", "settings"):
        print(f"  {kind}: {[it['name'] for it in storage.list_library(kind)]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
