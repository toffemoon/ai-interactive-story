import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Brush, Compass, Home, MessageCircle, MessagesSquare, UserRound } from "lucide-react";
import { NAV } from "./nav";
import ResumeBar from "./ResumeBar";
import StaggeredMenu from "../StaggeredMenu";
import PillNav from "../PillNav";
import "./shell.css";

const NAV_ICONS = {
  compass: Compass,
  chat: MessageCircle,
  brush: Brush,
  user: UserRound,
  forum: MessagesSquare,
};

const useIsMobile = (maxWidth = 720) => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${maxWidth}px)`).matches : false
  );

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const sync = () => setIsMobile(media.matches);
    sync();
    if (media.addEventListener) media.addEventListener("change", sync);
    else media.addListener(sync);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", sync);
      else media.removeListener(sync);
    };
  }, [maxWidth]);

  return isMobile;
};

// 全局导航壳:桌面用 React Bits StaggeredMenu 的半常驻 rail,手机沿用顶部 Pill Nav。
//   - 桌面静止时只显示 icon rail,鼠标经过后展开部署版完整大字菜单;点击「沐言」可固定展开。
//   - 菜单项 = nav.js 单一源(5 项);点项走 react-router navigate。
//   - chrome 配色按主题自适应:纸页(paper)用墨色,立绘主页(stage)用月白——否则浅底上看不见。
//   - 退出登录 / 账号在「我的」页内;styleguide 走 /styleguide 直链;故菜单只留 5 项,不再放 footer。
// 沉浸玩 /play:不挂任何导航 chrome(Story 自带「离开」),退出靠 ResumeBar 回带。
// /login · /styleguide 不经本壳(App 路由表里在 ShellLayout 之外),天然无菜单。
export default function AppShell({ children }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const immersive = loc.pathname.startsWith("/play");
  // 立绘主页(家):背景+立绘满铺(无纸页顶留白);其余纸页保留顶部 52px 给浮动开关留白。
  // /test/onboarding = onboarding 测试页,渲染的也是 Home,同样要满铺(否则顶部 52px 壳留白会露出棕条)。
  const atHome = loc.pathname.startsWith("/home") || loc.pathname.startsWith("/test");
  const navItems = [
    {
      label: "首页",
      ariaLabel: "回到首页",
      link: "/home",
      icon: Home,
      active: loc.pathname.startsWith("/home"),
    },
    ...NAV.map((item) => ({
      label: item.zh,
      ariaLabel: item.zh,
      link: item.to,
      icon: NAV_ICONS[item.icon],
      active: loc.pathname.startsWith(item.to),
    })),
  ];
  const activeHref = navItems.find((item) => item.active)?.link;

  if (immersive) {
    return <main className="shell-main shell-main--immersive">{children}</main>;
  }

  return (
    <div className={"shell" + (!isMobile ? " shell--semi-nav" : "") + (atHome ? " shell--home" : "")}>
      {isMobile ? (
        <header className="shell-pillnav">
          <PillNav
            items={navItems.map((item) => ({ label: item.label, href: item.link }))}
            activeHref={activeHref}
            forcePills
            initialLoadAnimation={false}
            onItemClick={(item) => navigate(item.href)}
          />
        </header>
      ) : (
        <StaggeredMenu
          isFixed
          hoverExpand
          position="left"
          brandText="沐言"
          items={navItems}
          displaySocials={false}
          displayItemNumbering
          colors={["#c79a4e", "#8f3c32"]}
          accentColor="#8f3c32"
          menuButtonColor={atHome ? "#ece3d2" : "#20201d"}
          openMenuButtonColor="#20201d"
          onItemClick={(item) => navigate(item.link)}
        />
      )}
      <main className={"shell-main" + (atHome ? " shell-main--home" : "")}>{children}</main>
      <ResumeBar />
    </div>
  );
}
