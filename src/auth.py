"""账户系统:用户名/邮箱 + 密码登录 + 不透明 token 会话(账户系统路线图 Phase 1)。

见 decisions/2026-06-09-账户系统路线图-提案.md。

门控:AUTH_ENABLED(默认 0)。关 → 现有行为完全不变(端点不强制归属)。
开 → 登录端点生效 + 会话/卡库/预设按 user 隔离;已有归属的数据只有 owner(或 admin)能读写。

设计:
- 密码用 pbkdf2_hmac(sha256)(stdlib,无新依赖,合 requirements-deploy 轻量;不引 bcrypt/passlib)。
- token 不透明、DB-backed:登出/吊销 = 一条 UPDATE,不引 JWT/JWKS/RLS(沿用 OPERATOR_TOKEN bearer 习惯)。
  库里只存 sha256(token + pepper);原 token 只在 register/login 响应里出现一次,客户端自己存。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException

from .db import get_pool
from . import email_send

_PBKDF2_ITER = 600_000          # OWASP 2023 建议下限
_TOKEN_TTL_DAYS = 60
_OTP_TTL_MIN = 10               # 邮箱验证码有效期(分钟)
_OTP_MAX_ATTEMPTS = 5           # 单个验证码最多试几次
_ROLE_RANK = {"user": 0, "admin": 1, "superadmin": 2}


def enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


# ── 角色:super/admin/user ──────────────────────────────────────────
# superadmin 由 .env SUPERADMIN_EMAIL 钉死(保证只有一个);admin 由 super 用 set_user_role 提。
def effective_role(row) -> str:
    """按 .env SUPERADMIN_EMAIL 钉 super,否则取库里的 role 列。"""
    su = os.getenv("SUPERADMIN_EMAIL", "").strip().lower()
    email = (row["email"] or "").strip().lower() if row["email"] else ""
    if su and email == su:
        return "superadmin"
    try:
        role = row["role"]
    except (KeyError, TypeError):
        role = "user"
    return role if role in _ROLE_RANK else "user"


def role_at_least(role: str, minimum: str) -> bool:
    return _ROLE_RANK.get(role or "user", 0) >= _ROLE_RANK.get(minimum, 99)


def set_user_role(identifier: str, role: str) -> bool:
    """super 用:把某用户设成 admin / user(不能经此设 superadmin —— 那由 env 钉)。"""
    if role not in ("admin", "user"):
        raise HTTPException(400, "role 只能是 admin 或 user(superadmin 由 .env 钉死)")
    uid = find_user_id(identifier)
    if not uid:
        return False
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update users set role = %s where id = %s::uuid", (role, uid))
        return cur.rowcount > 0


# ── 密码 ────────────────────────────────────────────────────────────
def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, _PBKDF2_ITER)
    return f"pbkdf2_sha256${_PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


# ── token ───────────────────────────────────────────────────────────
def _token_hash(token: str) -> str:
    pepper = os.getenv("AUTH_TOKEN_PEPPER", "")
    return hashlib.sha256((token + pepper).encode("utf-8")).hexdigest()


def _row_to_user(r) -> dict:
    role = effective_role(r)
    return {"id": str(r["id"]), "username": r["username"], "email": r["email"],
            "display_name": r["display_name"], "role": role,
            "is_admin": role in ("admin", "superadmin"),
            "email_verified": bool(r["email_verified_at"]) if "email_verified_at" in r.keys() else True,
            "status": r["status"]}


_USER_COLS = "id, username, email, display_name, role, email_verified_at, status"


# ── 用户 CRUD / 认证 ─────────────────────────────────────────────────
def create_user(email: str, password: str, username: str | None = None,
                display_name: str | None = None, email_verified: bool = False) -> dict:
    """email 为已验证主身份(必填);username 可选(给个好记的登录名)。"""
    email = (email or "").strip().lower()
    username = (username or "").strip() or None
    if not email or "@" not in email:
        raise HTTPException(400, "邮箱不合法")
    if not password or len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select 1 from users where email = %s", (email,))
        if cur.fetchone():
            raise HTTPException(409, "邮箱已注册")
        if username:
            cur.execute("select 1 from users where username = %s", (username,))
            if cur.fetchone():
                raise HTTPException(409, "用户名已被占用")
        cur.execute(
            f"""insert into users (username, email, password_hash, display_name, email_verified_at)
               values (%s, %s, %s, %s, {('now()' if email_verified else 'null')})
               returning {_USER_COLS}""",
            (username, email, hash_password(password), display_name or username or email.split("@")[0]),
        )
        return _row_to_user(cur.fetchone())


def authenticate(identifier: str, password: str) -> dict | None:
    """identifier 可为邮箱或用户名。"""
    identifier = (identifier or "").strip()
    if not identifier or not password:
        return None
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""select {_USER_COLS}, password_hash
               from users where email = %s or username = %s limit 1""",
            (identifier.lower(), identifier),
        )
        r = cur.fetchone()
        if not r or r["status"] != "active":
            return None
        if not verify_password(password, r["password_hash"]):
            return None
        return _row_to_user(r)


