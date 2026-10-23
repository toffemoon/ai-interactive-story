import { useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { authApi } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui";
import "./Login.css";

export default function Login() {
  const { onAuthed, enabled } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login"); // login | register | reset(找回密码)
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState("");

  // 网络层失败(断网/后端没起)fetch 抛英文 TypeError「Failed to fetch」,给人看中文(YOR-162);
  // HTTP 错误在 authApi 里已是中文(data.detail || 请求失败),原样透传。
  const zhErr = (e, fallback) => (e instanceof TypeError ? "Can't reach the server. Please try again later." : e.message || fallback);

  // 切 tab:清错误与提示(登录 ↔ 注册 ↔ 找回密码 互不残留)。
  const go = (t) => { setTab(t); setErr(""); setHint(""); };

  async function sendCode() {
    if (sending) return;
    if (!email.trim() || email.indexOf("@") < 0) {
      setErr("Enter your email first");
      return;
    }
    setSending(true);
    setErr("");
    try {
      // 注册用 purpose=register,找回密码用 purpose=reset(后端按用途签发/校验验证码)。
      const d = await authApi("/api/auth/email/send_code", { email: email.trim(), purpose: tab === "reset" ? "reset" : "register" });
      setHint(d.dev_code ? `Code sent (local test code: ${d.dev_code})` : "Verification code sent to your email. It's valid for 10 minutes.");
    } catch (e) {
      setErr(zhErr(e, "Failed to send"));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (busy) return;
    // 空提交别发请求:后端 401 的「邮箱/用户名或密码错误」会误导没填的人(镜像注册分支的前置校验范式)。
    if (tab === "login") {
      if (!identifier.trim()) return setErr("Enter your email or username first");
      if (!password) return setErr("Enter your password first");
    }
    if (tab === "register") {
      if (!email.trim() || email.indexOf("@") < 0) return setErr("Invalid email address");
      if (!code.trim()) return setErr("Enter the email verification code first");
      if (password.length < 6) return setErr("Password must be at least 6 characters");
    }
    if (tab === "reset") {
      if (!email.trim() || email.indexOf("@") < 0) return setErr("Invalid email address");
      if (!code.trim()) return setErr("Enter the email verification code first");
      if (password.length < 6) return setErr("New password must be at least 6 characters");
    }
    setBusy(true);
    setErr("");
    try {
      // 找回密码:重置成功后不自动登录,回登录页用新密码登(端点不返回 token,与旧前端一致)。
      if (tab === "reset") {
        await authApi("/api/auth/reset_password", { email: email.trim(), code: code.trim(), new_password: password });
        setPassword("");
        setCode("");
        setTab("login");
        setHint("Password reset. Sign in with your new password.");
        return; // finally 里 setBusy(false)
      }
      const data =
        tab === "login"
          ? await authApi("/api/auth/login", { identifier: identifier.trim(), password })
          : await authApi("/api/auth/register", {
              email: email.trim(),
              password,
              code: code.trim(),
              username: username.trim() || null,
            });
      onAuthed(data.user, data.token);
      navigate("/home"); // 方案 A:登录后落「立绘主页(家)」,与 App.jsx 根路由一致(YOR-161)
    } catch (e) {
      setErr(zhErr(e, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const onEnter = (e) => {
    if (e.key === "Enter" && !(e.nativeEvent || e).isComposing) submit();
  };

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-title">Narrative Engine</h1>
        <div className="login-en">NARRATIVE ENGINE · SIGN IN</div>

        <div className="login-tabs">
          <button className={tab === "login" ? "on" : ""} onClick={() => go("login")}>
            Sign in · Welcome back
          </button>
          <button className={tab === "register" ? "on" : ""} onClick={() => go("register")}>
            Sign up · New here
          </button>
        </div>

        {tab === "login" && (
          <>
            {/* 手机键盘会自动首字母大写/纠错,把用户名悄悄改错 → 登录必败(YOR-158) */}
            <input className="login-input" placeholder="Email or username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
            <button type="button" className="login-alt" onClick={() => go("reset")}>Forgot password?</button>
          </>
        )}

        {tab === "register" && (
          <>
            <input className="login-input" type="email" placeholder="Email" autoCapitalize="none" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <div className="login-coderow">
              {/* 数字键盘 + 系统验证码自动填充(YOR-158) */}
              <input className="login-input" placeholder="Email verification code" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
              <button className="login-codebtn" disabled={sending} onClick={sendCode}>
                {sending ? "…" : "Send code"}
              </button>
            </div>
            <input className="login-input" placeholder="Username (optional)" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder="Password (at least 6 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          </>
        )}

        {tab === "reset" && (
          <>
            {/* 找回密码:邮箱验证码(purpose=reset)+ 新密码,复用注册的输入范式(YOR-158) */}
            <input className="login-input" type="email" placeholder="Email" autoCapitalize="none" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <div className="login-coderow">
              <input className="login-input" placeholder="Email verification code" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
              <button className="login-codebtn" disabled={sending} onClick={sendCode}>
                {sending ? "…" : "Send code"}
              </button>
            </div>
            <input className="login-input" type="password" placeholder="New password (at least 6 characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
            <button type="button" className="login-alt" onClick={() => go("login")}>← Back to sign in</button>
          </>
        )}

        {hint && <div className="login-hint">{hint}</div>}
        {err && <div className="login-err">{err}</div>}

        <Button variant="primary" full className="login-go" onClick={submit} disabled={busy}>
          {busy ? "…" : tab === "login" ? "Enter" : tab === "register" ? "Sign up & enter" : "Reset password"}
        </Button>

        {!enabled && (
          <button className="login-guest" onClick={() => navigate("/home")}>
            Accounts not enabled locally · Continue as guest →
          </button>
        )}
      </div>
    </div>
  );
}
