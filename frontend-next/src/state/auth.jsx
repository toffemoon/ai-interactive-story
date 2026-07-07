import { createContext, useContext, useEffect, useState } from "react";
import { setToken } from "../lib/api";

// 账户态:开局查 /api/auth/me —— AUTH 是否开 + 当前用户。瞬时 5xx 重试 3 次再定论。
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ready: false, enabled: false, user: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("/api/auth/me");
          if (r.status === 401) {
            setToken("");
            if (alive) setState({ ready: true, enabled: true, user: null });
            return;
          }
          if (r.ok) {
            const d = await r.json();
            if (alive) setState({ ready: true, enabled: !!d.auth_enabled, user: d.user || null });
            return;
          }
        } catch (e) {}
        await new Promise((res) => setTimeout(res, 500 * (i + 1)));
      }
      if (alive) setState({ ready: true, enabled: false, user: null });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onAuthed = (user, token) => {
    setToken(token);
    // 登录成功本身就证明 AUTH 开着:同时置 enabled:true,否则冷启动 /api/auth/me 三次失败后
    // enabled 停在 false,登录成功也被全站(enabled && user)当游客(YOR-185)。
    setState((s) => ({ ...s, enabled: true, user }));
  };
  // 局部更新当前用户(改昵称/头像后回写 context,避免 Mine 重挂时被陈旧 user 盖回,YOR-186)。
  const patchUser = (patch) =>
    setState((s) => ({ ...s, user: s.user ? { ...s.user, ...patch } : patch }));
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {}
    setToken("");
    setState((s) => ({ ...s, user: null }));
  };

  return <AuthCtx.Provider value={{ ...state, onAuthed, logout, patchUser }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
