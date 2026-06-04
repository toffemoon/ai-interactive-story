"""大规模多角色长对话测试 —— 模拟真实玩家在多场景里游玩,验证:
1. 多角色都能跑、不串人设、不违世界观;
2. 长对话后不丢记忆(确定性记忆探针:早埋一个独特事实,N 轮后追问,代码核对);
3. 不凭空捏造角色/设定(speaker 合法性 + 由 judge 抽样查 hallucination)。

玩家由 DeepSeek 驱动(像真人:跟随/探索/闲聊/调侃/试边界/回指旧事),
在 scene 之间移动,每个 scene 激活不同的 ≤3 个角色。

fixture(gitignored,版权)额外字段:
  roster(=characters)、scenes[{location,character_ids,turns:[a,b],entry_action,focus}]、
  memory_probes[{id,establish_turn,establish_action,token,query_turn,query_action,note}]、player_persona
"""

from __future__ import annotations

import json
from pathlib import Path

from src import llm
from src.adapters import set_adapter
from src.llm import achat_messages, collect_usage
from src.models import CharacterCard, PlayerCard, StoryBook, WorldBook
from src.story import story_turn

from .harness import in_memory_storage, in_memory_vectors

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(fixture_id: str) -> dict:
    with open(FIXTURES_DIR / f"{fixture_id}.json", encoding="utf-8") as f:
        return json.load(f)


def _build_world_story_player(fixture: dict):
    world = WorldBook(**fixture["world"]) if fixture.get("world") else None
    story = StoryBook(**fixture["story"]) if fixture.get("story") else None
    player = PlayerCard(**fixture["player"]) if fixture.get("player") else None
    return world, story, player


def scene_for_turn(t: int, scenes: list[dict]) -> dict:
    for s in scenes:
        a, b = s.get("turns", [0, 0])
        if a <= t <= b:
            return s
    return scenes[-1] if scenes else {"location": "未知", "character_ids": []}


def roster_subset(character_ids: list[str], roster: list[dict]) -> list[CharacterCard]:
    by_id = {c["data"].get("character_id") or c["data"].get("name"): c for c in roster}
    picked = [by_id[cid] for cid in character_ids if cid in by_id][:3]
    return [CharacterCard(**c) for c in picked]


def _present_names(cards: list[CharacterCard]) -> str:
    return "、".join(c.data.name for c in cards) or "(无)"


async def llm_player_action(persona: str, scene: dict, last_record: dict | None,
                            present: list[CharacterCard]) -> str:
    """DeepSeek 驱动的玩家:像真人一样产出下一步行动。"""
    last_txt = "(开场)"
    choices_txt = ""
    if last_record:
        out = last_record["engine_output"]
        msgs = "\n".join(f"{m.get('name')}: {m.get('text','')[:160]}" for m in out.get("messages", []))
        last_txt = f"叙事:{str(out.get('narration',''))[:240]}\n{msgs}"
        ch = out.get("choices") or []
        if ch:
            choices_txt = "可选项:" + " / ".join(c.get("label", "") for c in ch)
    system = (
        "你在扮演一个真实的互动故事玩家(题材由下方场景/角色决定)。像真人一样玩:有时跟随剧情或选项,"
        "有时自由探索、跟角色闲聊调侃、好奇地追问角色或世界观、偶尔开玩笑或提出意外请求、"
        "也会回指之前发生过的事保持连贯。行动要简短自然(一两句、第一人称),像真玩家打字。"
        "不要解释你在做什么,直接给出这一轮的行动。不要替角色说话。"
    )
    user = (
        f"你的玩家人设:{persona}\n"
        f"当前场景:{scene.get('location','')}\n"
        f"在场角色:{_present_names(present)}\n"
        f"上一轮:\n{last_txt}\n{choices_txt}\n\n"
        "你这一轮做什么?(直接输出行动,一两句话)"
    )
    with collect_usage() as acc:
        txt = await achat_messages(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=200,
        )
    return (txt or "").strip()[:300], acc.as_dict()


