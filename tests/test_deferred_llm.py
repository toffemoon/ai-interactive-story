import asyncio
import os

import pytest

os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_BASE_URL", "https://example.invalid/v1")
os.environ.setdefault("LLM_MODEL", "test-model")

from src.llm import (  # noqa: E402
    DeferredLLMCall,
    DeferredReplayMismatch,
    achat_messages,
    collect_usage,
    deferred_backend,
)


MESSAGES = [
    {"role": "system", "content": "Return JSON."},
    {"role": "user", "content": "hello"},
]


def _run_once():
    return asyncio.run(achat_messages(MESSAGES, json_mode=True, max_tokens=123))


def test_deferred_backend_yields_the_next_browser_call():
    with pytest.raises(DeferredLLMCall) as caught:
        with deferred_backend([]):
            _run_once()

    call = caught.value
    assert call.index == 0
    assert call.kind == "async"
    assert call.messages == MESSAGES
    assert call.max_tokens == 123
    assert call.json_mode is True
    assert len(call.request_id) == 64


def test_deferred_backend_replays_content_and_real_usage():
    with pytest.raises(DeferredLLMCall) as caught:
        with deferred_backend([]):
            _run_once()

    answer = {
        "request_id": caught.value.request_id,
        "content": '{"ok":true}',
        "usage": {
            "prompt_tokens": 11,
            "completion_tokens": 7,
            "total_tokens": 18,
        },
    }
    with collect_usage() as usage:
        with deferred_backend([answer]):
            assert _run_once() == '{"ok":true}'
        totals = usage.as_dict()

    assert totals == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "total_tokens": 18,
        "calls": 1,
    }


def test_deferred_backend_rejects_an_answer_from_another_call():
    with pytest.raises(DeferredReplayMismatch):
        with deferred_backend([{"request_id": "wrong", "content": "{}"}]):
            _run_once()
