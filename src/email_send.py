"""邮件发送(Gmail SMTP)—— 账户系统邮箱验证码用。

配置(.env):
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=<gmail 地址>
  SMTP_PASS=<gmail 应用专用密码 App Password,不是登录密码>
  SMTP_FROM=<发件显示,默认同 SMTP_USER>

未配置 SMTP_USER/SMTP_PASS → **dev 模式**:不真发信,把验证码写进日志(本地测试用);
此时 send_email_code 还会把码回给调用方(dev_code),方便没配邮箱时也能跑通流程。

Gmail 备注:国内能正常收 Gmail;发信走 smtp.gmail.com:587 STARTTLS + App Password
(账号需开两步验证后生成 App Password)。
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("email")


def configured() -> bool:
    return bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def send_email(to: str, subject: str, body: str) -> None:
    """发一封纯文本邮件。SMTP 未配置 → 只记日志(dev)。发信失败抛异常。"""
    if not configured():
        log.warning("[DEV email · SMTP 未配置] to=%s | %s | %s", to, subject, body)
        return
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    pw = os.environ["SMTP_PASS"]
    sender = os.getenv("SMTP_FROM") or user

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(body)

    ctx = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as s:
        s.starttls(context=ctx)
        s.login(user, pw)
        s.send_message(msg)
