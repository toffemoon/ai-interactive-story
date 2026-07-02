import { useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { authApi } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui";
import "./Login.css";

export default function Login() {
  const { onAuthed, enabled } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
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
  const zhErr = (e, fallback) => (e instanceof TypeError ? "网络连不上,稍后再试" : e.message || fallback);

  async function sendCode() {
    if (sending) return;
    if (!email.trim() || email.indexOf("@") < 0) {
      setErr("先填邮箱");
      return;
    }
    setSending(true);
    setErr("");
    try {
      const d = await authApi("/api/auth/email/send_code", { email: email.trim(), purpose: "register" });
      setHint(d.dev_code ? `验证码已发(本地测试码:${d.dev_code})` : "验证码已发到邮箱,10 分钟内有效");
    } catch (e) {
      setErr(zhErr(e, "发送失败"));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (busy) return;
    if (tab === "register") {
      if (!email.trim() || email.indexOf("@") < 0) return setErr("邮箱格式不对");
      if (!code.trim()) return setErr("先填邮箱验证码");
      if (password.length < 6) return setErr("密码至少 6 位");
    }
    setBusy(true);
    setErr("");
    try {
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
      navigate("/explore");
    } catch (e) {
      setErr(zhErr(e, "失败"));
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
        <h1 className="login-title">叙事引擎</h1>
        <div className="login-en">NARRATIVE ENGINE · SIGN IN</div>

        <div className="login-tabs">
          <button className={tab === "login" ? "on" : ""} onClick={() => { setTab("login"); setErr(""); }}>
            登录 · 回到故事
          </button>
          <button className={tab === "register" ? "on" : ""} onClick={() => { setTab("register"); setErr(""); }}>
            注册 · 初次到来
          </button>
        </div>

        {tab === "login" ? (
          <>
            <input className="login-input" placeholder="邮箱或用户名" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          </>
        ) : (
          <>
            <input className="login-input" type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
            <div className="login-coderow">
              <input className="login-input" placeholder="邮箱验证码" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
              <button className="login-codebtn" disabled={sending} onClick={sendCode}>
                {sending ? "…" : "发送验证码"}
              </button>
            </div>
            <input className="login-input" placeholder="用户名(可选)" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onEnter} />
            <input className="login-input" type="password" placeholder="密码(至少 6 位)" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          </>
        )}

        {hint && <div className="login-hint">{hint}</div>}
        {err && <div className="login-err">{err}</div>}

        <Button variant="primary" full className="login-go" onClick={submit} disabled={busy}>
          {busy ? "…" : tab === "login" ? "进入" : "注册并进入"}
        </Button>

        {!enabled && (
          <button className="login-guest" onClick={() => navigate("/explore")}>
            本地未开账号 · 以游客身份进入 →
          </button>
        )}
      </div>
    </div>
  );
}
