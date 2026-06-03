"""LLM-as-Judge —— 构建评判上下文包(Claude 当裁判),可导出会话内判 / 调 API 判。

为什么 Claude 当裁判:引擎用 DeepSeek 生成,换不同模型家族判 → 规避 self-preference bias
(G-Eval 已记录:同模型既当生成又当裁判会给自己高分)。

每轮一个『combined packet』:把该轮所有 judge_turn 维度的 rubric 合进一次评判(成本优化:
batch 多维度进一个 call),裁判一次性给每个维度打分 + 证据。
整局一个 session packet:judge_session 维度看全程。
"""

from __future__ import annotations

import json
import os

from .dimension_runner import render_template, split_dimensions
from .structural_checks import _jaccard


JUDGE_META = (
    "你是一个互动故事引擎的质量评审员,客观评判引擎输出。\n"
    "评判原则(务必遵守,防偏差):\n"
    "- 你不知道这是 AI 生成还是人写的,只评内容本身。\n"
    "- 以提供的源材料(canon)为唯一 ground truth,不要用你自己的世界知识或偏好。\n"
    "- 分清『源材料没写的合理延伸』(不算错)与『与源材料直接矛盾』(算错)。\n"
    "- 评分要有区分度:别一律打 4-5,也别一律打 1-2,用完整量表。\n"
    "- 文本长度本身不是质量;别因为长就给高分、短就扣分(verbosity bias)。\n"
    "- 每个扣分点附证据:引用源材料原文 + 引用本轮输出原文。\n"
)


def retrieve_source(source_material: str, query: str, top_k: int = 5) -> str:
    """无 embedding 的源材料检索:按字符 n-gram 重叠挑最相关的几行(canon 多为条目式,行级即可)。"""
    lines = [ln.strip() for ln in (source_material or "").split("\n") if ln.strip() and not ln.strip().startswith("#")]
    scored = sorted(lines, key=lambda ln: _jaccard(ln, query), reverse=True)
    picked = [ln for ln in scored[:top_k]]
    return "\n".join(picked) if picked else "(无相关 canon 片段)"


def character_canon_text(fixture: dict, speaking: set[str] | None = None) -> str:
    """渲染发言角色的 canon:speech_rules + 故事书里的 character_boundaries。"""
    parts = []
    for c in fixture.get("characters", []):
        d = c.get("data", {})
        name = d.get("name", "")
        if speaking and name not in speaking:
            continue
        rules = "; ".join(d.get("speech_rules", []))
        parts.append(f"【{name}】性格:{d.get('personality','')}\n  说话硬规则:{rules}")
    story = fixture.get("story") or {}
    for b in story.get("character_boundaries", []):
        parts.append(
            f"【{b.get('character','')} 边界】公开:{'; '.join(b.get('public', []))}\n"
            f"  隐藏(未披露前不得说出):{'; '.join(b.get('hidden', []))}\n"
            f"  硬上限:{'; '.join(b.get('hard_limits', []))}"
        )
    return "\n".join(parts) or "(无角色 canon)"


def _messages_text(out: dict) -> str:
    return "\n".join(f"{m.get('name') or m.get('character_id')}: {m.get('text','')}" for m in out.get("messages", []))


def _prior_text(playthrough: list[dict], upto: int, k: int = 3) -> str:
    prior = playthrough[max(0, upto - k):upto]
    lines = []
    for r in prior:
        out = r.get("engine_output", {})
        lines.append(f"[第{r['turn']}轮] 玩家:{r.get('player_input','')}")
        lines.append(f"           叙事:{str(out.get('narration',''))[:120]}")
    return "\n".join(lines) or "(无,本轮是开场附近)"


def _state_update_summary(out: dict) -> str:
    su = out.get("state_update") or {}
    keep = {k: su.get(k) for k in ("scene", "relationships", "facts", "triggered_events", "time_advance") if k in su}
    return json.dumps(keep, ensure_ascii=False)[:600]


def _turn_context(playthrough: list[dict], i: int, fixture: dict) -> dict:
    rec = playthrough[i]
    out = rec["engine_output"]
    query = str(out.get("narration", "")) + " " + rec.get("player_input", "")
    speaking = {m.get("name") for m in out.get("messages", []) if m.get("name")}
    return {
        "source_excerpts": retrieve_source(fixture.get("source_material", ""), query, top_k=6),
        "character_canon": character_canon_text(fixture, speaking or None),
        "prior_turns": _prior_text(playthrough, i),
        "player_input": rec.get("player_input", ""),
        "current_narration": str(out.get("narration", "")),
        "current_messages": _messages_text(out),
        "state_update": _state_update_summary(out),
    }


