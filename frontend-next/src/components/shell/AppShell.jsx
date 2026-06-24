import { useLocation, useNavigate } from "react-router-dom";
import { NAV } from "./nav";
import ResumeBar from "./ResumeBar";
import StaggeredMenu from "../StaggeredMenu";
import "./shell.css";

// 全局导航壳:菜单统一用 React Bits StaggeredMenu(错层滑入侧栏),替掉旧「沐言 ☰」+ 抽屉 + 移动底 tab。
//   - 默认隐藏 + 一个唤出开关(满足「菜单默认隐藏 + 唤出按钮」决策,只是换了实现)。
//   - 菜单项 = nav.js 单一源(5 项);点项走 react-router navigate。
//   - chrome 配色按主题自适应:纸页(paper)用墨色,立绘主页(stage)用月白——否则浅底上看不见。
//   - 退出登录 / 账号在「我的」页内;styleguide 走 /styleguide 直链;故菜单只留 5 项,不再放 footer。
// 沉浸玩 /play:不挂任何导航 chrome(Story 自带「离开」),退出靠 ResumeBar 回带。
// /login · /styleguide 不经本壳(App 路由表里在 ShellLayout 之外),天然无菜单。
export default function AppShell({ children }) {
  const loc = useLocation();
  const navigate = useNavigate();

  const immersive = loc.pathname.startsWith("/play");
  // 立绘主页(家):背景+立绘满铺(无纸页顶留白);其余纸页保留顶部 52px 给浮动开关留白。
  const atHome = loc.pathname.startsWith("/home");

  if (immersive) {
    return <main className="shell-main shell-main--immersive">{children}</main>;
  }

  return (
    <div className={"shell" + (atHome ? " shell--home" : "")}>
      <StaggeredMenu
        isFixed
        position="left"
        brandText="沐言"
        items={NAV.map((it) => ({ label: it.zh, ariaLabel: it.zh, link: it.to }))}
        displaySocials={false}
        displayItemNumbering
        colors={["#c79a4e", "#8f3c32"]}
        accentColor="#8f3c32"
        menuButtonColor={atHome ? "#ece3d2" : "#20201d"}
        openMenuButtonColor="#20201d"
        onItemClick={(it) => navigate(it.link)}
      />
      <main className={"shell-main" + (atHome ? " shell-main--home" : "")}>{children}</main>
      <ResumeBar />
    </div>
  );
}
