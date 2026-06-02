"""编排器 —— 一次评测运行的主流程。

Phase 1  playthrough 生成(离线脚本 / 真实 DeepSeek)
Phase 2  结构性维度(每轮 + 整局,代码判,零成本)
Phase 3  judge 维度打包(导出给 Claude 判 / 调 API);离线模式跳过(脚本内容无评判意义)
Phase 4  聚合 + 回归(见 report.py)

离线 = 注入确定性内容跑通平台 + 证明结构性检查能抓缺陷。
真实 = DeepSeek 真生成,Claude 当 judge,看模型/成本差距。
"""

from __future__ import annotations

import json
from pathlib import Path

from src import llm
from src.adapters import set_adapter
from src.models import CharacterCard, PlayerCard, StoryBook, WorldBook
from src.story import story_turn

from . import judge
from .dimension_runner import load_dimensions, run_structural, split_dimensions
from .harness import in_memory_storage
from .providers import authored_real_script, make_scripted_engine, persona_action

RUNS_DIR = Path(__file__).parent / "runs"
FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(fixture_id: str) -> dict:
    with open(FIXTURES_DIR / f"{fixture_id}.json", encoding="utf-8") as f:
        return json.load(f)


def _build_cards(fixture: dict):
    characters = [CharacterCard(**c) for c in fixture["characters"]]
    world = WorldBook(**fixture["world"]) if fixture.get("world") else None
    story = StoryBook(**fixture["story"]) if fixture.get("story") else None
    player = PlayerCard(**fixture["player"]) if fixture.get("player") else None
    return characters, world, story, player


async def _play_loop(fixture, *, action_for, num_turns, session_id):
    """跑 num_turns 轮,action_for(turn, last_record) -> 玩家行动字符串。返回 turn_records。"""
    characters, world, story, player = _build_cards(fixture)
    records: list[dict] = []
    for t in range(num_turns):
        action = action_for(t, records[-1] if records else None)
        out = await story_turn(
            session_id=session_id, characters=characters, user=action,
            world=world, story=story, player=player, mode="standard",
        )
        rec = {"turn": t, "player_input": action, "engine_output": out.model_dump()}
        records.append(rec)
        if out.state.main_resolved:
            break
    return records


async def run_offline(fixture_id: str, *, num_turns: int = 40, persona: str = "mixed",
                      flaws: dict[int, str] | None = None, session_id: str = "eval-offline") -> list[dict]:
    """离线 playthrough:脚本 LLM + 内存存储 + 脚本玩家。零 API / 零 DB。"""
    fixture = load_fixture(fixture_id)
    set_adapter("deepseek")  # 仍走 DeepSeekAdapter.format_main(被脚本后端拦截实际调用)
    responder, _ = make_scripted_engine(fixture, flaws=flaws)

    def action_for(t, last):
        return persona_action(persona, t, last)

    with in_memory_storage(), llm.scripted_backend(responder):
        return await _play_loop(fixture, action_for=action_for, num_turns=num_turns, session_id=session_id)


async def run_real(fixture_id: str, *, num_turns: int | None = None,
                   adapter: str = "deepseek", session_id: str = "eval-real") -> list[dict]:
    """真实 playthrough:真 DeepSeek 生成,作者脚本玩家。内存存储(避开 Supabase 暂停坑)。"""
    fixture = load_fixture(fixture_id)
    set_adapter(adapter)
    script = authored_real_script()
    n = len(script) if num_turns is None else min(num_turns, len(script))

    def action_for(t, last):
        return script[t] if t < len(script) else "我继续往前查"

    with in_memory_storage():  # 真实 LLM,但存储仍用内存,避开 DB 依赖
        return await _play_loop(fixture, action_for=action_for, num_turns=n, session_id=session_id)


def run_structural_phase(playthrough: list[dict], fixture: dict, dims: list[dict]) -> dict:
    """每轮 + 整局结构性评分。返回 {turn_scores: {dim_id: [per-turn results]}, session_scores: {dim_id: result}}。"""
    buckets = split_dimensions(dims)
    turn_scores: dict[str, list] = {}
    for dim in buckets["structural_turn"]:
        results = []
        for i, rec in enumerate(playthrough):
            results.append(run_structural(dim, rec, fixture, playthrough[:i]))
        turn_scores[dim["id"]] = results
    session_scores: dict[str, dict] = {}
    for dim in buckets["structural_session"]:
        session_scores[dim["id"]] = run_structural(dim, playthrough, fixture)
    return {"turn_scores": turn_scores, "session_scores": session_scores}


def new_run_dir(label: str) -> Path:
    RUNS_DIR.mkdir(exist_ok=True)
    existing = [p.name for p in RUNS_DIR.glob(f"{label}-*")]
    idx = len(existing) + 1
    d = RUNS_DIR / f"{label}-{idx:03d}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_playthrough(run_dir: Path, playthrough: list[dict]) -> None:
    with open(run_dir / "playthrough.json", "w", encoding="utf-8") as f:
        json.dump(playthrough, f, ensure_ascii=False, indent=2)


def export_judge_packets(run_dir: Path, playthrough: list[dict], fixture: dict, dims: list[dict]) -> list[dict]:
    """构建并导出 judge 上下文包,供 Claude 在会话内(或 API)逐个评判。"""
    packets = judge.build_combined_packets(playthrough, fixture, dims)
    with open(run_dir / "judge_packets.json", "w", encoding="utf-8") as f:
        json.dump(packets, f, ensure_ascii=False, indent=2)
    return packets
