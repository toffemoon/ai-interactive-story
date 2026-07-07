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

  // 画布跟随视口尺寸(含 DPR 清晰度)。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
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

  // 绘制循环。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf;
    const draw = (now) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparksRef.current = sparksRef.current.filter((s) => {
        const elapsed = now - s.startTime;
        if (elapsed >= duration) return false;
        const eased = easeFunc(elapsed / duration);
        const distance = eased * sparkRadius * extraScale;
        const lineLength = sparkSize * (1 - eased);
        const x1 = s.x + distance * Math.cos(s.angle);
        const y1 = s.y + distance * Math.sin(s.angle);
        const x2 = s.x + (distance + lineLength) * Math.cos(s.angle);
        const y2 = s.y + (distance + lineLength) * Math.sin(s.angle);
        ctx.strokeStyle = sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sparkColor, sparkSize, sparkRadius, duration, easeFunc, extraScale]);

  // 任意点击 → 在该点迸出一圈火花(坐标即视口坐标,与固定画布对齐)。
  useEffect(() => {
    const onClick = (e) => {
      const now = performance.now();
      for (let i = 0; i < sparkCount; i++) {
        sparksRef.current.push({
          x: e.clientX,
          y: e.clientY,
          angle: (2 * Math.PI * i) / sparkCount,
          startTime: now,
        });
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [sparkCount]);

  return (
    <canvas
      ref={canvasRef}
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
