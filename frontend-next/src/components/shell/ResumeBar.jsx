import { useLocation } from "react-router-dom";
import { useNavigate } from "../../lib/transitionNav";
import { useGame } from "../../state/game";

// 「继续游玩」浮动入口:有进行中故事(game 已装配在 sessionStorage)才显,
// 一键回 /play;无进行中故事不占位;已在 /play 沉浸态时不显(自己就在里面)。
// 决策:当前故事不进 tab,靠这个浮动入口回带。
// 细节①修订(YOR-168):原「只在探索悬浮」;方案 A 后登录默认落看板,
// 最需要续玩入口的页面反而看不到 → 放开到 看板+探索。看板上挪到右上
// (底部是 home-dock 主按钮区,右下会撞),探索维持右下。
export default function ResumeBar() {
  const { game } = useGame();
  const loc = useLocation();
  const navigate = useNavigate();

  if (!game) return null;
  const atHome = loc.pathname === "/home";
  if (loc.pathname !== "/explore" && !atHome) return null;

  return (
    <button
      className={"resume-bar" + (atHome ? " resume-bar--home" : "")}
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
