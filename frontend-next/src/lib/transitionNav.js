// 两种「各自独立」的路由转场(按场景二选一,不组合):
//   - 扩散(进入 / 前进):目标页 .page-reveal 的 clip-path 圆从点击点(看板居中)0→150vmax 漾开,盖在旧页之上。
//   - 收拢(离开 / 返回):把「当前页」克隆一层盖在最上面,navigate 让「目标页」渲染在底下,
//       再把克隆层 clip-path 圆从 150vmax 收到 0(往点击点)→ 圆划过(圆外)的地方露出底下的目标页。
// 两者共用 0↔150vmax 圆 + var(--mu-reveal-dur) 时长 + var(--ease-out) 缓动 → 进出场手感一致,只是方向 / 谁在上相反。
// 用法:前进 navigate(to);离开 navigate(to, { transition: "contract" })。纯 CSS clip-path,不依赖 View Transitions。
import { useCallback } from "react";
import { useNavigate as useRouterNavigate } from "react-router-dom";

// 模块级记录最近指针落点 → 转场圆心(扩散原点由 ShellLayout 读;收拢圆心在此用)。
let lastPoint = { x: null, y: null };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPoint = { x: e.clientX, y: e.clientY };
    },
    true
  );
}
export function getLastPoint() {
  return lastPoint;
}

// 离开转场会抑制「下一次」目标页的扩散涟漪(由 ShellLayout 消费一次):目标页静静在底下,靠克隆层收拢露出。
let suppressNext = false;
export function consumeSuppressReveal() {
  const s = suppressNext;
  suppressNext = false;
  return s;
}

let busy = false;

function prefersReduced() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}

// 收拢离开:克隆当前页盖最上层 → navigate(目标页渲染在底下)→ 克隆层 clip-path 圆 150vmax→0 收拢,圆外露出目标页。
function leaveReveal(routerNavigate, to, cleanOpts) {
  const page = typeof document !== "undefined" ? document.querySelector(".page-reveal") : null;
  if (!page) {
    suppressNext = true;
    routerNavigate(to, cleanOpts);
    busy = false;
    return;
  }
  const rect = page.getBoundingClientRect();
  const oldTheme = document.documentElement.dataset.theme || "paper";
  const cx = lastPoint.x != null ? lastPoint.x : window.innerWidth / 2;
  const cy = lastPoint.y != null ? lastPoint.y : window.innerHeight / 2;

  // 全屏克隆层:冻结离开前主题(避免切路由后主题翻转把克隆染成新主题色),铺旧页底色 + 克隆内容。
  // clip-path 收拢由 CSS @keyframes mu-ripple-out 驱动(圆心 = --lx/--ly),append 即跑、forwards 收到 0。
  const overlay = document.createElement("div");
  overlay.className = "route-leave";
  overlay.dataset.theme = oldTheme;
  overlay.style.setProperty("--lx", cx + "px");
  overlay.style.setProperty("--ly", cy + "px");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9998",
    overflow: "hidden",
    background: "var(--bg)",
    pointerEvents: "none",
  });
  const clone = page.cloneNode(true);
  clone.style.animation = "none"; // 克隆是静态快照,别再跑扩散动画
  Object.assign(clone.style, {
    position: "absolute",
    top: rect.top + "px",
    left: rect.left + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    margin: "0",
  });
  overlay.appendChild(clone);

  suppressNext = true; // 目标页这次不自己扩散
  routerNavigate(to, cleanOpts); // 目标页渲染在克隆层底下
  document.body.appendChild(overlay); // 盖到目标页上;mu-ripple-out 立即开始收拢 → 圆外露出目标页

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    overlay.removeEventListener("animationend", cleanup);
    overlay.remove();
    busy = false;
  };
  overlay.addEventListener("animationend", cleanup);
  setTimeout(cleanup, 1300); // 兜底(时长 + buffer)
}

// 包装版 useNavigate:签名同 react-router(to, opts)。
//   opts.transition === "contract" → 收拢离开;否则前进(扩散由目标页 .page-reveal 负责)。
export function useNavigate() {
  const routerNavigate = useRouterNavigate();
  return useCallback(
    (to, opts) => {
      const contract = !!(opts && opts.transition === "contract");
      let cleanOpts = opts;
      if (opts && "transition" in opts) {
        const { transition, ...rest } = opts; // 摘掉自定义字段,不传给 react-router
        cleanOpts = rest;
      }
      // 前进 / 减动偏好 / 进行中 / 非字符串目标(后退数字)→ 直接导航,扩散交给 .page-reveal
      if (typeof to !== "string" || !contract || busy || prefersReduced()) {
        return routerNavigate(to, cleanOpts);
      }
      busy = true;
      leaveReveal(routerNavigate, to, cleanOpts);
    },
    [routerNavigate]
  );
}
