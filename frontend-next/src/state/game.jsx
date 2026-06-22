import { createContext, useContext, useState } from "react";
import { newSessionId } from "../lib/api";

// 当前游玩的一局:从探索点「去玩」装配好卡组 → 进 /play。
// 存 sessionStorage 让 /play 刷新可恢复(只存 characters/world/story/player 等文本,不含探索封面)。
const GameCtx = createContext(null);
const KEY = "ais_next_game";

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch (e) {
    return null;
  }
}

export function GameProvider({ children }) {
  const [game, setGame] = useState(load);

  const startGame = (deck) => {
    const g = { sessionId: newSessionId(), mode: "standard", ...deck };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(g));
    } catch (e) {}
    setGame(g);
    return g;
  };
  const clearGame = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch (e) {}
    setGame(null);
  };

  return <GameCtx.Provider value={{ game, startGame, clearGame }}>{children}</GameCtx.Provider>;
}

export const useGame = () => useContext(GameCtx);
