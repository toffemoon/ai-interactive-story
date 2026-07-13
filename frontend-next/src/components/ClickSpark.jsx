import { useRef, useEffect, useCallback } from "react";

// 点击火花(改自 React Bits ClickSpark · JS+CSS 变体)。
// 原组件是「包裹 children + 容器 onClick」的局部用法;本项目内容走 document 滚动,
// 包裹会让 canvas 不跟随滚动、滚动后火花错位 → 改成全局固定铺满视口的 canvas + window 级点击监听
// (canvas pointer-events:none 不挡任何点击)。火花绘制/缓动逻辑保持原样。
export default function ClickSpark({
  sparkColor = "#c79a4e", // 赭金,纸页/暖夜两层都可见(原 '#fff' 在浅纸上看不见)
  sparkSize = 11,
  sparkRadius = 18,
  sparkCount = 8,
  duration = 480,
  easing = "ease-out",
  extraScale = 1,
}) {
  const canvasRef = useRef(null);
  const sparksRef = useRef([]);
  const rafRef = useRef(null);
  const reducedMotionRef = useRef(false);

  // 只在火花实际播放时分配画布;动画结束后缩回 1x1,避免首页空闲时常驻大块显存。
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const releaseCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  }, []);

  // 动画活跃时才跟随视口尺寸;空闲画布保持 1x1。
  useEffect(() => {
    const resize = () => {
      if (rafRef.current !== null) sizeCanvas();
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [sizeCanvas]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotionRef.current = media.matches;
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const easeFunc = useCallback(
    (t) => {
      switch (easing) {
        case "linear":
          return t;
        case "ease-in":
          return t * t;
        case "ease-in-out":
          return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default:
          return t * (2 - t);
      }
    },
    [easing]
  );

  // 事件驱动绘制:没有火花时不再安排下一帧。
  const draw = useCallback(function drawFrame(now) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    sparksRef.current = sparksRef.current.filter((s) => {
      const elapsed = now - s.startTime;
      if (elapsed >= duration) return false;
      const eased = easeFunc(elapsed / duration);
      const distance = eased * (s.radius || sparkRadius) * extraScale;
      const lineLength = (s.size || sparkSize) * (1 - eased);
      const x1 = s.x + distance * Math.cos(s.angle);
      const y1 = s.y + distance * Math.sin(s.angle);
      const x2 = s.x + (distance + lineLength) * Math.cos(s.angle);
      const y2 = s.y + (distance + lineLength) * Math.sin(s.angle);
      ctx.strokeStyle = s.color || sparkColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      return true;
    });

    if (sparksRef.current.length) {
      rafRef.current = requestAnimationFrame(drawFrame);
    } else {
      rafRef.current = null;
      releaseCanvas();
    }
  }, [sparkColor, sparkSize, sparkRadius, duration, easeFunc, extraScale, releaseCanvas]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      sparksRef.current = [];
      releaseCanvas();
    };
  }, [draw, releaseCanvas]);

  // 任意点击 → 在该点迸出一圈火花(坐标即视口坐标,与固定画布对齐)。
  useEffect(() => {
    const onClick = (e) => {
      if (reducedMotionRef.current || e.detail === 0 || sparkCount <= 0 || duration <= 0) return;
      sizeCanvas();
      const now = performance.now();
      for (let i = 0; i < sparkCount; i++) {
        sparksRef.current.push({
          x: e.clientX,
          y: e.clientY,
          angle: (2 * Math.PI * i) / sparkCount,
          startTime: now,
        });
      }
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [sparkCount, duration, draw, sizeCanvas]);

  // 定向爆发入口(创作画布完成拍等):window 派发 ais:spark,detail={x,y,count,colors[],radius,size}。
  // colors 必须是字面色值(canvas strokeStyle 解析不了 CSS var);逐火花轮换上色。
  useEffect(() => {
    const onBurst = (e) => {
      if (reducedMotionRef.current || duration <= 0) return;
      const d = e.detail || {};
      const count = d.count || 12;
      const colors = Array.isArray(d.colors) && d.colors.length ? d.colors : [sparkColor];
      sizeCanvas();
      const now = performance.now();
      for (let i = 0; i < count; i++) {
        sparksRef.current.push({
          x: d.x != null ? d.x : window.innerWidth / 2,
          y: d.y != null ? d.y : window.innerHeight / 2,
          angle: (2 * Math.PI * i) / count,
          startTime: now,
          color: colors[i % colors.length],
          radius: d.radius,
          size: d.size,
        });
      }
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw);
    };
    window.addEventListener("ais:spark", onBurst);
    return () => window.removeEventListener("ais:spark", onBurst);
  }, [duration, draw, sizeCanvas, sparkColor]);

  return (
    <canvas
      ref={canvasRef}
      width="1"
      height="1"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 200,
      }}
    />
  );
}
