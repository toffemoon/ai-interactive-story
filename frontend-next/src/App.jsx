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
import Home from "./routes/Home";
import Styleguide from "./routes/Styleguide";
import Preloader from "./components/preloader";
import "./App.css";

// AUTH 关时(本地 dev)= 游客直通,不拦;AUTH 开且未登录 = 去登录。
function RequireAuth({ children }) {
  const { enabled, user } = useAuth();
  if (enabled && !user) return <Navigate to="/login" replace />;
  return children;
}

// 登录后 app 页统一挂导航壳;壳负责菜单 + 浮动续玩入口,各页只放内容。
// 页面过渡 = 涟漪圆形揭示(motion 动 clip-path: circle(0%→75%) + 轻 opacity)。
// 用 clip-path 不用 transform:transform 会成为 fixed 后代的包含块、让页面里的 modal/入局条/状态抽屉错位;
// clip-path 不建包含块(只是过渡中视觉裁切,导航时无浮层打开),且 circle(75%) ≈ 全覆盖任意尺寸/可滚动页,过渡后不残留裁切。
function ShellLayout() {
  const loc = useLocation();
  return (
    <AppShell>
      {/* key 变(切路由)→ 重挂 → 重跑 CSS 涟漪揭示动画。动画无 fill,结束回退到无裁切,fixed 弹层安全。 */}
      <div key={loc.pathname.startsWith("/story/") ? "story-detail" : loc.pathname} className="page-reveal">
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
    const stage = loc.pathname.startsWith("/play") || loc.pathname.startsWith("/home");
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

          {/* 登录后 app 壳(桌面 Rail / 移动 tab) */}
          <Route
            element={
              <RequireAuth>
                <ShellLayout />
              </RequireAuth>
            }
          >
            <Route path="/home" element={<Home />} />
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
