"""维度加载与执行 —— 维度是数据(JSON 配置),不是代码。

加一个 eval/dimensions/*.json = 加一个维度,本文件零改动即生效(验收标准之一)。
- structural 维度:check 字段指向 structural_checks.REGISTRY 里的函数,代码直接判。
- judge 维度:judge_prompt 是带 {{占位}} 的模板,本文件渲染后交给 judge.py 让 LLM 判。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .structural_checks import REGISTRY as STRUCTURAL_REGISTRY

DIMS_DIR = Path(__file__).parent / "dimensions"

# 计入回归/总分的生命周期;draft 跑但不计回归(实验中)。
SCORING_LIFECYCLES = {"active", "stable"}


def _as_text(value) -> str:
    """judge_prompt / eval_steps 允许写成字符串数组(可读),这里拼回多行字符串。"""
    if isinstance(value, list):
        return "\n".join(str(x) for x in value)
    return str(value or "")


def load_dimensions(only_lifecycles: set[str] | None = None) -> list[dict]:
    """加载所有维度配置。only_lifecycles=None 表示全加载(含 draft)。"""
    dims = []
    for path in sorted(DIMS_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            dim = json.load(f)
        dim["_file"] = path.name
        if only_lifecycles and dim.get("lifecycle") not in only_lifecycles:
            continue
        dims.append(dim)
    return dims


def split_dimensions(dims: list[dict]) -> dict[str, list[dict]]:
    """按 type×level 分桶,供编排器分阶段跑。"""
    buckets = {
        "structural_turn": [], "structural_session": [],
        "judge_turn": [], "judge_session": [],
    }
    for d in dims:
        key = f"{d.get('type','judge')}_{d.get('level','turn')}"
        if key in buckets:
            buckets[key].append(d)
    return buckets


def run_structural(dim: dict, target, fixture: dict, prior: list[dict] | None = None) -> dict:
    """跑一个 structural 维度。turn-level: target=turn_record;session-level: target=playthrough。"""
    fn = STRUCTURAL_REGISTRY.get(dim.get("check"))
    if fn is None:
        return {"score": None, "max": 5, "passed": None,
                "issues": [f"未知 structural check: {dim.get('check')}"], "checks": {}}
    if dim.get("level") == "session":
        return fn(target, fixture)
    return fn(target, fixture, prior or [])


# ── judge 模板渲染 ────────────────────────────────────────────────
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def render_template(template, context: dict) -> str:
    text = _as_text(template)

    def repl(m):
        key = m.group(1)
        return str(context.get(key, f"(无 {key})"))

    return _PLACEHOLDER.sub(repl, text)


def render_judge_prompt(dim: dict, context: dict) -> str:
    """渲染 judge 维度的完整 prompt:eval steps(G-Eval 自动 CoT)+ 主体模板。"""
    parts = []
    steps = dim.get("eval_steps")
    if steps:
        parts.append("# 评估步骤(先按此逐步推理,再打分)\n" + _as_text(steps))
    parts.append(render_template(dim.get("judge_prompt", ""), context))
    schema = dim.get("output_schema")
    if schema:
        parts.append(
            "# 输出格式(严格 JSON,只输出这一个对象)\n"
            + json.dumps(schema, ensure_ascii=False, indent=2)
        )
    return "\n\n".join(parts)
