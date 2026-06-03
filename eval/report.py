"""聚合 + 回归检测 + 报告渲染。

- aggregate:把结构性 / judge 的逐轮分聚成每维度 {mean, min, n, passed_ratio}。
- detect_regression:跟同 fixture+mode 的上一次 run 比,降幅超阈值就报警(GPR-bench 思路)。
- render_markdown:出人能读的报告。
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

RUNS_DIR = Path(__file__).parent / "runs"
REGRESSION_THRESHOLD = 0.5  # 维度均分降幅超此值 → 回归警报


def _mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(statistics.mean(xs), 3) if xs else None


def aggregate(playthrough, structural, fixture, dims, judge_results=None):
    judge_results = judge_results or []
    by_id = {d["id"]: d for d in dims}
    per_dim = {}

    # 结构性 turn
    for dim_id, results in structural.get("turn_scores", {}).items():
        scores = [r.get("score") for r in results]
        issues = [iss for r in results for iss in r.get("issues", [])]
        per_dim[dim_id] = _dim_entry(by_id.get(dim_id, {}), scores, results, issues)

    # 结构性 session
    for dim_id, r in structural.get("session_scores", {}).items():
        per_dim[dim_id] = _dim_entry(by_id.get(dim_id, {}), [r.get("score")], [r], r.get("issues", []))

    # judge(turn + session)
    judge_by_dim: dict[str, list] = {}
    for jr in judge_results:
        for dim_id, sc in (jr.get("scores") or {}).items():
            if isinstance(sc, dict) and isinstance(sc.get("score"), (int, float)):
                judge_by_dim.setdefault(dim_id, []).append(sc)
    for dim_id, scs in judge_by_dim.items():
        scores = [s.get("score") for s in scs]
        issues = [iss for s in scs for iss in (s.get("issues") or [])]
        per_dim[dim_id] = _dim_entry(by_id.get(dim_id, {}), scores, scs, issues)

    overall = _weighted_overall(per_dim, by_id)
    engine_usage = _engine_usage(playthrough)
    return {"dimensions": per_dim, "overall": overall, "engine_usage": engine_usage}


def _dim_entry(dim, scores, results, issues):
    valid = [s for s in scores if isinstance(s, (int, float))]
    # 只有 structural 结果带 "passed" 布尔;judge 结果没有 → 通过率记 None(不误显示 0.0)。
    has_passed = any(isinstance(r, dict) and "passed" in r for r in results)
    passed = [r for r in results if isinstance(r, dict) and r.get("passed") is True]
    return {
        "name": dim.get("name", ""),
        "type": dim.get("type", ""),
        "level": dim.get("level", ""),
        "weight": dim.get("weight", 1.0),
        "lifecycle": dim.get("lifecycle", ""),
        "mean": _mean(scores),
        "min": min(valid) if valid else None,
        "n": len(valid),
        "passed_ratio": round(len(passed) / len(results), 3) if (results and has_passed) else None,
        "sample_issues": issues[:6],
        "issue_count": len(issues),
    }


def _weighted_overall(per_dim, by_id):
    num = den = 0.0
    for dim_id, e in per_dim.items():
        if e["mean"] is None:
            continue
        w = by_id.get(dim_id, {}).get("weight", 1.0)
        num += e["mean"] * w
        den += w
    return round(num / den, 3) if den else None


def _engine_usage(playthrough):
    total = calls = 0
    for r in playthrough:
        u = r.get("engine_output", {}).get("usage") or {}
        total += int(u.get("total_tokens", 0) or 0)
        calls += int(u.get("calls", 0) or 0)
    return {"total_tokens": total, "llm_calls": calls, "turns": len(playthrough)}


def detect_regression(fixture_id, mode, per_dim):
    """跟同 fixture+mode 的最近一次历史 run 比每维度均分。"""
    prior = _latest_prior_report(fixture_id, mode)
    if not prior:
        return {"baseline": None, "note": "无历史基线(首次该配置)", "deltas": {}, "flags": []}
    prior_dims = prior.get("aggregate", {}).get("dimensions", {})
    deltas, flags = {}, []
    for dim_id, e in per_dim.items():
        cur = e["mean"]
        base = prior_dims.get(dim_id, {}).get("mean")
        if cur is None or base is None:
            continue
        d = round(cur - base, 3)
        deltas[dim_id] = d
        if d <= -REGRESSION_THRESHOLD:
            flags.append(f"⚠️ 回归:{dim_id} {base} → {cur} (Δ{d})")
        elif d >= REGRESSION_THRESHOLD:
            flags.append(f"✅ 提升:{dim_id} {base} → {cur} (Δ+{d})")
    return {"baseline": prior.get("run_id"), "deltas": deltas, "flags": flags}


def _latest_prior_report(fixture_id, mode):
    if not RUNS_DIR.exists():
        return None
    candidates = []
    for d in sorted(RUNS_DIR.glob("*")):
        rp = d / "report.json"
        if not rp.exists():
            continue
        try:
            with open(rp, encoding="utf-8") as f:
                r = json.load(f)
        except Exception:
            continue
        if r.get("fixture") == fixture_id and r.get("mode") == mode:
            candidates.append(r)
    return candidates[-1] if candidates else None


def build_report(run_id, fixture_id, mode, persona, adapter, playthrough, aggregate_result, regression):
    return {
        "run_id": run_id,
        "fixture": fixture_id,
        "mode": mode,
        "persona": persona,
        "adapter": adapter,
        "num_turns": len(playthrough),
        "aggregate": aggregate_result,
        "regression": regression,
    }


def save_report(run_dir: Path, report: dict) -> None:
    with open(run_dir / "report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(run_dir / "report.md", "w", encoding="utf-8") as f:
        f.write(render_markdown(report))


def render_markdown(report: dict) -> str:
    agg = report.get("aggregate", {})
    dims = agg.get("dimensions", {})
    lines = [
        f"# 评测报告 · {report['run_id']}",
        "",
        f"- fixture: `{report['fixture']}` · mode: `{report['mode']}` · persona: `{report.get('persona')}` · adapter: `{report.get('adapter')}`",
        f"- 回合数: {report['num_turns']}",
        f"- **加权总分: {agg.get('overall')}** / 5",
        "",
        "## 各维度",
        "",
        "| 维度 | 类型 | 粒度 | 权重 | 均分 | 最低 | n | 通过率 | 问题数 |",
        "|------|------|------|------|------|------|---|--------|--------|",
    ]
    def _f(v):
        return "—" if v is None else v
    for dim_id, e in dims.items():
        lines.append(
            f"| {dim_id} ({e['name']}) | {e['type']} | {e['level']} | {e['weight']} | "
            f"{_f(e['mean'])} | {_f(e['min'])} | {e['n']} | {_f(e['passed_ratio'])} | {e['issue_count']} |"
        )
    eu = agg.get("engine_usage", {})
    lines += [
        "",
        "## 引擎用量(生成侧)",
        f"- 总 token: **{eu.get('total_tokens')}** · LLM 调用: {eu.get('llm_calls')} · 回合: {eu.get('turns')}",
        "",
        "## 回归检测",
    ]
    reg = report.get("regression", {})
    if reg.get("baseline") is None:
        lines.append(f"- {reg.get('note', '无基线')}")
    else:
        lines.append(f"- 基线 run: `{reg.get('baseline')}`")
        for f in reg.get("flags", []) or ["无显著变化(所有维度 |Δ| < 0.5)"]:
            lines.append(f"- {f}")
    # 抽样问题
    flagged = {k: e for k, e in dims.items() if e.get("issue_count")}
    if flagged:
        lines += ["", "## 抽样问题"]
        for dim_id, e in flagged.items():
            lines.append(f"\n**{dim_id}** ({e['issue_count']} 条):")
            for iss in e["sample_issues"]:
                lines.append(f"- {iss}")
    return "\n".join(lines) + "\n"
