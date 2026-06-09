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

_PBKDF2_ITER = 600_000          # OWASP 2023 建议下限
_TOKEN_TTL_DAYS = 60


def enabled() -> bool:
    return os.getenv("AUTH_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


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
    return {"id": str(r["id"]), "username": r["username"], "email": r["email"],
            "display_name": r["display_name"], "is_admin": bool(r["is_admin"]),
            "status": r["status"]}


# ── 用户 CRUD / 认证 ─────────────────────────────────────────────────
def create_user(username: str, password: str, email: str | None = None,
                display_name: str | None = None) -> dict:
    username = (username or "").strip()
    email = (email or "").strip() or None
    if not username or not password:
        raise HTTPException(400, "用户名和密码不能为空")
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select 1 from users where username = %s", (username,))
        if cur.fetchone():
            raise HTTPException(409, "用户名已被占用")
        if email:
            cur.execute("select 1 from users where email = %s", (email,))
            if cur.fetchone():
                raise HTTPException(409, "邮箱已被占用")
        cur.execute(
            """insert into users (username, email, password_hash, display_name)
               values (%s, %s, %s, %s)
               returning id, username, email, display_name, is_admin, status""",
            (username, email, hash_password(password), display_name or username),
        )
        return _row_to_user(cur.fetchone())


def authenticate(identifier: str, password: str) -> dict | None:
    """identifier 可为用户名或邮箱。"""
    identifier = (identifier or "").strip()
    if not identifier or not password:
        return None
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """select id, username, email, display_name, is_admin, status, password_hash
               from users where username = %s or email = %s limit 1""",
            (identifier, identifier),
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
            """select u.id, u.username, u.email, u.display_name, u.is_admin, u.status
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
    """可选取用户:无 token → None;有但无效/过期 → 401(坏 token 不该静默放行)。"""
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
    if owner != user["id"] and not user.get("is_admin"):
        raise HTTPException(403, "无权访问该存档")


# ── 会话归属(放这里给 authorize_session 用;storage 也有同义薄封装)────────
def session_owner(session_id: str) -> str | None:
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select user_id from sessions where id = %s", (session_id,))
        r = cur.fetchone()
        return str(r["user_id"]) if r and r["user_id"] else None


def list_users() -> list[dict]:
    """运营者迁移用:列出所有用户(id + 用户名 + 邮箱 + 该用户存档数)。"""
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """select u.id, u.username, u.email, u.display_name, u.is_admin, u.created_at,
                      (select count(*) from sessions s where s.user_id = u.id) as sessions
               from users u order by u.created_at"""
        )
        return [{"id": str(r["id"]), "username": r["username"], "email": r["email"],
                 "display_name": r["display_name"], "is_admin": bool(r["is_admin"]),
                 "created_at": str(r["created_at"]), "sessions": r["sessions"]}
                for r in cur.fetchall()]


def find_user_id(identifier: str) -> str | None:
    """按 用户名 / 邮箱 / uuid 找 user_id(运营者迁移用)。"""
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select id from users where username = %s or email = %s or id::text = %s limit 1",
            (identifier, identifier, identifier),
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
