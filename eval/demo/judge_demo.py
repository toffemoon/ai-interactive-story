"""judge 演示驱动 —— 在 authored_playthrough.json 上跑完整评测流水线。

authored_playthrough.json 是**手写**的、贴着 mistport canon 的 8 轮对局(模拟 DeepSeek 风格),
结构上干净(state 合法),但在第 3 / 5 / 6 轮**故意植入 canon 违背**:
  - turn 2(第3轮):沈雾无忆珠凭空唤回玩家记忆 → 违背 RULE-2 + 沈雾硬上限
  - turn 4(第5轮):阿青说破会长囤积记忆的隐藏设定 → 违背隐藏 canon + 阿青知识边界
  - turn 5(第6轮):引擎认可玩家"记得卖掉的记忆内容" → 违背 RULE-1(卖出即遗忘)

要点:这些违背**结构性检查抓不到**(state 都合法),只有 LLM judge 能抓。
这正是 judge 维度存在的理由。

    python -m eval.demo.judge_demo build      # 跑结构性 + 导出 judge 包 + 打印裁判上下文
    python -m eval.demo.judge_demo finalize   # 读 judge_results.json,聚合出最终报告
"""

import json
import sys
from pathlib import Path

from eval import orchestrator, report
from eval.dimension_runner import SCORING_LIFECYCLES, load_dimensions
from eval.judge import build_combined_packets

DEMO = Path(__file__).parent
PLAYTHROUGH = DEMO / "authored_playthrough.json"
PACKETS = DEMO / "judge_packets.json"
JUDGE_RESULTS = DEMO / "judge_results.json"
REPORT_MD = DEMO / "report.md"
REPORT_JSON = DEMO / "report.json"


def _load():
    fixture = orchestrator.load_fixture("mistport")
    dims = load_dimensions(only_lifecycles=SCORING_LIFECYCLES)
    with open(PLAYTHROUGH, encoding="utf-8") as f:
        playthrough = json.load(f)
    return fixture, dims, playthrough


def build():
    fixture, dims, playthrough = _load()
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    # 结构性概览
    print("== 结构性维度(应全过——这些 canon 违背结构检查抓不到)==")
    for dim_id, results in structural["turn_scores"].items():
        scores = [r["score"] for r in results]
        print(f"  {dim_id}: 均分 {sum(scores)/len(scores):.2f}, 问题 {sum(len(r['issues']) for r in results)}")
    for dim_id, r in structural["session_scores"].items():
        print(f"  {dim_id}: {r['score']}, 问题 {len(r['issues'])}")

    packets = build_combined_packets(playthrough, fixture, dims)
    with open(PACKETS, "w", encoding="utf-8") as f:
        json.dump(packets, f, ensure_ascii=False, indent=2)
    print(f"\n== 生成 {len(packets)} 个 judge 包 → {PACKETS.name} ==\n")

    # 打印每个 turn 包的关键上下文(裁判看到的)
    for p in packets:
        print("=" * 70)
        print(f"[{p['kind']}] turn={p['turn']} dims={p['dims']}")
        # 从 prompt 里抽关键段落打印(避免太长)
        prompt = p["prompt"]
        for marker in ["## 玩家本轮输入", "## 本轮引擎输出", "## 源材料相关片段", "## 本局摘要"]:
            if marker in prompt:
                seg = prompt.split(marker, 1)[1][:500]
                print(f"\n{marker}{seg}")
    return structural


def finalize():
    fixture, dims, playthrough = _load()
    structural = orchestrator.run_structural_phase(playthrough, fixture, dims)
    with open(JUDGE_RESULTS, encoding="utf-8") as f:
        judge_results = json.load(f)
    agg = report.aggregate(playthrough, structural, fixture, dims, judge_results=judge_results)
    reg = {"baseline": None, "note": "judge 演示(手写对局,非真实 DeepSeek 生成)", "deltas": {}, "flags": []}
    rep = report.build_report("judge-demo", "mistport", "judge-demo", "authored", "deepseek(模拟)+claude-judge", playthrough, agg, reg)
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)
    with open(REPORT_MD, "w", encoding="utf-8") as f:
        f.write(report.render_markdown(rep))
    print(report.render_markdown(rep))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    (build if cmd == "build" else finalize)()
