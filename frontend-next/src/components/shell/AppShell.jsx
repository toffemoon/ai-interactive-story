import { useEffect, useState } from "react";
import { useLocation, useNavigate as useRouterNavigate } from "react-router-dom";
import { NAV } from "./nav";
import ResumeBar from "./ResumeBar";
import StaggeredMenu from "../StaggeredMenu";
import PillNav from "../PillNav";
import "./shell.css";

// 全局导航壳:
//   - 手机(≤720)= 顶部 Pill Nav 一行(米底幽灵 pill,选中朱砂;挤了横滑)。直达 6 入口,不用抽屉。
//   - 桌面(≥721)= StaggeredMenu 错层侧栏(保持原样)。
//   - 沉浸玩 /play:不挂任何 chrome(Story 自带「离开」),退出靠 ResumeBar。
//   单一导航源 nav.js(看板 + NAV 5 项)。
function useIsMobile(maxWidth = 720) {
  const [m, setM] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(`(max-width: ${maxWidth}px)`).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setM(mq.matches);
    update();
    mq.addEventListener ? mq.addEventListener("change", update) : mq.addListener(update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", update) : mq.removeListener(update);
      window.removeEventListener("resize", update);
    };
  }, [maxWidth]);
  return m;
}

const PILL_ITEMS = [{ label: "看板", href: "/home" }, ...NAV.map((it) => ({ label: it.zh, href: it.to }))];

export default function AppShell({ children }) {
  const loc = useLocation();
  const routerNavigate = useRouterNavigate();
  const isMobile = useIsMobile(720);

  // tab 平级切换降级(YOR-166 demo):不走 transitionNav 的全屏涟漪克隆,
  // 打一个 html.mu-nav-tab 标记让 .page-reveal 换 240ms 轻淡入(transition-tuning.css),
  // 涟漪留给「跨界」时刻(主动线前进 / 收敛返回 / 落墨入局)。
  const navTab = (href) => {
    document.documentElement.classList.add("mu-nav-tab");
    routerNavigate(href);
    setTimeout(() => document.documentElement.classList.remove("mu-nav-tab"), 350);
  };

  const immersive = loc.pathname.startsWith("/play");
  // 立绘主页(家):背景 + 立绘满铺(无纸页顶留白)。
  const atHome = loc.pathname.startsWith("/home");

  if (immersive) {
    return <main className="shell-main shell-main--immersive">{children}</main>;
  }

  // 当前顶层路由 → 高亮对应 pill(/story/* 这类无对应项则不高亮)。
  const seg = "/" + (loc.pathname.split("/")[1] || "home");
  const activeHref = PILL_ITEMS.some((i) => i.href === seg) ? seg : null;

  return (
    <div className={"shell" + (atHome ? " shell--home" : "")}>
      {isMobile ? (
        <header className="shell-pillnav">
          <PillNav
            items={PILL_ITEMS}
            activeHref={activeHref}
            forcePills
            initialLoadAnimation={false}
            onItemClick={(it) => navTab(it.href)}
          />
        </header>
      ) : (
        <StaggeredMenu
          isFixed
          position="left"
          brandText="沐言"
          items={[
            { label: "看板", ariaLabel: "回到看板", link: "/home" },
            ...NAV.map((it) => ({ label: it.zh, ariaLabel: it.zh, link: it.to })),
          ]}
          displaySocials={false}
          displayItemNumbering
          colors={["#c79a4e", "#8f3c32"]}
          accentColor="#8f3c32"
          menuButtonColor={atHome ? "#ece3d2" : "#20201d"}
          openMenuButtonColor="#20201d"
          onItemClick={(it) => navTab(it.link)}
        />
      )}
      <main className={"shell-main" + (atHome ? " shell-main--home" : "")}>{children}</main>
      <ResumeBar />
    </div>
  );
}
