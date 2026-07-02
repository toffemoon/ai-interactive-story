import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles/base.css";
import "./components/ui/ui.css";
import "./styles/transition-tuning.css"; // 转场精修对照 demo(YOR-166):分层时长 / tab 淡入 / 落墨入局
import { AuthProvider } from "./state/auth";
import { GameProvider } from "./state/game";
import App from "./App";
import ClickSpark from "./components/ClickSpark";

// 不用 StrictMode:dev 下它会二次触发 effect,故事页的「自动开场」会重复打一次流式回合(烧 key)。
createRoot(document.getElementById("root")).render(
  <HashRouter>
    <AuthProvider>
      <GameProvider>
        <App />
        {/* 全局点击火花(固定视口画布,不挡点击) */}
        <ClickSpark />
      </GameProvider>
    </AuthProvider>
  </HashRouter>
);
