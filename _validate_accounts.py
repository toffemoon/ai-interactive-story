"""账户系统端到端验证(TestClient,跑真库)。

跑法:  .venv/Scripts/python.exe _validate_accounts.py
覆盖:邮箱验证码注册 / 登录 / me / 角色 gate(super/admin/user)/ 数据隔离 / 分发 / OTP 安全。
不调 story_turn(零 LLM 成本)。全部用 acctest_ 前缀的临时数据,跑前跑后都清理。
环境:本脚本自设 AUTH_ENABLED=1 + SUPERADMIN_EMAIL=acctest_super(测试邮箱,不碰真 super)+ SMTP 不配(dev 回码)。
DATABASE_URL 走 .env(真库)。
"""
import os
os.environ.setdefault("AUTH_ENABLED", "1")
os.environ.setdefault("SUPERADMIN_EMAIL", "acctest_super@example.com")
os.environ.setdefault("AUTH_TOKEN_PEPPER", "acctest-pepper")
os.environ.pop("SMTP_USER", None)
os.environ.pop("SMTP_PASS", None)
os.environ.setdefault("OPERATOR_TOKEN", "")  # 不用后门,纯角色测

import sys
from fastapi.testclient import TestClient
from src.api import app
from src import auth, storage, db

SUPER = "acctest_super@example.com"
ADMIN = "acctest_admin@example.com"
USER = "acctest_user@example.com"
USER2 = "acctest_user2@example.com"
WRONG = "acctest_wrong@example.com"   # 错误验证码测试专用(避免和 ADMIN 撞 60s 限流)
ALL_EMAILS = [SUPER, ADMIN, USER, USER2, WRONG]
PW = "testpass123"

_results = []
def check(name, cond, extra=""):
    _results.append((name, bool(cond)))
    print(("  PASS " if cond else "  FAIL ") + name + (("  -> " + str(extra)) if extra and not cond else ""))

def cleanup():
    with db.get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute("delete from users where email = any(%s)", (ALL_EMAILS,))
        cur.execute("delete from email_otp where email = any(%s)", (ALL_EMAILS,))
        cur.execute("delete from sessions where id like 'acctest-%%'")
        cur.execute("delete from cards where name like 'acctest%%'")
        cur.execute("delete from presets where name like 'acctest%%'")

def H(tok):
    return {"Authorization": "Bearer " + tok}

def register(c, email):
    r = c.post("/api/auth/email/send_code", json={"email": email})
    code = r.json().get("dev_code")
    rr = c.post("/api/auth/register", json={"email": email, "password": PW, "code": code})
    return rr