def issue_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=_TOKEN_TTL_DAYS)
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into auth_tokens (token_hash, user_id, expires_at) values (%s, %s::uuid, %s)",
            (_token_hash(token), user_id, expires),
        )
    return token


def revoke_token(token: str) -> None:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "update auth_tokens set revoked_at = now() where token_hash = %s and revoked_at is null",
            (_token_hash(token),),
        )


def resolve_token(token: str) -> dict | None:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """select u.id, u.username, u.email, u.display_name, u.role, u.email_verified_at, u.status
               from auth_tokens t join users u on u.id = t.user_id
               where t.token_hash = %s and t.revoked_at is null and t.expires_at > now()""",
            (_token_hash(token),),
        )
        r = cur.fetchone()
        if not r or r["status"] != "active":
            return None
        cur.execute("update auth_tokens set last_used_at = now() where token_hash = %s",
                    (_token_hash(token),))
        return _row_to_user(r)


# ── FastAPI 取当前用户(不用 Depends 机制,端点直接调,改动最小)──────────
def _extract(authorization: str | None, x_auth_token: str | None) -> str | None:
    if x_auth_token:
        return x_auth_token.strip()
    if authorization:
        parts = authorization.strip().split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
        return authorization.strip()
    return None


def current_user(authorization: str | None = None, x_auth_token: str | None = None) -> dict | None:
    """可选取用户:无 token → None;有但无效/过期 → 401(坏 token 不该静默放行)。
    AUTH 关时:完全忽略 token(返回 None),避免遗留 token 在关闭账户时把前端卡在登录页。"""
    if not enabled():
        return None
    token = _extract(authorization, x_auth_token)
    if not token:
        return None
    user = resolve_token(token)
    if user is None:
        raise HTTPException(401, "登录已失效,请重新登录")
    return user


def authorize_session(session_id: str, user: dict | None, claim: bool = True) -> None:
    """会话归属闸(AUTH_ENABLED 时生效)。owner 命中/无主→放行;他人有主→拒。
    claim=True(玩=写)时无主存档归到当前用户;claim=False(读/删)只校验不认领,避免读别人的无主局被误认领。"""
    if not enabled():
        return
    owner = session_owner(session_id)
    if user is None:
        if owner is not None:                       # 有主存档、匿名访问 → 拒
            raise HTTPException(401, "请先登录")
        return                                       # 无主(遗留/匿名)存档 → 过渡期放行
    if owner is None:
        if claim:
            claim_session(session_id, user["id"])    # 无主 → 归到当前用户(仅玩/写时)
        return
    # 只有 superadmin 能越权访问别人的存档(admin 管内容,不偷看玩家存档)。
    if owner != user["id"] and user.get("role") != "superadmin":
        raise HTTPException(403, "无权访问该存档")


# ── 会话归属(放这里给 authorize_session 用;storage 也有同义薄封装)────────
def session_owner(session_id: str) -> str | None:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select user_id from sessions where id = %s", (session_id,))
        r = cur.fetchone()
        return str(r["user_id"]) if r and r["user_id"] else None


