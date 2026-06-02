"""压测 runner —— 跑一个压力 fixture(多种类 IP / 原创),真 DeepSeek 生成,
结构/记忆/speaker 检查 + 导出 judge 包 + 成本。fixture 见 stress_fixtures.FIXTURES。

    PYTHONIOENCODING=utf-8 python -m eval.stress_run --fixture sherlock --turns 170
"""
from __future__ import annotations

import argparse
import asyncio
import json

from . import big_test, judge, orchestrator
from .dimension_runner import SCORING_LIFECYCLES, load_dimensions
from .stress_fixtures import FIXTURES

DS_IN, DS_OUT = 0.27, 1.10  # DeepSeek list price USD/M


async def main_async(fixture_key: str, turns: int, mode: str, label: str):
    fx = FIXTURES[fixture_key]()
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)
    print(f"== 压测真跑 {fixture_key} · 目标 {turns} 轮 · mode={mode} ==", flush=True)
    playthrough, player_tokens = await big_test.run_big(
        fx, total_turns=turns, mode=mode, session_id=f"stress-{fixture_key}")
    print(f"   生成完成 {len(playthrough)} 轮", flush=True)

    structural = orchestrator.run_structural_phase(playthrough, fx, dims)
    mem = big_test.check_memory_probes(playthrough, fx)
    spk = big_test.check_speaker_validity(playthrough, fx)
    packets = judge.build_combined_packets(playthrough, fx, dims)

    eng_in = sum(r["engine_output"].get("usage", {}).get("prompt_tokens", 0) for r in playthrough)
    eng_out = sum(r["engine_output"].get("usage", {}).get("completion_tokens", 0) for r in playthrough)
    eng_cost = (eng_in * DS_IN + eng_out * DS_OUT) / 1e6
    player_cost = (player_tokens * (DS_IN + DS_OUT) / 2) / 1e6

    run_dir = orchestrator.new_run_dir(label)
    orchestrator.save_playthrough(run_dir, playthrough)
    json.dump(packets, open(run_dir / "judge_packets.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    summary = {
        "fixture": fixture_key, "turns": len(playthrough), "mode": mode,
        "structural": {k: {"mean": round(sum(x["score"] for x in v) / len(v), 2),
                           "min": min(x["score"] for x in v),
                           "issues": sum(len(x["issues"]) for x in v)} for k, v in structural["turn_scores"].items()},
        "structural_session": {k: {"score": v["score"], "issues": len(v["issues"])} for k, v in structural["session_scores"].items()},
        "memory_probes": mem, "speaker_validity": spk,
        "cost": {"engine_tokens": eng_in + eng_out, "engine_usd": round(eng_cost, 4),
                 "player_tokens": player_tokens, "player_usd": round(player_cost, 4)},
        "scripted_probe_turns": sorted(int(k) for k in (fx.get("scripted_actions") or {})),
    }
    json.dump(summary, open(run_dir / "summary.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"\n[{fixture_key}] 记忆探针 {mem['passed']}/{mem['total']} · 留存 {mem['retention_rate']}", flush=True)
    for r in mem["results"]:
        print(f"  [{'记得' if r['recalled'] else '忘了'}] {r['probe_id']} 距离{r['distance']} token={r['token']!r}", flush=True)
    print(f"[{fixture_key}] speaker 非法 {spk['invalid']}/{spk['total_messages']}", flush=True)
    for i in spk["issues"]:
        print("   ", i, flush=True)
    print(f"[{fixture_key}] 结构均分", {k: summary["structural"][k]["mean"] for k in summary["structural"]}, flush=True)
    print(f"[{fixture_key}] 成本 引擎 {eng_in + eng_out:,} tok ${eng_cost:.4f} | 玩家 {player_tokens:,} tok ${player_cost:.4f}", flush=True)
    print(f"→ {run_dir}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", default="mistport_deep", choices=list(FIXTURES))
    ap.add_argument("--turns", type=int, default=170)
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--label", default=None)
    a = ap.parse_args()
    asyncio.run(main_async(a.fixture, a.turns, a.mode, a.label or a.fixture))


if __name__ == "__main__":
    main()
