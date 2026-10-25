# -*- coding: utf-8 -*-
"""验证码邮件:src/email_templates.py 模板 + src/email_send.py 组信。

零 LLM / 零 DB / 零网络(SMTP 用假对象接住,不真发信)。两种跑法:
  .venv/Scripts/python.exe tests/test_email_templates.py   # 独立跑,全过 exit 0
  pytest tests/test_email_templates.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import email_send, email_templates  # noqa: E402
from src.lang import reset_lang, set_lang  # noqa: E402

CODE = "048213"  # 前导 0:确认按字符串原样进信,不被当数字吞掉


def render(lang: str, purpose: str):
    token = set_lang(lang)
    try:
        return email_templates.otp_email(CODE, purpose, 10)
    finally:
        reset_lang(token)


def test_language_follows_request():
    for purpose in ("register", "reset"):
        zs, zt, zh_html = render("zh", purpose)
        es, et, en_html = render("en", purpose)
        assert "沐言" in zs and "Muyan" in es
        assert '<html lang="zh-CN">' in zh_html and '<html lang="en">' in en_html
        assert "分钟内有效" in zt and "minutes" in et
        # 只出当前语言,不中英混排
        assert "verification" not in zt.lower() and "验证码" not in et


def test_code_everywhere_and_intact():
    for lang in ("zh", "en"):
        for purpose in ("register", "reset"):
            subject, text, page = render(lang, purpose)
            assert CODE in subject and CODE in text
            assert f">{CODE}</td>" in page  # 验证码格子里是一整串,复制出来不夹空格
            assert "10" in text


def test_register_and_reset_copy_differ():
    _, reg, _ = render("zh", "register")
    _, rst, _ = render("zh", "reset")
    assert "注册" in reg and "重置" in rst
    assert "不会创建任何账号" in reg and "密码不会改变" in rst
    _, reg_en, _ = render("en", "register")
    _, rst_en, _ = render("en", "reset")
    assert "sign up" in reg_en.lower() and "password" in rst_en.lower()


def test_site_url_override():
    old = os.environ.get("SITE_URL")
    os.environ["SITE_URL"] = "https://example.test/"
    try:
        _, text, page = render("en", "register")
        assert "https://example.test" in text
        assert 'src="https://example.test/brand/seal-192.png"' in page
    finally:
        if old is None:
            os.environ.pop("SITE_URL", None)
        else:
            os.environ["SITE_URL"] = old


class _FakeSMTP:
    sent = []

    def __init__(self, host, port, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        pass

    def login(self, user, pw):
        pass

    def send_message(self, msg):
        _FakeSMTP.sent.append(msg)


def test_send_builds_text_plus_html_with_brand_sender():
    saved = {k: os.environ.get(k) for k in ("SMTP_USER", "SMTP_PASS", "SMTP_FROM")}
    real_smtp = email_send.smtplib.SMTP
    os.environ.update({"SMTP_USER": "sender@example.test", "SMTP_PASS": "not-a-real-password"})
    os.environ.pop("SMTP_FROM", None)
    email_send.smtplib.SMTP = _FakeSMTP
    _FakeSMTP.sent.clear()
    token = set_lang("zh")
    try:
        subject, text, page = email_templates.otp_email(CODE, "register", 10)
        email_send.send_email("player@example.test", subject, text, html=page)
    finally:
        reset_lang(token)
        email_send.smtplib.SMTP = real_smtp
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    msg = _FakeSMTP.sent[-1]
    assert msg.get_content_type() == "multipart/alternative"
    kinds = [p.get_content_type() for p in msg.iter_parts()]
    assert kinds == ["text/plain", "text/html"]
    assert CODE in msg.get_body(("plain",)).get_content()
    assert CODE in msg.get_body(("html",)).get_content()
    assert "沐言" in str(msg["From"]) and "sender@example.test" in str(msg["From"])
    assert CODE in str(msg["Subject"])


def test_dev_mode_without_smtp_does_not_send():
    saved = {k: os.environ.pop(k, None) for k in ("SMTP_USER", "SMTP_PASS")}
    try:
        token = set_lang("en")
        try:
            subject, text, page = email_templates.otp_email(CODE, "reset", 10)
            email_send.send_email("player@example.test", subject, text, html=page)  # 只记日志,不抛
        finally:
            reset_lang(token)
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print("ok  ", t.__name__)
    print(f"{len(tests)} passed")
