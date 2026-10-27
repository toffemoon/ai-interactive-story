"""开场思考(2026-10-27,临时方案):前 OPENING_THINK_TURNS 回合的主调用开 DeepSeek 思考,之后关闭;
开思考的那次调用带思考开关、加输出额度、放宽超时。全部离线。"""
import asyncio
import json
import os

os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_BASE_URL", "https://example.invalid/v1")
os.environ.setdefault("LLM_MODEL", "test-model")

from src import adapters, memory  # noqa: E402
from src import story as S  # noqa: E402
from src.models import CharacterCard, CharacterData, PlayerCard  # noqa: E402
from eval.harness import in_memory_storage  # noqa: E402

TURN = json.dumps({
    "reasoning": {"note": "t"}, "narration": "Rain on the glass.",
    "messages": [{"name": "Ada Vale", "text": "Still up?"}],
    "choices": [{"id": "a", "label": "Wait", "intent": "observe"}],
    "state_update": {"time_advance": 5, "scene": {"location": "Attic"}},
    "memory_write": [], "triggered_events": [],
})


def test_only_the_opening_turns_think(monkeypatch):
    seen = []

    async def fake_complete_main(self, bundle, *, json_mode, max_tokens, on_delta=None, think=False):
        seen.append(think)
        return TURN

    monkeypatch.setattr(adapters.DeepSeekAdapter, "complete_main", fake_complete_main)
    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    monkeypatch.setattr(S, "OPENING_THINK_TURNS", 2)
    chars = [CharacterCard(data=CharacterData(name="Ada Vale", description="d"))]
    with in_memory_storage():
        for action in ("", "Look around", "Ask Ada"):
            asyncio.run(S.story_turn(session_id="t-think", characters=chars, user=action,
                                     player=PlayerCard(name="Pell"), mode="standard"))
    assert seen == [True, True, False]


def test_thinking_call_carries_switch_budget_and_timeout(monkeypatch):
    calls = []

    async def fake_stream(messages, **kw):
        calls.append(kw)
        return TURN

    monkeypatch.setattr(adapters, "achat_messages_stream", fake_stream)
    ad = adapters.DeepSeekAdapter()
    bundle = adapters.ContextBundle(skeleton="s", action_prompt="a")
    asyncio.run(ad.complete_main(bundle, json_mode=True, max_tokens=2400, think=True))
    asyncio.run(ad.complete_main(bundle, json_mode=True, max_tokens=2400))
    on, off = calls
    assert on["extra_body"] == {"thinking": {"type": "enabled"}, "reasoning_effort": "medium"}
    assert on["max_tokens"] == 2400 + adapters.THINK_EXTRA_TOKENS
    assert on["timeout"] == adapters.THINK_TIMEOUT_SECONDS
    assert off["extra_body"] is None and off["max_tokens"] == 2400 and off["timeout"] is None


def test_opening_think_turns_zero_turns_it_off(monkeypatch):
    seen = []

    async def fake_complete_main(self, bundle, *, json_mode, max_tokens, on_delta=None, think=False):
        seen.append(think)
        return TURN

    monkeypatch.setattr(adapters.DeepSeekAdapter, "complete_main", fake_complete_main)
    monkeypatch.setattr(memory, "ensure_loading", lambda: None)
    monkeypatch.setattr(S, "OPENING_THINK_TURNS", 0)
    chars = [CharacterCard(data=CharacterData(name="Ada Vale", description="d"))]
    with in_memory_storage():
        asyncio.run(S.story_turn(session_id="t-nothink", characters=chars, user="",
                                 player=PlayerCard(name="Pell"), mode="standard"))
    assert seen == [False]