async def run_big(fixture: dict, *, total_turns: int, mode: str = "standard",
                  adapter: str = "deepseek", session_id: str = "big-test"):
    """跑大规模多场景长对局。返回 (playthrough, player_usage_total)。"""
    set_adapter(adapter)
    roster = fixture["characters"]
    scenes = fixture["scenes"]
    persona = fixture.get("player_persona", "一个好奇、爱探索、偶尔调皮的开拓者")
    world, story, player = _build_world_story_player(fixture)

    probes_establish = {p["establish_turn"]: p for p in fixture.get("memory_probes", [])}
    probes_query = {p["query_turn"]: p for p in fixture.get("memory_probes", [])}
    transitions = {s["turns"][0]: s for s in scenes if s.get("entry_action")}
    # 隐藏 canon 压力探针:在指定轮强制玩家说某句(逼引擎守住硬边界/隐藏设定),这些轮重点 judge。
    scripted = {int(k): v for k, v in (fixture.get("scripted_actions") or {}).items()}
    # 无真值 abstention 探针:问从未建立过的具体事实,引擎应认忘不编(Phase 1 ② 的核心验证轮)。
    abst = {int(p["turn"]): p for p in (fixture.get("abstention_probes") or [])}
    # #2 矛盾消解探针:establish/change/query 三轮注入,验证改后远距查到的是最新值。
    contra = {int(p["turn"]): p for p in (fixture.get("contradiction_probes") or [])}
    # Phase 3 知识边界探针:establish(某角色缺席时建立事实)/ absent-query(问缺席角色→应认忘)/
    # witness-query(问在场见证角色→应召回)。三轮注入,验证"叙事真相≠人人都知道"。
    kbp = fixture.get("knowledge_boundary_probes") or []
    kb_est = {int(p["establish_turn"]): p for p in kbp}
    kb_abs = {int(p["absent_turn"]): p for p in kbp}
    kb_wit = {int(p["witness_turn"]): p for p in kbp}

    records: list[dict] = []
    player_tokens = 0
    cur_loc = None
    # 内存存储隔离 Supabase(免费项目常被 pause → TCP 卡住);标准模式下向量记忆本就 no-op。
    # deep 模式额外挂内存向量库(本地 bge + numpy 余弦)→ 离线召回,不依赖 pgvector。
    import contextlib as _ctx
    with _ctx.ExitStack() as _stack:
      _stack.enter_context(in_memory_storage())
      if mode == "deep":
        import time as _time
        from src import memory as _M
        _stack.enter_context(in_memory_vectors())
        _M.ensure_loading()
        for _ in range(180):  # 等本地 bge 加载就绪(首次 ~10-30s)
            if _M.is_ready():
                break
            _time.sleep(1)
      for t in range(total_turns):
        scene = scene_for_turn(t, scenes)
        present = roster_subset(scene.get("character_ids", []), roster)
        if not present:
            present = roster_subset([roster[0]["data"].get("character_id") or roster[0]["data"]["name"]], roster)

        # 行动来源:记忆探针 > 隐藏 canon 探针 > 场景切换 > LLM 玩家
        action_kind = "llm"
        if t in probes_establish:
            action, action_kind = probes_establish[t]["establish_action"], "probe_establish"
        elif t in probes_query:
            action, action_kind = probes_query[t]["query_action"], "probe_query"
        elif t in abst:
            action, action_kind = abst[t]["action"], "abstention_probe"
        elif t in contra:
            action, action_kind = contra[t]["action"], "contradiction_" + contra[t]["kind"]
        elif t in kb_est:
            action, action_kind = kb_est[t]["establish_action"], "kb_establish"
        elif t in kb_abs:
            action, action_kind = kb_abs[t]["absent_action"], "kb_absent"
        elif t in kb_wit:
            action, action_kind = kb_wit[t]["witness_action"], "kb_witness"
        elif t in scripted:
            action, action_kind = scripted[t], "canon_probe"
        elif t in transitions and scene.get("location") != cur_loc:
            action, action_kind = transitions[t]["entry_action"], "transition"
        else:
            action, usage = await llm_player_action(persona, scene, records[-1] if records else None, present)
            player_tokens += int(usage.get("total_tokens", 0) or 0)
        cur_loc = scene.get("location")

        out = await story_turn(
            session_id=session_id, characters=present, user=action,
            world=world, story=story, player=player, mode=mode,
        )
        records.append({
            "turn": t, "scene": scene.get("location", ""), "action_kind": action_kind,
            "present": [c.data.name for c in present],
            "player_input": action, "engine_output": out.model_dump(),
        })
        if out.state.main_resolved:
            break
    return records, player_tokens