def _dim_block(dim: dict, ctx: dict) -> str:
    """渲染单个 judge 维度在 combined prompt 里的区块:评估步骤 + rubric 主体。"""
    steps = dim.get("eval_steps")
    head = f"### 维度【{dim['id']}】{dim.get('name','')}"
    body = render_template(dim.get("judge_prompt", ""), ctx)
    step_text = ("评估步骤:\n" + "\n".join(str(s) for s in steps)) if steps else ""
    return "\n".join(x for x in [head, step_text, body] if x)


def build_combined_packets(playthrough: list[dict], fixture: dict, dims: list[dict]) -> list[dict]:
    """每轮一个 combined turn packet(含全部 judge_turn 维度)+ 一个 session packet。"""
    buckets = split_dimensions(dims)
    turn_dims = buckets["judge_turn"]
    session_dims = buckets["judge_session"]
    packets: list[dict] = []

    for i, rec in enumerate(playthrough):
        if not turn_dims:
            break
        ctx = _turn_context(playthrough, i, fixture)
        blocks = "\n\n".join(_dim_block(d, ctx) for d in turn_dims)
        dim_ids = [d["id"] for d in turn_dims]
        out_spec = "{" + ", ".join(f'"{d}": {{"score": 1-5, "reasoning": "...", "issues": [...], "evidence": [...]}}' for d in dim_ids) + "}"
        prompt = (
            JUDGE_META + "\n\n本轮要同时评判以下维度,各自独立打分。\n\n" + blocks +
            f"\n\n# 输出(严格 JSON,只输出这一个对象,键为维度 id)\n{out_spec}"
        )
        packets.append({"kind": "turn", "turn": rec["turn"], "dims": dim_ids, "prompt": prompt})

    if session_dims:
        story = fixture.get("story") or {}
        summary_lines = [f"[第{r['turn']}轮] 玩家:{r.get('player_input','')[:40]} | 叙事:{str(r['engine_output'].get('narration',''))[:80]}" for r in playthrough]
        key_idx = sorted(set([0, len(playthrough) // 2, len(playthrough) - 1])) if playthrough else []
        key_turns = "\n\n".join(
            f"[第{playthrough[i]['turn']}轮]\n玩家:{playthrough[i].get('player_input','')}\n叙事:{playthrough[i]['engine_output'].get('narration','')}\n发言:{_messages_text(playthrough[i]['engine_output'])}"
            for i in key_idx
        )
        ctx = {
            "source_overview": "主线:" + "; ".join(story.get("main_plot", [])) + "\n事件:" + "; ".join(e.get("title", "") for e in story.get("events", [])),
            "endings": "\n".join(f"- {e.get('title')}({e.get('tone')}): 条件 {'; '.join(e.get('conditions', []))}" for e in story.get("endings", [])),
            "session_summary": "\n".join(summary_lines),
            "key_turns": key_turns,
        }
        for d in session_dims:
            blocks = _dim_block(d, ctx)
            out_spec = '{"' + d["id"] + '": {"score": 1-5, "reasoning": "...", "issues": [...]}}'
            prompt = JUDGE_META + "\n\n评判整局(以下是全程摘要 + 关键轮次)。\n\n" + blocks + f"\n\n# 输出(严格 JSON)\n{out_spec}"
            packets.append({"kind": "session", "turn": None, "dims": [d["id"]], "prompt": prompt})

    return packets


# ── 可选:调 Anthropic API 当裁判(有 ANTHROPIC_API_KEY 时)──────────
def api_available() -> bool:
    if not os.getenv("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def judge_via_api(packet: dict, model: str = "claude-sonnet-4-6", max_tokens: int = 1500) -> dict:
    """用 Anthropic API 跑一个 packet,返回解析后的评分 dict。需 ANTHROPIC_API_KEY + anthropic SDK。"""
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role": "user", "content": packet["prompt"] + "\n\n只输出 JSON。"}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1].lstrip("json").strip("` \n")
    try:
        scores = json.loads(text)
    except Exception:
        scores = {"_parse_error": text[:500]}
    usage = getattr(resp, "usage", None)
    return {
        "kind": packet["kind"], "turn": packet["turn"], "scores": scores,
        "judge_usage": {"input_tokens": getattr(usage, "input_tokens", 0),
                        "output_tokens": getattr(usage, "output_tokens", 0)} if usage else {},
    }