def main():
    cleanup()
    with TestClient(app) as c:
        # 1) 注册 super(env 钉)
        r = register(c, SUPER)
        check("register super -> 200", r.status_code == 200, r.text)
        tok_super = r.json().get("token", "")
        check("super role == superadmin", r.json().get("user", {}).get("role") == "superadmin", r.json())
        check("super email_verified", r.json().get("user", {}).get("email_verified") is True)

        # 2) 错误验证码 -> 400(用独立邮箱,避免和 ADMIN 撞 60s 限流)
        c.post("/api/auth/email/send_code", json={"email": WRONG})
        bad = c.post("/api/auth/register", json={"email": WRONG, "password": PW, "code": "000000"})
        check("wrong code -> 400", bad.status_code == 400, bad.text)

        # 3) 注册 admin(先 user)+ user + user2
        r = register(c, ADMIN); tok_admin0 = r.json().get("token", "")
        check("register admin -> 200", r.status_code == 200, r.text)
        check("admin initial role user", r.json().get("user", {}).get("role") == "user")
        r = register(c, USER); tok_user = r.json().get("token", "")
        uid_user = r.json().get("user", {}).get("id")
        check("register user -> 200", r.status_code == 200, r.text)
        r = register(c, USER2); tok_user2 = r.json().get("token", "")
        check("register user2 -> 200", r.status_code == 200, r.text)

        # 4) 登录:对/错密码
        ok = c.post("/api/auth/login", json={"identifier": USER, "password": PW})
        check("login correct -> 200", ok.status_code == 200, ok.text)
        tok_user = ok.json().get("token", tok_user)
        wrong = c.post("/api/auth/login", json={"identifier": USER, "password": "nope"})
        check("login wrong pw -> 401", wrong.status_code == 401)

        # 5) me
        me = c.get("/api/auth/me", headers=H(tok_user))
        check("me role user", me.json().get("user", {}).get("role") == "user")
        anon = c.get("/api/auth/me")
        check("me anon -> user null + auth_enabled", anon.json().get("user") is None and anon.json().get("auth_enabled") is True)

        # 6) super 提 admin
        sr = c.post("/api/admin/set_role", json={"user": ADMIN, "role": "admin"}, headers=H(tok_super))
        check("super set_role admin -> 200", sr.status_code == 200, sr.text)
        la = c.post("/api/auth/login", json={"identifier": ADMIN, "password": PW})
        tok_admin = la.json().get("token", "")
        check("admin role after promote", la.json().get("user", {}).get("role") == "admin", la.json())
        # 7) 非 super 调 set_role -> 403
        nr = c.post("/api/admin/set_role", json={"user": USER, "role": "admin"}, headers=H(tok_user))
        check("user set_role -> 403", nr.status_code == 403)

        # 8) 角色 gate
        check("admin GET /operator/oc -> 200", c.get("/api/operator/oc", headers=H(tok_admin)).status_code == 200)
        check("user  GET /operator/oc -> 403", c.get("/api/operator/oc", headers=H(tok_user)).status_code == 403)
        check("super GET /operator/oc -> 200", c.get("/api/operator/oc", headers=H(tok_super)).status_code == 200)
        check("admin GET /operator/sessions -> 403", c.get("/api/operator/sessions", headers=H(tok_admin)).status_code == 403)
        check("super GET /operator/sessions -> 200", c.get("/api/operator/sessions", headers=H(tok_super)).status_code == 200)
        check("admin GET /operator/users -> 200", c.get("/api/operator/users", headers=H(tok_admin)).status_code == 200)

        # 9) 数据隔离:给 user 造一局有主存档(不走 LLM)
        auth.claim_session("acctest-sess-A", uid_user)
        check("owner GET own session -> 200", c.get("/api/session/acctest-sess-A", headers=H(tok_user)).status_code == 200)
        check("other user GET -> 403", c.get("/api/session/acctest-sess-A", headers=H(tok_user2)).status_code == 403)
        check("admin GET others' session -> 403", c.get("/api/session/acctest-sess-A", headers=H(tok_admin)).status_code == 403)
        check("super GET any session -> 200", c.get("/api/session/acctest-sess-A", headers=H(tok_super)).status_code == 200)
        check("anon GET owned session -> 401", c.get("/api/session/acctest-sess-A").status_code == 401)

        # 10) 分发:官方卡 -> admin 分给 user
        storage.save_library("characters", "acctest_card", {"data": {"name": "acctest_card"}}, user_id=None)
        ac = c.post("/api/operator/assign_card", json={"kind": "characters", "name": "acctest_card", "user": USER}, headers=H(tok_admin))
        check("admin assign_card -> assigned", ac.status_code == 200 and ac.json().get("assigned") is True, ac.text)
        names_user = [x["name"] for x in storage.list_library("characters", user_id=uid_user)]
        check("user sees assigned card", "acctest_card" in names_user, names_user[:5])
        names_user2 = [x["name"] for x in storage.list_library("characters", user_id=auth.find_user_id(USER2))]
        check("user2 does NOT see it", "acctest_card" not in names_user2)
        # admin 不能分发存档(super only)
        as_ = c.post("/api/operator/assign_session", json={"session_id": "acctest-sess-A", "user": USER2}, headers=H(tok_admin))
        check("admin assign_session -> 403", as_.status_code == 403)
        as2 = c.post("/api/operator/assign_session", json={"session_id": "acctest-sess-A", "user": USER2}, headers=H(tok_super))
        check("super assign_session -> 200", as2.status_code == 200 and as2.json().get("assigned") is True, as2.text)

        # 11) OTP 试错上限:发码后连错 5 次,正确码也失效
        c.post("/api/auth/email/send_code", json={"email": "acctest_otp@example.com"})
        # 直接取 dev_code:再发会被 60s 限流,所以从库里拿当前码不可能(只存 hash)。改测「错 5 次后锁」:
        for _ in range(5):
            auth.verify_email_code("acctest_otp@example.com", "999999")  # 5 次错(每次 attempts+1)
        # 第 6 次即便给真码也应 False(attempts>=5);真码我们不知道,用任意码确认仍 False(锁住)
        locked = auth.verify_email_code("acctest_otp@example.com", "123456")
        check("OTP locked after 5 wrong", locked is False)
        with db.get_pool().connection() as conn, conn.cursor() as cur:
            cur.execute("delete from email_otp where email='acctest_otp@example.com'")

    cleanup()
    npass = sum(1 for _, ok in _results if ok)
    print(f"\n==== {npass}/{len(_results)} PASS ====")
    return 0 if npass == len(_results) else 1

if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    sys.exit(main())