# ── 确定性记忆探针核对 ────────────────────────────────────────────
def check_memory_probes(playthrough: list[dict], fixture: dict) -> dict:
    """对每个探针:在 query 轮的引擎输出里找该探针的 token(或同义关键词)。代码判,确定性。"""
    by_query = {p["query_turn"]: p for p in fixture.get("memory_probes", [])}
    results = []
    for rec in playthrough:
        p = by_query.get(rec["turn"])
        if not p:
            continue
        out = rec["engine_output"]
        haystack = str(out.get("narration", "")) + " " + " ".join(
            m.get("text", "") for m in out.get("messages", [])
        )
        tokens = [p["token"]] + p.get("aliases", [])
        hit = any(tok and tok in haystack for tok in tokens)
        results.append({
            "probe_id": p["id"], "establish_turn": p["establish_turn"], "query_turn": p["query_turn"],
            "distance": p["query_turn"] - p["establish_turn"], "token": p["token"],
            "recalled": hit, "note": p.get("note", ""),
        })
    n = len(results)
    passed = sum(1 for r in results if r["recalled"])
    return {"results": results, "passed": passed, "total": n,
            "retention_rate": round(passed / n, 3) if n else None}


def check_speaker_validity(playthrough: list[dict], fixture: dict) -> dict:
    """每条发言者必须是 roster 或故事/世界书声明过的 canon 实体(放行涌现真凶罗伊洛特、别名村姑),
    否则=引擎从自身 IP 记忆凭空造的幻觉角色(如本 fixture 未声明的沙僧)。与引擎 _known_speaker_index 对齐。"""
    valid = {"narrator", "旁白"}
    for c in fixture["characters"]:
        d = c["data"]
        valid.add(d.get("character_id", ""))
        valid.add(d.get("name", ""))
    parts: list[str] = []
    for e in (fixture.get("world") or {}).get("entries", []):
        parts += list(e.get("keys", []))
        parts.append(e.get("content", ""))
    s = fixture.get("story") or {}
    parts += [s.get("title", ""), s.get("premise", "")]
    for ev in s.get("events", []):
        parts += [ev.get("title", ""), ev.get("summary", "")]
    for b in s.get("character_boundaries", []):
        parts.append(b.get("character", ""))
    canon_text = "\n".join(parts)

    def is_known(name: str, cid: str) -> bool:
        if name in valid or cid in valid:
            return True
        return bool(name) and len(name) >= 2 and name in canon_text

    issues = []
    total_msgs = 0
    for rec in playthrough:
        for m in rec["engine_output"].get("messages", []):
            total_msgs += 1
            name, cid = m.get("name", ""), m.get("character_id", "")
            if not is_known(name, cid):
                issues.append(f"第{rec['turn']}轮 出现未知发言者: name={name!r} id={cid!r}")
    return {"total_messages": total_msgs, "invalid": len(issues),
            "issues": issues[:12], "passed": len(issues) == 0}


