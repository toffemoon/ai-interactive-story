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
    setState((s) => ({ ...s, user }));
  };
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {}
    setToken("");
    setState((s) => ({ ...s, user: null }));
  };

  return <AuthCtx.Provider value={{ ...state, onAuthed, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
