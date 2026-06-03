"""结构性检查 —— 不需要 LLM,代码直接判,确定性高、跑得快、零成本。

每个函数返回标准结果 dict:
    {"score": 1-5, "max": 5, "passed": bool, "issues": [str], "checks": {name: bool}}

turn-level 签名:  fn(turn_record, fixture, prior_records) -> result
session-level 签名: fn(playthrough_records, fixture) -> result

turn_record = {
  "turn": int, "player_input": str,
  "engine_output": <StoryTurn dict>,   # narration/messages/choices/state_update/triggered_events/state/...
}
fixture = 加载后的场景(characters/world/story/player/source_material)
"""

from __future__ import annotations

JUMP_MAX_ADVANCE = 60 * 1440  # 跟 story.py 一致:单轮时间跳跃上限(60 故事天)


# ── 工具 ──────────────────────────────────────────────────────────
def _valid_char_keys(fixture: dict) -> set[str]:
    """合法的角色标识(character_id + name + 旁白),用于校验关系/发言归属。"""
    keys = {"narrator", "旁白"}
    for c in fixture.get("characters", []):
        d = c.get("data", {})
        if d.get("character_id"):
            keys.add(d["character_id"])
        if d.get("name"):
            keys.add(d["name"])
    return keys


def _valid_event_ids(fixture: dict) -> set[str]:
    story = fixture.get("story") or {}
    return {e.get("event_id") for e in story.get("events", []) if e.get("event_id")}


def _result(checks: dict[str, bool], issues: list[str]) -> dict:
    failed = sum(1 for ok in checks.values() if not ok)
    score = max(1, 5 - failed)
    if not checks:
        score = 5
    return {
        "score": score,
        "max": 5,
        "passed": failed == 0,
        "issues": issues,
        "checks": checks,
    }


def _ngrams(text: str, n: int = 3) -> set[str]:
    text = (text or "").strip()
    if len(text) < n:
        return {text} if text else set()
    return {text[i:i + n] for i in range(len(text) - n + 1)}


def _jaccard(a: str, b: str) -> float:
    ga, gb = _ngrams(a), _ngrams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


# ── turn-level 检查 ───────────────────────────────────────────────
def output_structure(turn: dict, fixture: dict, prior: list[dict]) -> dict:
    """每轮结构完整性:有正文、有角色发言、有选项、发言带署名。"""
    out = turn.get("engine_output", {})
    narration = str(out.get("narration", "")).strip()
    messages = out.get("messages") or []
    choices = out.get("choices") or []
    nonempty_msgs = [m for m in messages if str(m.get("text", "")).strip()]
    named_msgs = [m for m in nonempty_msgs if str(m.get("character_id", "")).strip() and str(m.get("name", "")).strip()]

    checks = {
        "narration_nonempty": bool(narration),
        "has_message": len(nonempty_msgs) >= 1,
        "has_choices": len(choices) >= 1,
        "messages_named": len(named_msgs) == len(nonempty_msgs) and len(nonempty_msgs) > 0,
    }
    issues = []
    if not checks["narration_nonempty"]:
        issues.append("narration 为空")
    if not checks["has_message"]:
        issues.append("本轮无任何角色发言")
    if not checks["has_choices"]:
        issues.append("本轮没有给玩家选项")
    if not checks["messages_named"]:
        issues.append("有角色发言缺 character_id / name 署名")
    return _result(checks, issues)


