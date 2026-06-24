import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles/base.css";
import "./components/ui/ui.css";
import { AuthProvider } from "./state/auth";
import { GameProvider } from "./state/game";
import App from "./App";

// 不用 StrictMode:dev 下它会二次触发 effect,故事页的「自动开场」会重复打一次流式回合(烧 key)。
createRoot(document.getElementById("root")).render(
  <HashRouter>
    <AuthProvider>
      <GameProvider>
        <App />
      </GameProvider>
    </AuthProvider>
  </HashRouter>
);
