"""大规模多角色长对话测试 runner。

    LLM_API_KEY=<真key> python -m eval.run_big --fixture _starrail --turns 60 --mode standard

跑:DeepSeek 玩家 × 多场景 × 多角色 × 长对局(真实 DeepSeek 生成)→
结构性维度 + 确定性记忆探针 + speaker 合法性 + 导出 judge 包(Claude 会话内抽样判)。
输出落 eval/runs/(gitignored)。
"""

from __future__ import annotations

import argparse
import asyncio
import json

from . import big_test, judge, orchestrator, report
from .dimension_runner import SCORING_LIFECYCLES, load_dimensions


# DeepSeek 公开 list price(USD/M)
DS_IN, DS_OUT = 0.27, 1.10


async def run_big_eval(fixture_id="_starrail", total_turns=60, mode="standard", label="big"):
    fixture = big_test.load_fixture(fixture_id)
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)

    print(f"== 跑大测试:{fixture_id} · {total_turns} 轮 · mode={mode} ==")
    playthrough, player_tokens = await big_test.run_big(fixture, total_turns=total_turns, mode=mode)
    print(f"   生成完成:{len(playthrough)} 轮")

    # 结构性维度(逐轮 + 整局)
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    # 确定性记忆探针 + speaker 合法性
    mem = big_test.check_memory_probes(playthrough, fixture)
    spk = big_test.check_speaker_validity(playthrough, fixture)
    # judge 包(全轮导出,Claude 会话内抽样判)
    packets = judge.build_combined_packets(playthrough, fixture, dims)

    # 用量 + 成本
    eng = report._engine_usage(playthrough)
    eng_in = sum(r["engine_output"].get("usage", {}).get("prompt_tokens", 0) for r in playthrough)
    eng_out = sum(r["engine_output"].get("usage", {}).get("completion_tokens", 0) for r in playthrough)
    eng_cost = (eng_in * DS_IN + eng_out * DS_OUT) / 1e6
    player_cost = (player_tokens * (DS_IN + DS_OUT) / 2) / 1e6  # 玩家调用粗估

    run_dir = orchestrator.new_run_dir(label)
    orchestrator.save_playthrough(run_dir, playthrough)
    with open(run_dir / "checks.json", "w", encoding="utf-8") as f:
        json.dump({"memory_probes": mem, "speaker_validity": spk,
                   "structural": {k: _summ(v) for k, v in structural.get("turn_scores", {}).items()},
                   "structural_session": {k: v for k, v in structural.get("session_scores", {}).items()}},
                  f, ensure_ascii=False, indent=2)
    with open(run_dir / "judge_packets.json", "w", encoding="utf-8") as f:
        json.dump(packets, f, ensure_ascii=False, indent=2)

    # 摘要
    print("\n== 结构性维度 ==")
    for dim_id, results in structural["turn_scores"].items():
        scores = [r["score"] for r in results]
        iss = sum(len(r["issues"]) for r in results)
        print(f"  {dim_id}: 均分 {sum(scores)/len(scores):.2f} · 问题 {iss}")
    for dim_id, r in structural["session_scores"].items():
        print(f"  {dim_id}: {r['score']} · 问题 {len(r['issues'])}")
    print(f"\n== 记忆探针(确定性)== {mem['passed']}/{mem['total']} 召回 (留存率 {mem['retention_rate']})")
    for r in mem["results"]:
        print(f"  [{'记得' if r['recalled'] else '忘了'}] {r['probe_id']} 距离{r['distance']}轮 · token={r['token']!r} · {r['note']}")
    print(f"\n== speaker 合法性 == {spk['total_messages']} 条发言, 非法 {spk['invalid']}")
    for i in spk["issues"]:
        print("   ", i)
    print(f"\n== 用量/成本 ==")
    print(f"  引擎生成:{eng['total_tokens']:,} token · ${eng_cost:.4f}")
    print(f"  玩家(DeepSeek):{player_tokens:,} token · ${player_cost:.4f}")
    print(f"  judge 包:{len(packets)} 个(待 Claude 抽样判)")
    print(f"\n→ {run_dir}")
    return run_dir, mem, spk, structural, playthrough


def _summ(results):
    scores = [r["score"] for r in results]
    return {"mean": round(sum(scores) / len(scores), 3) if scores else None,
            "min": min(scores) if scores else None,
            "issues": sum(len(r["issues"]) for r in results)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", default="_starrail")
    ap.add_argument("--turns", type=int, default=60)
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--label", default="big")
    args = ap.parse_args()
    asyncio.run(run_big_eval(args.fixture, args.turns, args.mode, args.label))


if __name__ == "__main__":
    main()