def state_consistency(turn: dict, fixture: dict, prior: list[dict]) -> dict:
    """运行状态内部一致性:关系归属合法、数值不越界、场景有地点。"""
    out = turn.get("engine_output", {})
    state = out.get("state") or {}
    valid_chars = _valid_char_keys(fixture)
    issues = []

    rels = state.get("relationships") or []
    rel_ids_ok = True
    rel_range_ok = True
    for r in rels:
        cid = r.get("character_id")
        if cid and cid not in valid_chars:
            rel_ids_ok = False
            issues.append(f"关系条目指向未知角色: {cid}")
        for k in ("trust", "tension", "affection"):
            v = r.get(k)
            if isinstance(v, (int, float)) and not (-100 <= v <= 100):
                rel_range_ok = False
                issues.append(f"关系数值越界: {cid}.{k}={v}")

    scene = state.get("scene") or {}
    loc_ok = bool(str(scene.get("location", "")).strip())
    if not loc_ok:
        issues.append("场景缺 location")

    present = scene.get("present_characters") or []
    present_ok = all((p in valid_chars or p == fixture.get("player", {}).get("name")) for p in present)
    if not present_ok:
        bad = [p for p in present if p not in valid_chars and p != fixture.get("player", {}).get("name")]
        issues.append(f"在场角色含未知名: {bad}")

    checks = {
        "relationship_ids_valid": rel_ids_ok,
        "relationship_values_in_range": rel_range_ok,
        "scene_has_location": loc_ok,
        "present_characters_known": present_ok,
    }
    return _result(checks, issues)


def time_progression(turn: dict, fixture: dict, prior: list[dict]) -> dict:
    """世界时钟推进合理:单调不减、增量非负、不荒诞跳跃、轮次递增。"""
    out = turn.get("engine_output", {})
    state = out.get("state") or {}
    clock = state.get("clock_minutes")
    turn_count = state.get("turn_count")

    prev_clock = None
    prev_turn_count = None
    if prior:
        pstate = prior[-1].get("engine_output", {}).get("state", {})
        prev_clock = pstate.get("clock_minutes")
        prev_turn_count = pstate.get("turn_count")

    issues = []
    monotonic = True
    advance_ok = True
    sane = True
    if isinstance(clock, (int, float)):
        if isinstance(prev_clock, (int, float)):
            adv = clock - prev_clock
            if adv < 0:
                monotonic = False
                issues.append(f"时钟倒流: {prev_clock} -> {clock}")
            if adv > JUMP_MAX_ADVANCE:
                sane = False
                issues.append(f"单轮时间跳跃过大: +{adv} 分钟")
    else:
        advance_ok = False
        issues.append("clock_minutes 缺失或非数值")

    tc_ok = True
    if isinstance(turn_count, int) and isinstance(prev_turn_count, int):
        if turn_count <= prev_turn_count:
            tc_ok = False
            issues.append(f"turn_count 未递增: {prev_turn_count} -> {turn_count}")

    checks = {
        "clock_present": advance_ok,
        "clock_monotonic": monotonic,
        "advance_sane": sane,
        "turn_count_increments": tc_ok,
    }
    return _result(checks, issues)


# ── session-level 检查 ────────────────────────────────────────────
def repetition_detection(playthrough: list[dict], fixture: dict, threshold: float = 0.6) -> dict:
    """相邻轮叙事重复度:引擎原地打转的客观信号(反重复机制是否生效)。"""
    narrations = [str(r.get("engine_output", {}).get("narration", "")).strip() for r in playthrough]
    narrations = [n for n in narrations if n]
    if len(narrations) < 2:
        return _result({"enough_turns": False}, ["回合太少,无法判重复"])

    repeats = []
    sims = []
    for i in range(1, len(narrations)):
        s = _jaccard(narrations[i - 1], narrations[i])
        sims.append(s)
        if s >= threshold:
            repeats.append((i, round(s, 2)))

    repeat_ratio = len(repeats) / max(1, len(sims))
    issues = [f"第{i}轮与上一轮叙事高度相似 (jaccard={s})" for i, s in repeats[:8]]
    # 评分:重复对占比越高分越低。
    if repeat_ratio == 0:
        score = 5
    elif repeat_ratio < 0.1:
        score = 4
    elif repeat_ratio < 0.2:
        score = 3
    elif repeat_ratio < 0.35:
        score = 2
    else:
        score = 1
    return {
        "score": score,
        "max": 5,
        "passed": repeat_ratio < 0.1,
        "issues": issues,
        "checks": {"repeat_ratio": repeat_ratio, "avg_similarity": round(sum(sims) / len(sims), 3)},
    }


# 名称 -> 函数,供 dimension_runner 按 YAML/JSON 配置里的 check 字段查表。
REGISTRY = {
    "output_structure": output_structure,
    "state_consistency": state_consistency,
    "time_progression": time_progression,
    "repetition_detection": repetition_detection,
}
