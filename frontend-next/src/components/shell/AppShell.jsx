import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { NAV } from "./nav";
import { useAuth } from "../../state/auth";
import ResumeBar from "./ResumeBar";
import "./shell.css";

// 内联图标(描边风,吃 currentColor),按 nav.js 的 icon 名映射。视觉沿用 ReconRail 的细描边语言。
const ICONS = {
  compass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 5h16v11H9l-4 4z" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-4 3.4-6 7-6s7 2 7 6" />
    </svg>
  ),
  forum: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 5h13v9H9l-3 3v-3H4z" />
      <path d="M8 9h6M8 12h4" />
    </svg>
  ),
};

const MENU_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="18" height="18">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="18" height="18">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// 全局导航壳:桌面左竖栏 Rail / 移动底部 tab 二合一(响应式单组件,断点 ≤720 由 shell.css 切)。
// 本批决策:菜单默认隐藏 + 一个唤出/收起按钮(全局);过渡先用纯 CSS,拿到 React Bits license 再换。
// 沉浸玩 /play:彻底隐导航(Story 自带「离开」),退出靠 ResumeBar 回带。
export default function AppShell({ children }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const { user, enabled, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const immersive = loc.pathname.startsWith("/play");
  // 立绘主页(家):背景+立绘满铺(无纸页顶留白),但保留浮动唤出菜单 + 抽屉(第三种壳形态)。
  const atHome = loc.pathname.startsWith("/home");

  // 切路由后收起菜单(「唤出 → 选 → 收起」语义;默认隐藏)。
  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  // 菜单展开时:Esc 收起。
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 沉浸态:不挂任何导航 chrome,整屏交给故事界面。
  if (immersive) {
    return <main className="shell-main shell-main--immersive">{children}</main>;
  }

  return (
    <div className="shell" data-open={open ? "true" : "false"}>
      {/* 唤出/收起按钮(全局常驻;折叠态兼作品牌标) */}
      <button
        className="shell-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "收起菜单" : "唤出菜单"}
        aria-expanded={open}
      >
        <span className="shell-toggle-mark t-kai">沐言</span>
        <span className="shell-toggle-ico">{open ? CLOSE_ICON : MENU_ICON}</span>
      </button>

      {/* 抓背景:点击收起菜单 */}
      <div className="shell-scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <nav className="shell-nav" aria-label="主导航">
        {/* 品牌点击回「家」/home(本批立绘主页) */}
        <button className="shell-brand" onClick={() => navigate("/home")} aria-label="回到首页">
          {/* logo 先留空:占位框 + 文字「沐言」(资产待 Monika 出) */}
          <span className="shell-logo-box" aria-hidden="true" />
          <span className="shell-brand-name t-kai">沐言</span>
        </button>

        <ul className="shell-navlist">
          {NAV.map((it) => (
            <li key={it.key} className="shell-navli">
              <NavLink
                to={it.to}
                className={({ isActive }) => "shell-navitem" + (isActive ? " is-active" : "")}
              >
                <span className="shell-navitem-ico">{ICONS[it.icon]}</span>
                <span className="shell-navitem-zh">{it.zh}</span>
                {it.plus && <span className="shell-navitem-plus" aria-hidden="true">＋</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="shell-foot">
          {enabled && user ? (
            <>
              <span className="shell-user t-ui-sm">{user.display_name || user.username}</span>
              <button
                className="shell-foot-btn t-ui-sm"
                onClick={() => logout().then(() => navigate("/login"))}
              >
                退出
              </button>
            </>
          ) : (
            <span className="shell-user t-ui-sm">游客</span>
          )}
          <NavLink to="/styleguide" className="shell-foot-link t-meta">
            styleguide
          </NavLink>
        </div>
      </nav>

      <main className={"shell-main" + (atHome ? " shell-main--home" : "")}>{children}</main>
      <ResumeBar />
    </div>
  );
}