def list_users() -> list[dict]:
    """admin/super 用:列出所有用户(id + 用户名 + 邮箱 + 角色 + 该用户存档数)。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """select u.id, u.username, u.email, u.display_name, u.role, u.email_verified_at, u.status,
                      u.created_at,
                      (select count(*) from sessions s where s.user_id = u.id) as sessions
               from users u order by u.created_at"""
        )
        out = []
        for r in cur.fetchall():
            u = _row_to_user(r)
            u["created_at"] = str(r["created_at"])
            u["sessions"] = r["sessions"]
            out.append(u)
        return out


def find_user_id(identifier: str) -> str | None:
    """按 用户名 / 邮箱 / uuid 找 user_id(分发/迁移用)。"""
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select id from users where username = %s or email = %s or id::text = %s limit 1",
            (identifier, identifier.lower(), identifier),
        )
        r = cur.fetchone()
        return str(r["id"]) if r else None


def claim_session(session_id: str, user_id: str) -> str:
    """无主则归到 user_id;已有主则保持。返回最终 owner。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """insert into sessions (id, user_id, data) values (%s, %s::uuid, '{}'::jsonb)
               on conflict (id) do update set user_id = coalesce(sessions.user_id, excluded.user_id)
               returning user_id""",
            (session_id, user_id),
        )
        return str(cur.fetchone()["user_id"])


# ── 邮箱验证码(OTP)──────────────────────────────────────────────────
def _otp_hash(email: str, code: str) -> str:
    pepper = os.getenv("AUTH_TOKEN_PEPPER", "")
    return hashlib.sha256((email.strip().lower() + ":" + code + pepper).encode("utf-8")).hexdigest()


def send_email_code(email: str, purpose: str = "register") -> dict:
    """生成验证码 → 存 hash → 发邮件。SMTP 没配则记日志并把码回给调用方(dev_code)供本地测试。
    简单限流:同邮箱+用途 60 秒内只发一次。"""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "邮箱不合法")
    dev = os.getenv("AUTH_DEV_OTP", "") == "1"   # 仅本地测试显式开;生产绝不开
    # 生产 fail-closed:账户系统开着却没配 SMTP 且没开 dev 开关 → 拒发,绝不把码回前端。
    # (防「dev 回码」泄漏被任何人读到 → 冒名注册 superadmin 邮箱 → 接管;邮件没配也不该假装发出去)
    if not email_send.configured() and enabled() and not dev:
        raise HTTPException(503, "邮件服务未配置(SMTP),暂时无法发送验证码,请联系管理员")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select created_at from email_otp where email = %s and purpose = %s "
            "order by created_at desc limit 1",
            (email, purpose),
        )
        last = cur.fetchone()
        if last and (datetime.now(timezone.utc) - last["created_at"]).total_seconds() < 60:
            raise HTTPException(429, "验证码刚发过,请 1 分钟后再试")
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires = datetime.now(timezone.utc) + timedelta(minutes=_OTP_TTL_MIN)
        cur.execute(
            "insert into email_otp (email, code_hash, purpose, expires_at) values (%s, %s, %s, %s)",
            (email, _otp_hash(email, code), purpose, expires),
        )
    email_send.send_email(email, "你的验证码",
                          f"你的验证码是 {code},{_OTP_TTL_MIN} 分钟内有效。如非本人操作请忽略。")
    out = {"sent": True}
    if not email_send.configured() and dev:
        out["dev_code"] = code  # 仅 AUTH_DEV_OTP=1(本地测试)才回码;生产永不回
    return out


def verify_email_code(email: str, code: str, purpose: str = "register") -> bool:
    """校验最近一条验证码:未消费 + 未过期 + 未超次 + 匹配 → 标消费返回 True;否则记一次失败返回 False。"""
    email = (email or "").strip().lower()
    code = (code or "").strip()
    if not email or not code:
        return False
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, code_hash, expires_at, attempts, consumed_at from email_otp "
            "where email = %s and purpose = %s order by created_at desc limit 1",
            (email, purpose),
        )
        r = cur.fetchone()
        if not r or r["consumed_at"] is not None:
            return False
        if r["expires_at"] <= datetime.now(timezone.utc):
            return False
        if r["attempts"] >= _OTP_MAX_ATTEMPTS:
            return False
        if not hmac.compare_digest(r["code_hash"], _otp_hash(email, code)):
            cur.execute("update email_otp set attempts = attempts + 1 where id = %s", (r["id"],))
            return False
        cur.execute("update email_otp set consumed_at = now() where id = %s", (r["id"],))
        return True
