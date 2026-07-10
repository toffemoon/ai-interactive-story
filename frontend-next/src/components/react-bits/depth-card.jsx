import { useCallback, useEffect, useRef, useState } from "react";
import "./depth-card.css";

// React Bits · DepthCard(-css 变体)适配沐言(创作台 reskin):
//   - 原版是固定像素尺寸、自带标题/图片图层的成品卡;此处改成通用 children 容器,尺寸随内容/父级。
//   - 倾角收敛到 7°(载体是文字草稿卡,不是海报),图层视差/href/移动端 UA 检测按需裁掉。
//   - spotlight 换纸面暖光(soft-light 混合),投影/圆角吃语义 token(见 depth-card.css)。
//   - 尊重 prefers-reduced-motion:关倾斜与光斑,只留静态卡。
export default function DepthCard({
  children,
  className = "",
  maxRotation = 7,
  spotlight = true,
  spotlightColor = "rgba(255, 250, 238, 0.6)",
}) {
  const cardRef = useRef(null);
  const innerRef = useRef(null);
  const spotlightRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  const targetRef = useRef({ rotateX: 0, rotateY: 0 });
  const currentRef = useRef({ rotateX: 0, rotateY: 0 });
  const rafRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync);
      else mq.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    if (reduced) return undefined;
    const lerp = (a, b, f) => a + (b - a) * f;
    const tick = () => {
      const t = targetRef.current;
      const c = currentRef.current;
      c.rotateX = lerp(c.rotateX, t.rotateX, 0.1);
      c.rotateY = lerp(c.rotateY, t.rotateY, 0.1);
      if (innerRef.current) {
        innerRef.current.style.transform = `rotateX(${c.rotateX}deg) rotateY(${c.rotateY}deg)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduced]);

  const onMove = useCallback(
    (e) => {
      if (!cardRef.current || reduced) return;
      const rect = cardRef.current.getBoundingClientRect();
      const px = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const py = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      if (spotlight && spotlightRef.current) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        spotlightRef.current.style.background = `radial-gradient(420px circle at ${x}px ${y}px, ${spotlightColor} 0%, rgba(255, 255, 255, 0.06) 45%, transparent 100%)`;
      }
      targetRef.current = { rotateX: py * -maxRotation, rotateY: px * maxRotation };
    },
    [reduced, spotlight, spotlightColor, maxRotation]
  );

  const onEnter = useCallback(() => {
    setHovered(true);
    if (spotlightRef.current) spotlightRef.current.style.opacity = "1";
  }, []);
  const onLeave = useCallback(() => {
    setHovered(false);
    targetRef.current = { rotateX: 0, rotateY: 0 };
    if (spotlightRef.current) spotlightRef.current.style.opacity = "0";
  }, []);

  return (
    <div
      ref={cardRef}
      className={"depth-card-wrapper" + (className ? " " + className : "")}
      onMouseMove={onMove}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div ref={innerRef} className={"depth-card" + (hovered ? " depth-card-hovered" : "")}>
        {children}
        {spotlight && !reduced ? (
          <div ref={spotlightRef} className="depth-card-spotlight" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
}
