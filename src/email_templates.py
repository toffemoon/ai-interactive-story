"""邮件模板 —— 账户系统的邮箱验证码(注册 / 重置密码)。

一封信 = 纯文本 + HTML 两份(multipart/alternative):不显示 HTML 的客户端看纯文本,其余看排好版的那份。
语言跟请求走:前端每个 /api/ 请求带用户选的界面语言(X-Lang),这里一律用 L(en, zh) 取当下语言,
所以必须在请求处理期间调用(见 src/lang.py 的注意事项)。

HTML 按邮件客户端的老规矩写:表格布局、全部内联样式、不用外部 CSS / 脚本 / web 字体;
图片(店印)可能被客户端默认拦掉,所以有 alt,版面不依赖它。验证码是一整串数字(视觉上靠字距拉开),
复制出来就是 6 位数,不夹空格。
"""

from __future__ import annotations

import html
import os

from .lang import L, is_zh

DEFAULT_SITE_URL = "https://ai-interactive-story.onrender.com"

# 沐言 C 幕间配色(和网站同一套):夜蓝页头、橙色强调、浅色正文区(邮件里深底大段文字在部分客户端会被强行反色,正文保持浅底)。
NIGHT = "#0e1320"
ACCENT = "#f0883e"
INK = "#1f2533"
MUTED = "#5b6478"
LINE = "#e4e8f0"
PAGE = "#eef1f6"
CODE_BG = "#fff4ec"


def site_url() -> str:
    return (os.getenv("SITE_URL") or DEFAULT_SITE_URL).rstrip("/")


def _copy(purpose: str) -> dict:
    """两种用途的文案(调用时取语言)。"""
    if purpose == "reset":
        return {
            "subject": L("Muyan password reset code: {code}", "沐言重置密码验证码:{code}"),
            "title": L("Reset your password", "重置你的密码"),
            "lead": L(
                "We received a request to reset the password for your Muyan account. Enter this code on the reset page, then choose a new password.",
                "我们收到了重置沐言账号密码的请求。在重置页面输入下面的验证码,再设置新密码。",
            ),
            "not_you": L(
                "Didn't ask to reset your password? Ignore this email. Your password stays the same.",
                "如果不是你申请的,忽略这封邮件就好,你的密码不会改变。",
            ),
        }
    return {
        "subject": L("Muyan verification code: {code}", "沐言注册验证码:{code}"),
        "title": L("Welcome to Muyan Bookshop", "欢迎来到沐言书坊"),
        "lead": L(
            "You're signing up for Muyan with this email address. Enter this code on the sign-up page to confirm it's yours.",
            "你正在用这个邮箱注册沐言。在注册页面输入下面的验证码,确认这个邮箱是你的。",
        ),
        "not_you": L(
            "Didn't try to sign up? Ignore this email. No account will be created.",
            "如果不是你在注册,忽略这封邮件就好,不会创建任何账号。",
        ),
    }


def otp_email(code: str, purpose: str, ttl_min: int) -> tuple[str, str, str]:
    """验证码邮件 → (subject, text, html)。purpose: register | reset。"""
    c = _copy(purpose)
    site = site_url()
    brand = L("Muyan", "沐言")
    tagline = L("AI interactive stories", "AI 互动故事")
    validity = L(
        f"Valid for {ttl_min} minutes, and it can only be used once.",
        f"{ttl_min} 分钟内有效,只能用一次。",
    )
    never_share = L(
        "Don't share this code with anyone. Muyan staff will never ask you for it.",
        "请不要把验证码告诉任何人,沐言的工作人员不会向你索要它。",
    )
    auto_note = L(
        "This email was sent automatically. Please don't reply to it.",
        "这封邮件由系统自动发出,请不要直接回复。",
    )
    code_label = L("Your verification code", "你的验证码")

    subject = c["subject"].format(code=code)

    text = "\n".join(
        [
            c["title"],
            "",
            c["lead"],
            "",
            f"{code_label}: {code}",
            validity,
            "",
            c["not_you"],
            never_share,
            "",
            "—",
            f"{brand} · {tagline}",
            site,
            auto_note,
        ]
    )

    e = html.escape
    preheader = L(f"Your code is {code}. Valid for {ttl_min} minutes.", f"验证码 {code},{ttl_min} 分钟内有效。")
    font = (
        "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',-apple-system,'Segoe UI',Arial,sans-serif"
        if is_zh()
        else "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,'PingFang SC','Microsoft YaHei',sans-serif"
    )
    lang_attr = "zh-CN" if is_zh() else "en"

    page = f"""<!doctype html>
<html lang="{lang_attr}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">{e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:{font};">
<tr><td style="background:{NIGHT};padding:20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="{e(site)}/brand/seal-192.png" width="32" height="32" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;font-size:19px;font-weight:700;letter-spacing:2px;color:#ffffff;">{e(brand)}</td>
<td style="vertical-align:middle;padding-left:12px;font-size:13px;color:#a9b3c7;">{e(tagline)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 28px 8px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.4;font-weight:700;color:{INK};">{e(c["title"])}</h1>
<p style="margin:0;font-size:15px;line-height:1.75;color:{INK};">{e(c["lead"])}</p>
</td></tr>
<tr><td style="padding:20px 28px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{CODE_BG};border:1px solid #f7d4b8;border-radius:12px;">
<tr><td align="center" style="padding:20px 12px 6px;font-size:13px;color:{MUTED};">{e(code_label)}</td></tr>
<tr><td align="center" style="padding:0 12px 20px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:36px;line-height:1.2;font-weight:700;letter-spacing:10px;color:#1a0f05;">{e(code)}</td></tr>
</table>
<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:{MUTED};text-align:center;">{e(validity)}</p>
</td></tr>
<tr><td style="padding:24px 28px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid {LINE};">
<tr><td style="padding-top:16px;font-size:13px;line-height:1.7;color:{MUTED};">{e(c["not_you"])}<br>{e(never_share)}</td></tr>
</table>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:{font};">
<tr><td align="center" style="padding:16px 8px 0;font-size:12px;line-height:1.7;color:#8a93a6;">
<a href="{e(site)}" style="color:#8a93a6;text-decoration:underline;">{e(brand)} · {e(tagline)}</a><br>{e(auto_note)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
    return subject, text, page
