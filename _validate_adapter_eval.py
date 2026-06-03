"""验证:模型适配器层 + 评测平台(全部离线,零 API / 零 DB)。

跑:  uv run python _validate_adapter_eval.py   (或 .venv/bin/python _validate_adapter_eval.py)
覆盖验收标准:适配器换模型不改引擎 / 评测骨架自动跑 / 维度动态(加 JSON=加维度)/ 回归能抓缺陷。
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from src.adapters import ClaudeAdapter, ContextBundle, DeepSeekAdapter, get_adapter, set_adapter
from eval.dimension_runner import DIMS_DIR, load_dimensions


def check(name, cond):
    print(f"  [{'OK' if cond else 'FAIL'}] {name}")
    assert cond, name


def test_adapter_parity():
    print("== 适配器:同一 bundle,不同模型不同组装,引擎核心不变 ==")
    b = ContextBundle(
        skeleton="SK", action_prompt="ACT", summary="SUM", recall_block="RC",
        recap="RP", recent_messages=[{"role": "user", "content": "u1"}, {"role": "assistant", "content": "a1"}],
        anchor="AN", esc_text="ES", clock_line="CK",
    )
    ds = DeepSeekAdapter().format_main(b)
    check("DeepSeek 折成 [system,user]", [m["role"] for m in ds] == ["system", "user"])
    sysc = ds[0]["content"]
    check("DeepSeek system 含全部区块", all(x in sysc for x in ["SK", "SUM", "RC", "RP", "AN", "ES", "CK"]))
    check("DeepSeek user = action", ds[1]["content"] == "ACT")
    cl = ClaudeAdapter().format_main(b)
    check("Claude 用真多轮(system+2历史+user=4)", len(cl) == 4 and cl[1]["content"] == "u1")
    check("Claude system 用区块标签", "<early_summary>" in cl[0]["content"])
    set_adapter("claude"); check("切到 claude", get_adapter().name == "claude")
    set_adapter("deepseek"); check("切回 deepseek", get_adapter().name == "deepseek")


def test_dynamic_dimension():
    print("== 维度动态:丢一个 JSON = 加一个维度,平台零改动 ==")
    before = {d["id"] for d in load_dimensions()}
    tmp = DIMS_DIR / "_tmp_validate.json"
    tmp.write_text(json.dumps({
        "id": "_tmp_validate", "name": "临时维度", "type": "structural", "level": "turn",
        "lifecycle": "draft", "weight": 0.1, "version": 1, "check": "output_structure",
    }, ensure_ascii=False), encoding="utf-8")
    try:
        after = {d["id"] for d in load_dimensions(only_lifecycles=None)}
        check("新维度被自动加载", "_tmp_validate" in after and "_tmp_validate" not in before)
    finally:
        tmp.unlink()
    check("移除后不再加载", "_tmp_validate" not in {d["id"] for d in load_dimensions(only_lifecycles=None)})


def test_offline_clean():
    print("== 离线干净跑(12 轮):结构性维度全过 ==")
    from eval.run_eval import run_offline_eval
    rep, _ = asyncio.run(run_offline_eval(num_turns=12, persona="curious", label="validate-clean"))
    dims = rep["aggregate"]["dimensions"]
    for dim_id in ("output_structure", "state_consistency", "time_progression"):
        check(f"{dim_id} 满分", dims[dim_id]["mean"] == 5 and dims[dim_id]["passed_ratio"] == 1.0)


def test_flaw_detection():
    print("== 离线注入缺陷:结构性维度能抓到 ==")
    from eval.run_eval import run_offline_eval
    flaws = {3: "empty_narration", 5: "unknown_rel"}
    rep, _ = asyncio.run(run_offline_eval(num_turns=10, persona="curious", flaws=flaws, label="validate-flaw"))
    dims = rep["aggregate"]["dimensions"]
    check("output_structure 抓到空叙事", dims["output_structure"]["issue_count"] >= 1)
    check("state_consistency 抓到未知角色", dims["state_consistency"]["issue_count"] >= 1)


if __name__ == "__main__":
    test_adapter_parity()
    test_dynamic_dimension()
    test_offline_clean()
    test_flaw_detection()
    print("\nALL VALIDATIONS PASSED ✅")
