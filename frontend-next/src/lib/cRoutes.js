// 已按设计画布「C 幕间」改版的页面(2026-10-25 起逐批上线):这些路由用 c 主题,并自带顶部导航(TopNav),
// 不再挂旧的侧栏 / 手机 Pill Nav;其余页面维持纸 / 台,直到各自那一批上线。
export const C_ROUTES = ["/login", "/explore", "/story", "/play", "/home", "/test/onboarding", "/chat", "/mine"];
export const isCRoute = (path) => C_ROUTES.some((p) => path === p || path.startsWith(p + "/"));
