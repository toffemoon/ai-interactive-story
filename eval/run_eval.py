"""评测 CLI + 编排胶水。

    python -m eval.run_eval --mode offline --turns 40 --persona mixed
    python -m eval.run_eval --mode offline --turns 12 --flaws 7:empty_narration,9:unknown_rel,20:repeat,21:repeat
    python -m eval.run_eval --mode real --judge export      # 真 DeepSeek 生成 + 导出 judge 包(Claude 会话内判)
    python -m eval.run_eval --mode real --judge api         # 有 ANTHROPIC_API_KEY 时直接调 Claude 判

离线 = 注入确定性内容,零 API,验证平台 + 结构性检查。
真实 = DeepSeek 真生成,Claude 当 judge。
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from . import judge, orchestrator, report
from .dimension_runner import SCORING_LIFECYCLES, load_dimensions


def parse_flaws(s: str | None) -> dict[int, str]:
    if not s:
        return {}
    out = {}
    for part in s.split(","):
        if ":" in part:
            i, name = part.split(":", 1)
            out[int(i)] = name.strip()
    return out


async def run_offline_eval(fixture_id="mistport", num_turns=40, persona="mixed",
                           flaws=None, label="offline"):
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)
    fixture = orchestrator.load_fixture(fixture_id)
    playthrough = await orchestrator.run_offline(fixture_id, num_turns=num_turns, persona=persona, flaws=flaws)
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    run_dir = orchestrator.new_run_dir(label)
    orchestrator.save_playthrough(run_dir, playthrough)
    agg = report.aggregate(playthrough, structural, fixture, dims)
    reg = report.detect_regression(fixture_id, "offline", agg["dimensions"])
    rep = report.build_report(run_dir.name, fixture_id, "offline", persona, "deepseek(scripted)", playthrough, agg, reg)
    report.save_report(run_dir, rep)
    return rep, run_dir


async def run_real_eval(fixture_id="mistport", adapter="deepseek", judge_mode="export", label="real"):
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)
    fixture = orchestrator.load_fixture(fixture_id)
    playthrough = await orchestrator.run_real(fixture_id, adapter=adapter)
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    run_dir = orchestrator.new_run_dir(label)
    orchestrator.save_playthrough(run_dir, playthrough)
    packets = orchestrator.export_judge_packets(run_dir, playthrough, fixture, dims)

    judge_results = []
    if judge_mode == "api" and judge.api_available():
        judge_results = [judge.judge_via_api(p) for p in packets]
        with open(run_dir / "judge_results.json", "w", encoding="utf-8") as f:
            json.dump(judge_results, f, ensure_ascii=False, indent=2)

    agg = report.aggregate(playthrough, structural, fixture, dims, judge_results=judge_results)
    reg = report.detect_regression(fixture_id, "real", agg["dimensions"])
    rep = report.build_report(run_dir.name, fixture_id, "real", "authored", adapter, playthrough, agg, reg)
    report.save_report(run_dir, rep)
    return rep, run_dir, packets


def finalize_real_run(run_dir: str, fixture_id="mistport", adapter="deepseek"):
    """读回已存的 playthrough + 会话内/外补判的 judge_results.json,重新聚合并出最终报告。"""
    rd = Path(run_dir)
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)
    fixture = orchestrator.load_fixture(fixture_id)
    with open(rd / "playthrough.json", encoding="utf-8") as f:
        playthrough = json.load(f)
    judge_results = []
    jp = rd / "judge_results.json"
    if jp.exists():
        with open(jp, encoding="utf-8") as f:
            judge_results = json.load(f)
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    agg = report.aggregate(playthrough, structural, fixture, dims, judge_results=judge_results)
    reg = report.detect_regression(fixture_id, "real", agg["dimensions"])
    rep = report.build_report(rd.name, fixture_id, "real", "authored", adapter, playthrough, agg, reg)
    report.save_report(rd, rep)
    return rep


def main():
    ap = argparse.ArgumentParser(description="ai-interactive-story 评测平台")
    ap.add_argument("--mode", choices=["offline", "real"], default="offline")
    ap.add_argument("--fixture", default="mistport")
    ap.add_argument("--turns", type=int, default=40)
    ap.add_argument("--persona", default="mixed")
    ap.add_argument("--flaws", default=None, help="如 7:empty_narration,9:unknown_rel,20:repeat")
    ap.add_argument("--adapter", default="deepseek")
    ap.add_argument("--judge", choices=["none", "export", "api"], default="export")
    ap.add_argument("--label", default=None)
    args = ap.parse_args()

    label = args.label or args.mode
    if args.mode == "offline":
        rep, run_dir = asyncio.run(run_offline_eval(
            args.fixture, num_turns=args.turns, persona=args.persona,
            flaws=parse_flaws(args.flaws), label=label))
    else:
        rep, run_dir, _ = asyncio.run(run_real_eval(
            args.fixture, adapter=args.adapter, judge_mode=args.judge, label=label))

    print(report.render_markdown(rep))
    print(f"\n→ 详见 {run_dir}")


if __name__ == "__main__":
    main()
