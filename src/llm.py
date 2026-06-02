"""LLM 适配层 —— 通过 OpenAI 兼容协议调任意提供商(默认 DeepSeek)。

支持单轮 / 多轮 messages、JSON 模式、异步与流式。
切换提供商:改 .env 里的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL,代码不动。
"""

import contextlib
import contextvars
import os
from openai import OpenAI, AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

_client = OpenAI(
    api_key=os.environ["LLM_API_KEY"],
    base_url=os.environ["LLM_BASE_URL"],
    timeout=float(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
)

# 异步客户端:故事回合走异步,LLM 等待时让出事件循环,多人同时玩不互相堵(同步端点会让后一个干等)。
_aclient = AsyncOpenAI(
    api_key=os.environ["LLM_API_KEY"],
    base_url=os.environ["LLM_BASE_URL"],
    timeout=float(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
)


# ── token 用量累加 ───────────────────────────────────────────────
# 一个故事回合可能触发多次 LLM 调用(主回合 + 空白/坏-JSON 重试 + 滚动摘要 +
# 长期记忆抽取 + JSON 修复)。用 contextvar 收集器把这些调用的 usage 自动累加,
# 调用方(story_turn)只需 `with collect_usage():` 包住整段,末尾读 current_usage(),
# 不必把 usage 一路透传过每个内部函数。未开收集器时(chat.py / identify*)全程 no-op。

_usage_collector: contextvars.ContextVar = contextvars.ContextVar("usage_collector", default=None)


class _UsageAccumulator:
    def __init__(self) -> None:
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.calls = 0

    def add(self, usage) -> None:
        if usage is None:
            return
        self.prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
        self.completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
        self.total_tokens += int(getattr(usage, "total_tokens", 0) or 0)
        self.calls += 1

    def as_dict(self) -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "calls": self.calls,
        }


@contextlib.contextmanager
def collect_usage():
    """在此上下文内的所有 chat/chat_messages 调用,其 token usage 会累加进返回的累加器。"""
    acc = _UsageAccumulator()
    token = _usage_collector.set(acc)
    try:
        yield acc
    finally:
        _usage_collector.reset(token)


def current_usage() -> dict | None:
    """读取当前活动收集器的累计用量;无收集器时返回 None。"""
    acc = _usage_collector.get()
    return acc.as_dict() if acc is not None else None


# ── 离线脚本后端(评测 / 测试用)──────────────────────────────────
# 装上后,本模块所有 chat / achat 调用不走网络,改由脚本函数返回内容。
# 评测平台「离线模式」用它注入确定性的引擎输出,零 API 成本跑通全链路;
# 单元测试也用它隔离 LLM。未安装时(生产 / 真实跑)全程 no-op。
_scripted_backend: contextvars.ContextVar = contextvars.ContextVar("scripted_backend", default=None)


class _SimpleUsage:
    """脚本后端的合成 usage(按字符粗估 token),让离线模式下 usage plumbing 不为空。"""

    def __init__(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens


@contextlib.contextmanager
def scripted_backend(fn):
    """安装脚本后端。fn(kind, messages, *, model, max_tokens, json_mode) -> str。

    kind ∈ {'sync','async','stream'}。装上期间本模块不发任何真实网络请求。
    """
    token = _scripted_backend.set(fn)
    try:
        yield
    finally:
        _scripted_backend.reset(token)


def _feed_estimated_usage(messages: list[dict], out: str) -> None:
    acc = _usage_collector.get()
    if acc is None:
        return
    p = sum(len(str(m.get("content", ""))) for m in messages) // 3
    acc.add(_SimpleUsage(p, len(out) // 3))


def chat(system: str, user: str, *, model: str | None = None, max_tokens: int = 1024) -> str:
    """单轮 chat。返回 assistant 文本。"""
    return chat_messages(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=model,
        max_tokens=max_tokens,
    )


def chat_messages(messages: list[dict], *, model: str | None = None,
                  max_tokens: int = 1024, json_mode: bool = False) -> str:
    """多轮 chat,传入完整 messages 数组。角色扮演用这个保留对话历史。

    json_mode=True 时要求模型输出合法 JSON(DeepSeek/OpenAI 兼容的 response_format)。
    """
    fn = _scripted_backend.get()
    if fn is not None:
        out = fn("sync", messages, model=model, max_tokens=max_tokens, json_mode=json_mode)
        _feed_estimated_usage(messages, out)
        return out
    kwargs = {
        "model": model or os.environ["LLM_MODEL"],
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = _client.chat.completions.create(**kwargs)
    acc = _usage_collector.get()
    if acc is not None:
        acc.add(getattr(resp, "usage", None))
    return resp.choices[0].message.content


async def achat_messages(messages: list[dict], *, model: str | None = None,
                         max_tokens: int = 1024, json_mode: bool = False) -> str:
    """chat_messages 的异步版。故事回合的非流式 LLM 调用(摘要/抽取/修复/重试)走这个。"""
    fn = _scripted_backend.get()
    if fn is not None:
        out = fn("async", messages, model=model, max_tokens=max_tokens, json_mode=json_mode)
        _feed_estimated_usage(messages, out)
        return out
    kwargs = {
        "model": model or os.environ["LLM_MODEL"],
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = await _aclient.chat.completions.create(**kwargs)
    acc = _usage_collector.get()
    if acc is not None:
        acc.add(getattr(resp, "usage", None))
    return resp.choices[0].message.content


async def achat_messages_stream(messages: list[dict], *, model: str | None = None,
                                max_tokens: int = 1024, json_mode: bool = False,
                                on_delta=None) -> str:
    """流式异步 chat。逐块到达时 await on_delta(文本块),累计后返回完整文本。

    用于故事主回合:前端可逐字看叙事先冒出来。usage 靠 stream_options.include_usage 在末块返回。
    on_delta 为 None 时等价于非流式(只累计不回调),仍走流式协议拿 usage。
    """
    fn = _scripted_backend.get()
    if fn is not None:
        out = fn("stream", messages, model=model, max_tokens=max_tokens, json_mode=json_mode)
        if on_delta is not None:
            await on_delta(out)
        _feed_estimated_usage(messages, out)
        return out
    kwargs = {
        "model": model or os.environ["LLM_MODEL"],
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    parts: list[str] = []
    usage = None
    stream = await _aclient.chat.completions.create(**kwargs)
    async for chunk in stream:
        if getattr(chunk, "usage", None) is not None:
            usage = chunk.usage
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        text = getattr(delta, "content", None) if delta is not None else None
        if text:
            parts.append(text)
            if on_delta is not None:
                await on_delta(text)
    acc = _usage_collector.get()
    if acc is not None and usage is not None:
        acc.add(usage)
    return "".join(parts)


if __name__ == "__main__":
    # smoke test: python -m src.llm
    import sys
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print(chat("你是助手,用中文回答,最多三个字。", "说三个字"))
