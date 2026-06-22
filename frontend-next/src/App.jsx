import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./state/auth";
import Login from "./routes/Login";
import Explore from "./routes/Explore";
import Story from "./routes/Story";
import Styleguide from "./routes/Styleguide";
import "./App.css";

function BootSplash() {
  return (
    <div className="boot-splash">
      <div className="t-kai boot-mark">沐言</div>
      <div className="t-meta">叙事引擎载入中…</div>
    </div>
  );
}

// AUTH 关时(本地 dev)= 游客直通,不拦;AUTH 开且未登录 = 去登录。
function RequireAuth({ children }) {
  const { enabled, user } = useAuth();
  if (enabled && !user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { ready, enabled, user } = useAuth();
  const loc = useLocation();

  // 主题:当前故事 = 台(暖夜沉浸),其余 = 纸。
  useEffect(() => {
    document.documentElement.dataset.theme = loc.pathname.startsWith("/play") ? "stage" : "paper";
  }, [loc.pathname]);

  if (!ready) return <BootSplash />;

  const home = user || !enabled ? "/explore" : "/login";

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/styleguide" element={<Styleguide />} />
      <Route
        path="/explore"
        element={
          <RequireAuth>
            <Explore />
          </RequireAuth>
        }
      />
      <Route
        path="/play"
        element={
          <RequireAuth>
            <Story />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
