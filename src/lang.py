"""界面 / AI 输出语言(2026-10-23 中英双语)。

前端每个 /api/ 请求带 `X-Lang: en|zh`(见 frontend-next/src/lib/api.js 的 patchFetch),
api.py 的 LangMiddleware(纯 ASGI,流式响应体也在同一 context 里)把它放进 ContextVar,
引擎 / 识别 / 报错文案用 `L(en, zh)` 或 `is_zh()` 按请求取语言。缺省 en(旧缓存前端不带头)。

注意:L() 只能在请求处理期间调用。模块级常量、函数默认参数、pydantic 字段默认值在 import 时
求值一次,拿到的永远是缺省 en —— 这类地方改成调用时再取(default_factory / None 再解析)。
"""

from __future__ import annotations

import contextvars

LANGS = ("en", "zh")
DEFAULT_LANG = "en"

_lang: contextvars.ContextVar[str] = contextvars.ContextVar("ui_lang", default=DEFAULT_LANG)


def normalize(value: str | None) -> str:
    v = (value or "").strip().lower()
    return "zh" if v.startswith("zh") else "en" if v.startswith("en") else DEFAULT_LANG


def get_lang() -> str:
    return _lang.get()


def set_lang(value: str | None) -> contextvars.Token:
    return _lang.set(normalize(value))


def reset_lang(token: contextvars.Token) -> None:
    _lang.reset(token)


def is_zh() -> bool:
    return _lang.get() == "zh"


def L(en: str, zh: str) -> str:
    """按当前请求语言二选一。"""
    return zh if _lang.get() == "zh" else en


class LangMiddleware:
    """纯 ASGI 中间件:读 X-Lang 头设 ContextVar。

    不用 BaseHTTPMiddleware:它在另一个 task 里跑 call_next,StreamingResponse 的生成器
    看不到这里设的值;纯 ASGI 包一层则整个请求(含流式响应体、to_thread、create_task)都继承。
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        raw = ""
        for k, v in scope.get("headers") or []:
            if k == b"x-lang":
                raw = v.decode("latin-1")
                break
        token = set_lang(raw)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_lang(token)
