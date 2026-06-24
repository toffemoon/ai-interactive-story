// 单一导航源:桌面竖栏 Rail 与移动底部 tab 共吃这一份,根治现有
// frontend/ 里 ReconRail(5 项)/ ReconMobile MShell(5 项)两份各写一遍、易漂移的问题。
//
// 本批决策:主 tab = 探索 · 纯聊 · 创作[+] · 我的 · 论坛(5 项)。
// 「当前故事」不进 tab(不占常驻)→ 走浮动「继续游玩」入口(见 ResumeBar)。
//
// 纯数据(无 JSX),保持 .js 可直接被 Vite 解析;图标按 `icon` 名在 AppShell 内映射成内联 SVG。
export const NAV = [
  { key: "explore", to: "/explore", zh: "探索", icon: "compass" },
  { key: "chat", to: "/chat", zh: "纯聊", icon: "chat" },
  { key: "create", to: "/create", zh: "创作", icon: "brush", plus: true },
  { key: "mine", to: "/mine", zh: "我的", icon: "user" },
  { key: "forum", to: "/forum", zh: "论坛", icon: "forum" },
];