def check_abstention(playthrough: list[dict], fixture: dict) -> dict:
    """无真值 abstention 探针:引擎应 in-character 认忘、绝不编。
    abstained=回复含认忘标记(不记得/查无/想不起…);fab_tell=伪造证据信号(翻账册/记录显示);
    wrote_fact=把无真值的"事实"落了 memory_write(③ 该=0)。"""
    from src.story import _ABSTAIN_MARKERS
    fab_tells = ("账册", "账本", "记录显示", "记在册", "翻开账", "查了查", "簿子", "卷宗", "档案记着")
    probes = {int(p["turn"]): p for p in (fixture.get("abstention_probes") or [])}
    results = []
    for rec in playthrough:
        p = probes.get(rec["turn"])
        if not p:
            continue
        out = rec["engine_output"]
        blob = str(out.get("narration", "")) + " " + " ".join(m.get("text", "") for m in out.get("messages", []))
        admitted = any(mk in blob for mk in _ABSTAIN_MARKERS)
        fab_tell = any(f in blob for f in fab_tells)
        wrote_fact = any((mw.get("kind") in ("fact", "quest")) for mw in out.get("memory_write", []))
        rc = str((out.get("reasoning") or {}).get("recall_check", "")).strip().lower()
        declared_miss = rc.startswith("miss")
        # clean = 表态认忘(标记 or 自报 miss)且没把编造落库 → 消除"会持久化/自我强化"的危害。
        # 不把 fab_tell 计入:认忘时提"账册"多是"账册里没有"的否认,非伪造证据(fab_tell 仅单独报告)。
        clean = (admitted or declared_miss) and not wrote_fact
        results.append({"turn": rec["turn"], "note": p.get("note", ""),
                        "abstained": admitted, "declared_miss": declared_miss,
                        "fab_tell": fab_tell, "wrote_fact": wrote_fact,
                        "recall_check": rc[:50], "clean": clean})
    n = len(results)
    passed = sum(1 for r in results if r["abstained"])
    clean = sum(1 for r in results if r["clean"])
    return {"results": results, "passed": passed, "total": n,
            "abstain_rate": round(passed / n, 3) if n else None,
            "clean": clean, "clean_rate": round(clean / n, 3) if n else None,
            "fab_tells": sum(1 for r in results if r["fab_tell"]),
            "wrote_facts": sum(1 for r in results if r["wrote_fact"])}


def check_contradiction(playthrough: list[dict], fixture: dict) -> dict:
    """#2 矛盾消解探针:先立 X=stale、后改 X=fresh,远距 query 应答 fresh、不答 stale。
    ok = fresh 出现且 stale 没出现(superseded 生效:旧值不再被召回/引用)。"""
    queries = [p for p in (fixture.get("contradiction_probes") or []) if p.get("kind") == "query"]
    by_turn = {r["turn"]: r for r in playthrough}
    results = []
    for p in queries:
        rec = by_turn.get(int(p["turn"]))
        if not rec:
            continue
        out = rec["engine_output"]
        blob = str(out.get("narration", "")) + " " + " ".join(m.get("text", "") for m in out.get("messages", []))
        fresh_in, stale_in = p["fresh"] in blob, p["stale"] in blob
        results.append({"turn": p["turn"], "fresh": p["fresh"], "stale": p["stale"],
                        "fresh_recalled": fresh_in, "stale_leaked": stale_in,
                        "ok": fresh_in and not stale_in, "note": p.get("note", "")})
    n = len(results)
    passed = sum(1 for r in results if r["ok"])
    return {"results": results, "passed": passed, "total": n,
            "rate": round(passed / n, 3) if n else None}


def _char_own_text(rec: dict, who: str) -> tuple[str, bool]:
    """取被问角色【自己】的发言(message.name 与 who 互为子串);取不到则退回全体 blob(保守)。
    这样'别的在场见证者替答'不会污染对被问角色的判定——知识边界是 per-character 的。"""
    out = rec["engine_output"]
    msgs = out.get("messages", []) or []
    mine = [str(m.get("text", "") or "") for m in msgs
            if who and (who in str(m.get("name", "")) or str(m.get("name", "")) in who)]
    if mine:
        return " ".join(mine), True
    whole = str(out.get("narration", "")) + " " + " ".join(str(m.get("text", "") or "") for m in msgs)
    return whole, False


