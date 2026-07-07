import { useEffect, useLayoutEffect, useRef } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { getLastPoint, consumeSuppressReveal } from "./lib/transitionNav";
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
import Home from "./routes/Home";
import Styleguide from "./routes/Styleguide";
import NavTest from "./routes/NavTest";
import Preloader from "./components/preloader";
import "./App.css";

// AUTH 关时(本地 dev)= 游客直通,不拦;AUTH 开且未登录 = 去登录。
function RequireAuth({ children }) {
  const { enabled, user } = useAuth();
  if (enabled && !user) return <Navigate to="/login" replace />;
  return children;
}

// 登录后 app 页统一挂导航壳;壳负责菜单 + 浮动续玩入口,各页只放内容。
// 进入 / 前进 = 目标页「扩散」涟漪(.page-reveal,原点 = 点击点,看板居中);
// 离开 / 返回 = curtain「收拢」(transitionNav,navigate 传 {transition:"contract"}),并抑制本次目标页扩散。
function ShellLayout() {
  const loc = useLocation();
  const revealRef = useRef(null);
  const revealKey = loc.pathname.startsWith("/story/") ? "story-detail" : loc.pathname;

  // 新页挂载、首帧前:离开转场则跳过扩散(curtain 已收拢满盖、随后淡出);否则把涟漪原点设到点击处(看板居中)。
  useLayoutEffect(() => {
    const el = revealRef.current;
    if (!el) return;
    if (consumeSuppressReveal()) {
      el.style.animation = "none"; // 离开:目标页不扩散(避免「先收拢又扩散」)
      return;
    }
    const home = revealKey === "/home";
    const p = getLastPoint();
    if (!home && p && p.x != null) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--ripple-x", p.x - rect.left + "px");
      el.style.setProperty("--ripple-y", p.y - rect.top + "px");
    } else {
      el.style.removeProperty("--ripple-x");
      el.style.removeProperty("--ripple-y");
    }
  }, [revealKey]);

  return (
    <AppShell>
      {/* key 变(切路由)→ 重挂 → 重跑扩散涟漪(离开转场时被抑制)。 */}
      <div key={revealKey} ref={revealRef} className="page-reveal">
        <Outlet />
      </div>
    </AppShell>
  );
}

export default function App() {
  const { ready, enabled, user } = useAuth();
  const loc = useLocation();

  // 主题:当前故事 + 立绘主页 = 台(暖夜沉浸),其余 = 纸。
  useEffect(() => {
    const stage = loc.pathname.startsWith("/play") || loc.pathname.startsWith("/home") || loc.pathname.startsWith("/test");
    document.documentElement.dataset.theme = stage ? "stage" : "paper";
  }, [loc.pathname]);

  // 登录后默认落「立绘主页(家)」/home(原落 /explore,本批方案 A 翻案;探索退进菜单 + 首页主按钮直达)。
  const home = user || !enabled ? "/home" : "/login";

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
          <Route path="/test" element={<NavTest />} />

          {/* 登录后 app 壳(桌面 Rail / 移动 tab) */}
          <Route
            element={
              <RequireAuth>
                <ShellLayout />
              </RequireAuth>
            }
          >
            <Route path="/home" element={<Home />} />
            <Route path="/test" element={<Home testMode />} />
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
