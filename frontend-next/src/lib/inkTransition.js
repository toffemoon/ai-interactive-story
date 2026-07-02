// 落墨入局(YOR-166):点「涟漪入局」→ 一滴 stage 暖夜底色从点击点涨圆盖满屏
// → /play 在墨层下真实挂载(transitionNav 对 /play 本就直接导航)→ 墨层淡出。
// 独立于 transitionNav 的克隆体系:纯色层无克隆、clip-path 走合成器,比常规转场更便宜;
// 语义上把「涟漪入局」这个名字兑现成一次落墨,并把首回合 LLM 等待的开头藏进转场里。
import { getLastPoint } from "./transitionNav";

export function inkInto(navigate, to = "/play") {
  let reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}
  // 减动偏好 / 已有墨层在跑(双击)→ 直接导航
  if (reduced || document.querySelector(".mu-ink")) {
    navigate(to);
    return;
  }
  const p = getLastPoint();
  const ink = document.createElement("div");
  ink.className = "mu-ink";
  if (p && p.x != null) {
    ink.style.setProperty("--ix", p.x + "px");
    ink.style.setProperty("--iy", p.y + "px");
  }
  document.body.appendChild(ink);
  navigate(to); // /play 在墨下挂载,主题翻转被墨盖住

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ink.classList.add("is-fading"); // 盖满后停 120ms 再淡出(见调用处 setTimeout)
    setTimeout(() => ink.remove(), 340);
  };
  ink.addEventListener("animationend", () => setTimeout(finish, 120), { once: true });
  setTimeout(finish, 1000); // 兜底:动画事件丢失也必清层
}
