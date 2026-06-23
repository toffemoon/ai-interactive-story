import { useEffect } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./state/auth";
import AppShell from "./components/shell/AppShell";
import Login from "./routes/Login";
import Explore from "./routes/Explore";
import StoryDetail from "./routes/StoryDetail";
import Chat from "./routes/Chat";
import Create from "./routes/Create";
import Mine from "./routes/Mine";
import Forum from "./routes/Forum";
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

// 登录后 app 页统一挂导航壳;壳负责 Rail/tab + 浮动续玩入口,各页只放内容。
function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
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

      {/* 登录后 app 壳(桌面 Rail / 移动 tab) */}
      <Route
        element={
          <RequireAuth>
            <ShellLayout />
          </RequireAuth>
        }
      >
        <Route path="/explore" element={<Explore />} />
        <Route path="/story/:name" element={<StoryDetail />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/create" element={<Create />} />
        <Route path="/mine" element={<Mine />} />
        <Route path="/forum" element={<Forum />} />
        <Route path="/play" element={<Story />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
