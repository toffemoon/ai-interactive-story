import { useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { authApi } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui";
import { L } from "../lib/i18n";
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
  const zhErr = (e, fallback) => (e instanceof TypeError ? L("Can't reach the server. Please try again later.", "网络连不上,稍后再试") : e.message || fallback);

  // 切 tab:清错误与提示(登录 ↔ 注册 ↔ 找回密码 互不残留)。
  const go = (t) => { setTab(t); setErr(""); setHint(""); };

  async function sendCode() {
    if (sending) return;
    if (!email.trim() || email.indexOf("@") < 0) {
      setErr(L("Enter your email first", "先填邮箱"));
      return;
    }
    setSending(true);
    setErr("");
    try {
      // 注册用 purpose=register,找回密码用 purpose=reset(后端按用途签发/校验验证码)。
      const d = await authApi("/api/auth/email/send_code", { email: email.trim(), purpose: tab === "reset" ? "reset" : "register" });
      setHint(d.dev_code ? L(`Code sent (local test code: ${d.dev_code})`, `验证码已发(本地测试码:${d.dev_code})`) : L("Verification code sent to your email. It's valid for 10 minutes.", "验证码已发到邮箱,10 分钟内有效"));
    } catch (e) {
      setErr(zhErr(e, L("Failed to send", "发送失败")));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (busy) return;
    // 空提交别发请求:后端 401 的「邮箱/用户名或密码错误」会误导没填的人(镜像注册分支的前置校验范式)。
    if (tab === "login") {
      if (!identifier.trim()) return setErr(L("Enter your email or username first", "先填邮箱或用户名"));
      if (!password) return setErr(L("Enter your password first", "先填密码"));
    }
    if (tab === "register") {
      if (!email.trim() || email.indexOf("@") < 0) return setErr(L("Invalid email address", "邮箱格式不对"));
      if (!code.trim()) return setErr(L("Enter the email verification code first", "先填邮箱验证码"));
      if (password.length < 6) return setErr(L("Password must be at least 6 characters", "密码至少 6 位"));
    }
    if (tab === "reset") {
      if (!email.trim() || email.indexOf("@") < 0) return setErr(L("Invalid email address", "邮箱格式不对"));
      if (!code.trim()) return setErr(L("Enter the email verification code first", "先填邮箱验证码"));
      if (password.length < 6) return setErr(L("New password must be at least 6 characters", "新密码至少 6 位"));
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
        setHint(L("Password reset. Sign in with your new password.", "密码已重置,请用新密码登录"));
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
      setErr(zhErr(e, L("Something went wrong", "失败")));
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
        <h1 className="login-title">{L("Narrative Engine", "叙事引擎")}</h1>
        <div className="login-en">NARRATIVE ENGINE · SIGN IN</div>

        <div className="login-tabs">
          <button className={tab === "login" ? "on" : ""} onClick={() => go("login")}>
            {L("Sign in · Welcome back", "登录 · 回到故事")}
          </button>
          <button className={tab === "register" ? "on" : ""} onClick={() => go("register")}>
            {L("Sign up · New here", "注册 · 初次到来")}
          </button>
        </div>

        {tab === "login" && (
          <>
            {/* 手机键盘会自动首字母大写/纠错,把用户名悄悄改错 → 登录必败(YOR-158) */}
            <input className="login-input" placeholder={L("Email or username", "邮箱或用户名")} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder={L("Password", "密码")} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
            <button type="button" className="login-alt" onClick={() => go("reset")}>{L("Forgot password?", "忘记密码?")}</button>
          </>
        )}

        {tab === "register" && (
          <>
            <input className="login-input" type="email" placeholder={L("Email", "邮箱")} autoCapitalize="none" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <div className="login-coderow">
              {/* 数字键盘 + 系统验证码自动填充(YOR-158) */}
              <input className="login-input" placeholder={L("Email verification code", "邮箱验证码")} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
              <button className="login-codebtn" disabled={sending} onClick={sendCode}>
                {sending ? "…" : L("Send code", "发送验证码")}
              </button>
            </div>
            <input className="login-input" placeholder={L("Username (optional)", "用户名(可选)")} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder={L("Password (at least 6 characters)", "密码(至少 6 位)")} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          </>
        )}

        {tab === "reset" && (
          <>
            {/* 找回密码:邮箱验证码(purpose=reset)+ 新密码,复用注册的输入范式(YOR-158) */}
            <input className="login-input" type="email" placeholder={L("Email", "邮箱")} autoCapitalize="none" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <div className="login-coderow">
              <input className="login-input" placeholder={L("Email verification code", "邮箱验证码")} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
              <button className="login-codebtn" disabled={sending} onClick={sendCode}>
                {sending ? "…" : L("Send code", "发送验证码")}
              </button>
            </div>
            <input className="login-input" type="password" placeholder={L("New password (at least 6 characters)", "新密码(至少 6 位)")} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
            <button type="button" className="login-alt" onClick={() => go("login")}>{L("← Back to sign in", "← 返回登录")}</button>
          </>
        )}

        {hint && <div className="login-hint">{hint}</div>}
        {err && <div className="login-err">{err}</div>}

        <Button variant="primary" full className="login-go" onClick={submit} disabled={busy}>
          {busy ? "…" : tab === "login" ? L("Enter", "进入") : tab === "register" ? L("Sign up & enter", "注册并进入") : L("Reset password", "重置密码")}
        </Button>

        {!enabled && (
          <button className="login-guest" onClick={() => navigate("/home")}>
            {L("Accounts not enabled locally · Continue as guest →", "本地未开账号 · 以游客身份进入 →")}
          </button>
        )}
      </div>
    </div>
  );
}
