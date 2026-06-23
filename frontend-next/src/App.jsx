import { useEffect } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
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
import Preloader from "./components/preloader";
import "./App.css";

// AUTH 关时(本地 dev)= 游客直通,不拦;AUTH 开且未登录 = 去登录。
function RequireAuth({ children }) {
  const { enabled, user } = useAuth();
  if (enabled && !user) return <Navigate to="/login" replace />;
  return children;
}

// 登录后 app 页统一挂导航壳;壳负责 Rail/tab + 浮动续玩入口,各页只放内容。
// 页面过渡用 motion 淡入(React Bits 带入的 motion):只动 opacity,不用 transform ——
// transform 会成为 fixed 后代的包含块,让页面里的 modal/入局条/ResumeBar/状态抽屉/lightbox 全部错位。
function ShellLayout() {
  const loc = useLocation();
  return (
    <AppShell>
      <motion.div
        key={loc.pathname.startsWith("/story/") ? "story-detail" : loc.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <Outlet />
      </motion.div>
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

  const home = user || !enabled ? "/explore" : "/login";

  // 冷启动 loading 用 React Bits Preloader(curtain 退出);就绪后渲染路由(YOR-32 + 细节⑥ React Bits)。
  return (
    <Preloader
      loading={!ready}
      variant="curtain"
      position="fixed"
      duration={1200}
      zIndex={300}
      bgColor="#221c16"
      loadingText="沐言"
    >
      {ready && (
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
      )}
    </Preloader>
  );
}
