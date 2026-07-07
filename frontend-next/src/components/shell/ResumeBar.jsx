import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useNavigate } from "../../lib/transitionNav";
import { useGame } from "../../state/game";

// 「继续游玩」浮动入口:有进行中故事(game 已装配在 sessionStorage)才显,
// 一键回 /play;无进行中故事不占位;已在 /play 沉浸态时不显(自己就在里面)。
// 决策:当前故事不进 tab,靠这个浮动入口回带。
// 细节①修订(YOR-168):原「只在探索悬浮」;方案 A 后登录默认落看板,
// 最需要续玩入口的页面反而看不到 → 放开到 看板+探索。看板上挪到右上
// (底部是 home-dock 主按钮区,右下会撞),探索维持右下。
// 滚到探索底部时向右收起成小把手(露脉冲圆点,仍可点),避免盖住分页「下一页」(YOR-187)。
export default function ResumeBar() {
  const { game } = useGame();
  const loc = useLocation();
  const navigate = useNavigate();
  const [retracted, setRetracted] = useState(false);

  // 只在探索界面悬浮;其他界面不显(本批细节①)。
  const onExplore = loc.pathname === "/explore";

  // 滚到底(且页面本身可滚)→ 收起,让开分页;滚上去自动展开。window 滚动 + rAF 节流。
  useEffect(() => {
    if (!game || !onExplore) return undefined;
    let raf = 0;
    const check = () => {
      raf = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight > 24; // 页面短到不用滚就不收(没东西可挡)
      const nearBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 120;
      setRetracted(scrollable && nearBottom);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check(); // 初始判定(直接落在底部时也正确)
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [game, onExplore]);

  if (!game) return null;
  const atHome = loc.pathname === "/home";
  if (loc.pathname !== "/explore" && !atHome) return null;

  return (
    <button
      className={"resume-bar" + (atHome ? " resume-bar--home" : "") + (retracted ? " is-retracted" : "")}
      onClick={() => navigate("/play")}
      aria-label="继续游玩当前故事"
    >
      <span className="resume-bar-dot" aria-hidden="true" />
      <span className="resume-bar-tx">
        <span className="resume-bar-label t-meta">继续游玩</span>
        <span className="resume-bar-title t-kai">{game.title || "当前故事"}</span>
      </span>
      <span className="resume-bar-arrow" aria-hidden="true">→</span>
    </button>
  );
}