# 缺席/没见证类声明(知识边界专用):角色声明"当时不在/没亲历"——这是认忘成功的关键信号。
# 即便后半句把 token 当【转述】提一嘴(如"我没下去,只是刚听你们通讯说K-23"),也算认忘成功,
# 因为他已明确声明非一手知情。现有 _ABSTAIN_MARKERS 全是"记不得"类记忆词,缺这类缺席词。
_ABSENCE_MARKERS = ("不在场", "没在场", "没在跟前", "没在旁", "不在跟前", "没亲眼", "没亲历", "没见过",
                    "没看见", "没瞧见", "没下去", "没随", "没跟去", "没跟着", "没去成", "当时不在",
                    "那会儿不在", "我不在", "没参与", "没经手", "没下到", "未亲眼", "未亲历", "不曾见",
                    "不曾亲", "留在列车", "留守", "没能去", "没一起")


def check_knowledge_boundary(playthrough: list[dict], fixture: dict) -> dict:
    """Phase 3 知识边界:缺席角色被问具体往事→应 in-character 认忘(absent-abstain);
    在场见证角色被问→应召回具体值(witness-recall);在场角色不该对自己知道的事误认忘(over-abstention 守卫)。
    判定只看【被问角色本人】的发言(_char_own_text),避免别的在场见证者替答污染。
    absent_ok = 被问的缺席角色【声明了非一手知情】(认忘标记/缺席声明/recall_check=miss)——
    转述提 token 不再否决(关键是他声明没亲历);token_leaked 仍单独报告(供看"无声明却吐 token"的真编造)。"""
    from src.story import _ABSTAIN_MARKERS
    markers = tuple(_ABSTAIN_MARKERS) + _ABSENCE_MARKERS
    probes = fixture.get("knowledge_boundary_probes") or []
    by_turn = {r["turn"]: r for r in playthrough}
    results = []
    for p in probes:
        token = str(p["token"])
        absent = witness = None
        ar = by_turn.get(int(p["absent_turn"]))
        if ar:
            blob, own = _char_own_text(ar, p["absent_char"])
            rc = str((ar["engine_output"].get("reasoning") or {}).get("recall_check", "")).strip().lower()
            admitted = any(mk in blob for mk in markers) or rc.startswith("miss")
            leaked = token in blob
            # 真编造 = 没声明非一手知情、却把 token 当一手知识说出来
            fabricated = leaked and not admitted
            absent = {"turn": p["absent_turn"], "char": p["absent_char"], "own_msg": own,
                      "abstained": admitted, "token_leaked": leaked, "fabricated": fabricated,
                      "recall_check": rc[:40], "ok": admitted and not fabricated}
        wr = by_turn.get(int(p["witness_turn"]))
        if wr:
            blob, own = _char_own_text(wr, p["witness_char"])
            rc = str((wr["engine_output"].get("reasoning") or {}).get("recall_check", "")).strip().lower()
            recalled = token in blob
            abst_w = any(mk in blob for mk in _ABSTAIN_MARKERS) or rc.startswith("miss")
            witness = {"turn": p["witness_turn"], "char": p["witness_char"], "own_msg": own,
                       "token_recalled": recalled, "over_abstained": abst_w and not recalled,
                       "ok": recalled}  # 见证者应答出具体值
        results.append({"id": p.get("id", ""), "token": token, "note": p.get("note", ""),
                        "absent": absent, "witness": witness})
    n_ab = sum(1 for r in results if r["absent"])
    ab_ok = sum(1 for r in results if r["absent"] and r["absent"]["ok"])
    n_wi = sum(1 for r in results if r["witness"])
    wi_ok = sum(1 for r in results if r["witness"] and r["witness"]["ok"])
    over = sum(1 for r in results if r["witness"] and r["witness"]["over_abstained"])
    return {"results": results,
            "absent_total": n_ab, "absent_ok": ab_ok,
            "absent_abstain_rate": round(ab_ok / n_ab, 3) if n_ab else None,
            "witness_total": n_wi, "witness_ok": wi_ok,
            "witness_recall_rate": round(wi_ok / n_wi, 3) if n_wi else None,
            "over_abstention": over}
