# -*- coding: utf-8 -*-
"""Import Lord of the Mysteries, Volume 1 (Part I: phases 1–2) as official story presets.

The content (English character cards, playable cards, world book, story books, creation rules) is derived from
the novel, so it lives OUTSIDE this public repo, in a private folder (default: ../lotm-content/build next to the
repo, or --content DIR / env LOTM_CONTENT_DIR). Only this importer is committed. Deterministic: no LLM parsing.

Content folder layout (all UTF-8 JSON unless noted):
  presets.json            [{key, name, cast, players, story, rules, synopsis, author, tags, cover, mode, exclude_cast?}]
  world.json              WorldBook shared by every preset
  cast-pN.json            [CharacterData]   NPC cards for that phase
  players-pN.json         [PlayerCard]      playable book characters for that phase
  story-pN.json           StoryBook
  creation-rules-pN.md    plain text handed to /api/register_player for self-created characters

Run (from the repo root):
  python scripts/import_lotm.py check     [--content DIR]   validate, assemble, estimate per-turn prompt size; no DB, no LLM
  python scripts/import_lotm.py publish   [--content DIR] [--owner ACCOUNT]   save the presets (needs DATABASE_URL in .env):
                                                     official by default, or private to one account with --owner
  python scripts/import_lotm.py unpublish [--content DIR] [--owner ACCOUNT]   delete them again
  Without DATABASE_URL but with a Supabase secret key, add  --rest https://<project>.supabase.co --keyfile FILE
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # 从 scripts/ 跑也能 import src

from src.models import CharacterCard, CharacterData, PlayerCard, StoryBook, WorldBook  # noqa: E402

UNRESOLVED = "⟦"  # 内容里还没定英文名的占位标记;有就拒绝导入
# 每轮都会注入的角色卡字段的字数上限(超了只警告,不拦)
CARD_CAPS = {"description": 130, "personality": 45, "scenario": 55, "mes_example": 80}


def _content_dir(arg: str | None) -> Path:
    d = arg or os.environ.get("LOTM_CONTENT_DIR") or str(ROOT.parent / "lotm-content" / "build")
    p = Path(d)
    if not (p / "presets.json").exists():
        sys.exit(f"content folder not found or has no presets.json: {p}")
    return p


def _read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _words(s: str) -> int:
    return len(re.findall(r"\S+", s or ""))


SECRET_RE = re.compile(r"\s*SECRET\b.*$", re.S)
# 故事详情页(StoryHero)会把这些字段翻给玩家看
SHOWN_FIELDS = ("anchor", "look", "personality", "tension", "description", "scenario")
# spoiler_free 预设的展示字段里不该出现的剧情秘密字眼
SPOILER_TERMS = re.compile(
    r"gray fog|grey fog|above the fog|Tarot|\bthe Fool\b|Zhou Mingrui|another world|transmigr|shot himself|"
    r"incantation|companion|eyes behind|True Creator|crucif|possess", re.I)


def _move_secret(c: dict) -> dict:
    """卡作者把角色自己的秘密写在 description 末尾的 SECRET 行。详情页会把 description 原样翻给玩家看,
    而 speech_rules 每轮注入却不在任何界面展示 —— 所以导入时把 SECRET 行挪进 speech_rules 末条(仍是输出控制)。"""
    m = SECRET_RE.search(c.get("description", ""))
    if not m:
        return c
    secret = re.sub(r"^\s*SECRET\s*(\([^)]*\))?\s*:?\s*", "", m.group(0)).strip()
    return {
        **c,
        "description": c["description"][: m.start()].rstrip(),
        "speech_rules": list(c.get("speech_rules", [])) + [
            "SECRET — never say it aloud and never narrate it; it may only show as behavior: " + secret
        ],
    }


def assemble(content: Path) -> tuple[list[dict], list[str], list[str]]:
    """读内容 → 过 pydantic 校验 → 拼成 preset payload。返回 (payloads, errors, warnings)。"""
    errors: list[str] = []
    warnings: list[str] = []
    world = WorldBook(**_read_json(content / "world.json"))
    payloads = []
    for meta in _read_json(content / "presets.json"):
        tag = meta["key"]
        skip = set(meta.get("exclude_cast", []))  # 某预设用不到的卡(如无剧透版不需要塔罗会成员),少注入也少剧透
        cast = [CharacterCard(data=CharacterData(**_move_secret(c)))
                for c in _read_json(content / meta["cast"]) if c.get("name") not in skip]
        players = [PlayerCard(**p) for p in _read_json(content / meta["players"])]
        story = StoryBook(**_read_json(content / meta["story"]))
        rules = (content / meta["rules"]).read_text(encoding="utf-8").strip()

        names = [c.data.name for c in cast]
        if len(set(names)) != len(names):
            errors.append(f"[{tag}] duplicate cast names: {names}")
        for c in cast:
            for field in SHOWN_FIELDS:
                v = getattr(c.data, field)
                if "SECRET" in v:  # 这些字段详情页会展示,秘密只能在 speech_rules
                    errors.append(f"[{tag}] {c.data.name}.{field} still contains a SECRET line (shown to players)")
                if meta.get("spoiler_free"):  # 给没读过书的玩家的预设:展示字段里不许出现剧情秘密的字眼
                    hit = SPOILER_TERMS.search(v)
                    if hit:
                        errors.append(f"[{tag}] {c.data.name}.{field} mentions {hit.group(0)!r} (spoiler-free preset)")
            if re.search(r"[(（].*(phase|阶段)", c.data.name, re.I):
                errors.append(f"[{tag}] card name must be the plain name: {c.data.name!r}")
            for field, cap in CARD_CAPS.items():
                n = _words(getattr(c.data, field))
                if n > cap:
                    warnings.append(f"[{tag}] {c.data.name}.{field}: {n} words > {cap}")
        for p in players:
            if p.name not in names:
                # 玩家选了书中角色时,引擎按名字把同名 NPC 卡从可发言集里剔除;没有同名卡也能玩,只是没法剔
                warnings.append(f"[{tag}] playable {p.name!r} has no NPC card of the same name")
        known = set(names) | {b.character for b in story.character_boundaries}
        for e in story.events:
            for ch in e.characters:
                if ch not in known:
                    warnings.append(f"[{tag}] event {e.event_id}: character {ch!r} has no card")
        ids = [e.event_id for e in story.events]
        for en in story.endings:
            for rid in en.required_events:
                if rid not in ids:
                    errors.append(f"[{tag}] ending {en.ending_id} requires unknown event {rid!r}")
        if len(story.character_boundaries) > 6:
            warnings.append(f"[{tag}] {len(story.character_boundaries)} boundaries; the engine shows only the first 6")

        payload = {
            "name": meta["name"],
            "characters": [c.model_dump() for c in cast],
            "playables": [p.model_dump() for p in players],
            "world": world.model_dump(),
            "settings": [],
            "story": story.model_dump(),
            "player": None,
            "mode": meta.get("mode", "deep"),
            "cover": meta.get("cover", ""),
            "synopsis": meta.get("synopsis", ""),
            "author": meta.get("author", ""),
            "author_note": "",
            "tags": meta.get("tags", []),
            "creation_rules": rules,
            "allow_observer": False,
        }
        blob = json.dumps(payload, ensure_ascii=False)
        if UNRESOLVED in blob:
            spots = sorted(set(re.findall(UNRESOLVED + r"[^⟧]*⟧", blob)))
            errors.append(f"[{tag}] unresolved name markers: {spots}")
        payloads.append(payload)
    return payloads, errors, warnings


def estimate_prompt(payload: dict) -> dict:
    """用引擎的英文 prompt 组装函数,对一个脚本化的开局回合拼出完整 prompt(不调 LLM、不连库),估每轮体量。"""
    # src.llm 导入时要求这两个变量存在;check 模式不发任何请求,给占位值即可
    os.environ.setdefault("LLM_API_KEY", "not-used-by-check")
    os.environ.setdefault("LLM_BASE_URL", "http://127.0.0.1:9/not-used-by-check")
    from src import story as eng

    characters = [CharacterCard(**c) for c in payload["characters"]]
    story = StoryBook(**payload["story"])
    world = WorldBook(**payload["world"])
    out = {}
    probes = {
        "self-created": (PlayerCard(name="Mara Hollis", role="Ordinary person, clerk", opening="Tingen"),
                         "I walk to Blackthorn Security on Zouteland Street and ask the receptionist about the Nighthawks."),
        "as Klein": (next((PlayerCard(**p) for p in payload["playables"] if p["name"] == "Klein Moretti"), None),
                     "I check the revolver, then go to the Divination Club on Howes Street."),
    }
    for label, (player, action) in probes.items():
        if player is None:
            continue
        state = eng._init_state(characters, player, story)
        # 引擎扫的是 本轮行动 + 最近 8 条消息;开局还没有消息,只扫行动
        world_hits = eng._world_keyword_hits(world, action)
        story_hits = eng._story_event_hits(story, action, state)
        prompt = eng._prompt_en(characters, player, story, world_hits, story_hits, [], [], state, {})
        out[label] = {"chars": len(prompt), "approx_tokens": len(prompt) // 4,
                      "world_hits": len(world_hits), "story_hits": len(story_hits)}
    return out


def _secret_key(keyfile: str | None) -> str:
    """Supabase secret key(sb_secret_…):优先读 --keyfile 里以 sb_secret_ 开头的那一行,否则读环境变量。从不打印。"""
    if keyfile:
        for line in Path(keyfile).read_text(encoding="utf-8").splitlines():
            line = line.strip().split("=", 1)[-1].strip().strip("'\"")
            if line.startswith("sb_secret_"):
                return line
        sys.exit(f"no sb_secret_ key found in {keyfile}")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not key:
        sys.exit("give --keyfile or set SUPABASE_SECRET_KEY")
    return key


def publish_rest(args, payloads: list[dict]) -> None:
    """手上只有 Supabase API key、没有 DATABASE_URL 时:经 Supabase REST(PostgREST)写 presets 表。
    语义与 storage.save_preset / delete_preset 一致:按 slug 名 + user_id(官方 = null)覆盖或删除。"""
    import urllib.parse
    import urllib.request
    from datetime import datetime, timezone

    from src.storage import slug

    key = _secret_key(args.keyfile)
    base = args.rest.rstrip("/") + "/rest/v1/"

    def call(method: str, path: str, body=None):
        req = urllib.request.Request(
            base + path, method=method,
            data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json",
                     "Prefer": "return=representation"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    q = urllib.parse.quote
    owner = None
    if args.owner:
        rows = call("GET", f"users?select=id&or=(email.eq.{q(args.owner)},username.eq.{q(args.owner)})&limit=1")
        if not rows:
            sys.exit(f"no account matches {args.owner!r}; nothing written")
        owner = rows[0]["id"]
    who = f"user_id=eq.{owner}" if owner else "user_id=is.null"
    scope = f"private to {args.owner}" if owner else "official"
    for pl in payloads:
        name_key = slug(pl["name"], "preset")
        found = call("GET", f"presets?select=id&name=eq.{q(name_key)}&{who}")
        if args.mode == "publish":
            if found:
                call("PATCH", f"presets?id=eq.{found[0]['id']}",
                     {"data": pl, "updated_at": datetime.now(timezone.utc).isoformat()})
                print(f"  updated ({scope}): {pl['name']!r} -> {name_key}")
            else:
                call("POST", "presets", {"name": name_key, "data": pl, "user_id": owner})
                print(f"  published ({scope}): {pl['name']!r} -> {name_key}")
        else:
            gone = call("DELETE", f"presets?name=eq.{q(name_key)}&{who}") or []
            print(f"  deleted ({scope}): {pl['name']!r} -> {len(gone)} row(s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "publish", "unpublish"])
    ap.add_argument("--content", default=None)
    ap.add_argument("--owner", default=None,
                    help="publish privately to this account (email, username or user id) instead of as official presets")
    ap.add_argument("--rest", default=None, metavar="https://<project>.supabase.co",
                    help="write through Supabase REST with a secret key instead of DATABASE_URL")
    ap.add_argument("--keyfile", default=None, help="file holding the sb_secret_ key (used with --rest)")
    args = ap.parse_args()
    content = _content_dir(args.content)
    payloads, errors, warnings = assemble(content)

    for w in warnings:
        print("  warn:", w)
    for e in errors:
        print("  ERROR:", e)

    if args.mode == "check":
        outdir = content / "out"
        outdir.mkdir(exist_ok=True)
        for pl in payloads:
            slug = re.sub(r"[^a-z0-9]+", "-", pl["name"].lower()).strip("-")
            (outdir / f"{slug}.json").write_text(json.dumps(pl, ensure_ascii=False, indent=2), encoding="utf-8")
            est = estimate_prompt(pl)
            print(f"{pl['name']}: cast={len(pl['characters'])} playables={len(pl['playables'])} "
                  f"world={len(pl['world']['entries'])} events={len(pl['story']['events'])} "
                  f"payload={len(json.dumps(pl, ensure_ascii=False)) // 1024}KB")
            for label, v in est.items():
                print(f"    per-turn prompt ({label}): ~{v['approx_tokens']} tokens "
                      f"({v['chars']} chars; world hits {v['world_hits']}, event hits {v['story_hits']})")
        print(f"assembled payloads written to {outdir}")
        sys.exit(1 if errors else 0)

    if errors:
        sys.exit("refusing to write: fix the errors above first")
    if args.rest:
        return publish_rest(args, payloads)
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=True)
    if not os.environ.get("DATABASE_URL"):
        sys.exit("DATABASE_URL is not set (put it in .env); nothing written")
    from src import storage

    owner = None
    if args.owner:  # 只给某个账号(如体验玩家)看:存成该账号的私有预设
        from src.auth import find_user_id
        owner = find_user_id(args.owner)
        if not owner:
            sys.exit(f"no account matches {args.owner!r}; nothing written")
    scope = f"private to {args.owner}" if owner else "official"
    for pl in payloads:
        if args.mode == "publish":
            key = storage.save_preset(pl["name"], pl, user_id=owner)  # 不带 user_id = 官方公共预设;同名覆盖,可重复跑
            print(f"  published ({scope}): {pl['name']!r} -> {key}")
        else:
            print(f"  deleted ({scope}): {pl['name']!r} -> {storage.delete_preset(pl['name'], user_id=owner)}")


if __name__ == "__main__":
    main()
