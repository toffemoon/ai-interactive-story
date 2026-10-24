import { useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { authApi } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui";
import { applyLanguageChoice } from "../components/LanguageGate";
import { L, LANG } from "../lib/i18n";
import "./Login.css";

// 登录页(2026-10-24 改版,画布方案 02-A):左半屏书店图 + 标语逐词升起、句号处盖「沐言」印章;右半屏表单。
// 表单逻辑(登录 / 注册 / 找回密码 / 本地游客)与改版前一致,只换了结构与样式。
const SEAL = "/brand/seal-192.png";
const TAGLINE = L(["Stories,", "alive"], ["故事，", "活过来"]);
const WORD_DELAY = 0.16;
const STAMP_AT = 0.3 + (TAGLINE.length - 1) * WORD_DELAY + 0.85;

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

  const head = {
    login: [L("Welcome back", "欢迎回来"), L("Sign in to pick up your saves on any device.", "登录后,存档在任何设备上都能接着玩。")],
    register: [L("Create your account", "创建账号"), L("Sign up with your email to keep your stories.", "用邮箱注册,保存你的故事。")],
    reset: [L("Reset your password", "重置密码"), L("We'll email you a verification code.", "我们会给你的邮箱发一个验证码。")],
  }[tab];

  const codeRow = (
    <label className="login-field">
      <span>{L("Email verification code", "邮箱验证码")}</span>
      <div className="login-coderow">
        {/* 数字键盘 + 系统验证码自动填充(YOR-158) */}
        <input className="login-input" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
        <button type="button" className="login-codebtn" disabled={sending} onClick={sendCode}>
          {sending ? "…" : L("Send code", "发送验证码")}
        </button>
      </div>
    </label>
  );
  const emailField = (
    <label className="login-field">
      <span>{L("Email", "邮箱")}</span>
      <input className="login-input" type="email" autoCapitalize="none" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
    </label>
  );

  return (
    <div className="login">
      <section className="login-hero" aria-label={L("Narrative Engine", "叙事引擎")}>
        <img className="login-hero-bg" src="/brand/login-bg.jpg" alt="" />
        <div className="login-hero-shade" aria-hidden="true" />
        <img className="login-hero-seal" src={SEAL} alt="" />
        <div className="login-hero-copy">
          <p className="login-tagline">
            <span className="login-sr">{TAGLINE.join(" ")}</span>
            {TAGLINE.map((w, i) => {
              const word = (
                <span className="login-mask" aria-hidden="true">
                  <span className="login-word" style={{ animationDelay: `${(0.3 + i * WORD_DELAY).toFixed(2)}s` }}>{w}</span>
                </span>
              );
              if (i < TAGLINE.length - 1) return <span key={i}>{word}</span>;
              // 最后一个词和印章绑在一起不断行,窄屏上印章不会单独掉到下一行
              return (
                <span className="login-last" key={i}>
                  {word}
                  <span className="login-stamp" aria-hidden="true">
                    <span className="login-ink" style={{ animationDelay: `${STAMP_AT.toFixed(2)}s` }} />
                    <img className="login-stamp-seal" src={SEAL} alt="" style={{ animationDelay: `${STAMP_AT.toFixed(2)}s` }} />
                  </span>
                </span>
              );
            })}
          </p>
          <div className="login-rule" aria-hidden="true" style={{ animationDelay: `${(STAMP_AT + 0.35).toFixed(2)}s` }} />
          <p className="login-eyebrow" style={{ animationDelay: `${(STAMP_AT + 0.35).toFixed(2)}s` }}>{L("Narrative Engine", "叙事引擎")}</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form">
          <div className="login-lang" role="group" aria-label={L("Language", "语言")}>
            <button type="button" lang="en" aria-pressed={LANG === "en"} className={LANG === "en" ? "on" : ""} onClick={() => LANG !== "en" && applyLanguageChoice("en", false)}>English</button>
            <span aria-hidden="true">·</span>
            <button type="button" lang="zh" aria-pressed={LANG === "zh"} className={LANG === "zh" ? "on" : ""} onClick={() => LANG !== "zh" && applyLanguageChoice("zh", false)}>中文</button>
          </div>

          <div className="login-head">
            <h1>{head[0]}</h1>
            <p>{head[1]}</p>
          </div>

          {tab !== "reset" && (
            <div className="login-seg" role="tablist" aria-label={L("Account", "账号")}>
              <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? "on" : ""} onClick={() => go("login")}>
                {L("Sign in", "登录")}
              </button>
              <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? "on" : ""} onClick={() => go("register")}>
                {L("Sign up", "注册")}
              </button>
            </div>
          )}

          {tab === "login" && (
            <>
              <label className="login-field">
                <span>{L("Email or username", "邮箱或用户名")}</span>
                {/* 手机键盘会自动首字母大写/纠错,把用户名悄悄改错 → 登录必败(YOR-158) */}
                <input className="login-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onEnter} />
              </label>
              <div className="login-field">
                <span className="login-field-row">
                  <label htmlFor="login-password">{L("Password", "密码")}</label>
                  <button type="button" className="login-link" onClick={() => go("reset")}>{L("Forgot password?", "忘记密码?")}</button>
                </span>
                <input id="login-password" className="login-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
              </div>
            </>
          )}

          {tab === "register" && (
            <>
              {emailField}
              {codeRow}
              <label className="login-field">
                <span>{L("Username (optional)", "用户名(可选)")}</span>
                <input className="login-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onEnter} />
              </label>
              <label className="login-field">
                <span>{L("Password (at least 6 characters)", "密码(至少 6 位)")}</span>
                <input className="login-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
              </label>
            </>
          )}

          {tab === "reset" && (
            <>
              {/* 找回密码:邮箱验证码(purpose=reset)+ 新密码,复用注册的输入范式(YOR-158) */}
              {emailField}
              {codeRow}
              <label className="login-field">
                <span>{L("New password (at least 6 characters)", "新密码(至少 6 位)")}</span>
                <input className="login-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
              </label>
              <button type="button" className="login-link login-back" onClick={() => go("login")}>{L("← Back to sign in", "← 返回登录")}</button>
            </>
          )}

          {hint && <div className="login-hint">{hint}</div>}
          {err && <div className="login-err" role="alert">{err}</div>}

          <Button variant="primary" full className="login-go" onClick={submit} disabled={busy}>
            {busy ? "…" : tab === "login" ? L("Enter", "进入") : tab === "register" ? L("Sign up & enter", "注册并进入") : L("Reset password", "重置密码")}
          </Button>

          {!enabled && (
            <>
              <div className="login-or" aria-hidden="true"><span />{L("or", "或")}<span /></div>
              <button type="button" className="login-guest" onClick={() => navigate("/home")}>
                {L("Continue as guest", "以游客身份进入")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
