import { useLocation } from "react-router-dom";
import { useNavigate } from "../../lib/transitionNav";
import { useGame } from "../../state/game";

// 「继续游玩」浮动入口(全局):有进行中故事(game 已装配在 sessionStorage)才显,
// 一键回 /play;无进行中故事不占位;已在 /play 沉浸态时不显(自己就在里面)。
// 决策:当前故事不进 tab,靠这个浮动入口回带。
export default function ResumeBar() {
  const { game } = useGame();
  const loc = useLocation();
  const navigate = useNavigate();

  if (!game) return null;
  // 只在探索界面悬浮;其他界面不显(本批细节①)。
  if (loc.pathname !== "/explore") return null;

  return (
    <button className="resume-bar" onClick={() => navigate("/play")} aria-label="继续游玩当前故事">
      <span className="resume-bar-dot" aria-hidden="true" />
      <span className="resume-bar-tx">
        <span className="resume-bar-label t-meta">继续游玩</span>
        <span className="resume-bar-title t-kai">{game.title || "当前故事"}</span>
      </span>
      <span className="resume-bar-arrow" aria-hidden="true">→</span>
    </button>
  );
}
