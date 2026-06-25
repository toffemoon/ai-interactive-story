import { useEffect, useRef, useState, useCallback } from "react";
import "./CardCarousel.css";

// 模拟 React Bits CircularGallery(bend=0)的效果,但用 DOM + 保留我们的 <Card>:
//   - 平铺横排(不转角度)+ RAF 平滑惯性滚动(lerp 缓动逼近 target)+ 卡片随滚动速度起微浪(静止则平)。
//   - 拖动(鼠标/触屏)/ 滚轮 / 方向键 / 圆点 / 点侧卡 换卡,松手后 snap 到最近一张(= 居中/选中)。
//   - 渲染交给 renderItem(item,{active,index}),角色用 <Card>、扮演用选择卡复用同一轮播。
//   - 全程无 rotateY / 无 preserve-3d → 不碰翻面 3D 命中坑;详情弹窗/固定入局条放轮播外。
const SPACING = 198; // 相邻卡水平间距(px)
const EASE = 0.09; // lerp 缓动(越小越顺滑)
const WAVE_AMP = 16; // 微浪振幅(px),乘滚动速度 → 静止平、滚动起伏

export default function CardCarousel({ items, renderItem, activeIndex, onActiveChange, ariaLabel = "卡片轮播" }) {
  const list = items || [];
  const n = list.length;
  const [internal, setInternal] = useState(0);
  const active = activeIndex != null ? activeIndex : internal;

  const setActive = useCallback(
    (i) => {
      const clamped = Math.max(0, Math.min(n - 1, i));
      scroll.current.target = clamped; // 立即设滚动目标(命令式,不只靠 [active] 副作用)→ RAF 缓动逼近
      if (activeIndex == null) setInternal(clamped);
      if (onActiveChange) onActiveChange(clamped);
    },
    [n, activeIndex, onActiveChange]
  );

  const trackRef = useRef(null);
  const rootRef = useRef(null);
  const itemRefs = useRef([]);
  const scroll = useRef({ current: 0, target: 0, last: 0 });
  const drag = useRef({ down: false, startX: 0, base: 0, moved: false });
  const justDragged = useRef(false);
  const rafRef = useRef(0);
  const settleRef = useRef(0);
  const setActiveRef = useRef(setActive);
  setActiveRef.current = setActive; // 给 native 监听用最新的 setActive,避免闭包过期

  // active(外部控制 / 点击 / 键盘 / snap)→ 设滚动目标,RAF 缓动逼近。
  useEffect(() => {
    scroll.current.target = active;
  }, [active]);

  // RAF 动画:current 缓动逼近 target;按 offset 平铺 translateX + 速度微浪 translateY。
  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const s = scroll.current;
      s.current += (s.target - s.current) * EASE;
      if (Math.abs(s.target - s.current) < 0.0004) s.current = s.target;
      const speed = s.current - s.last;
      s.last = s.current;
      const absSpeed = Math.min(1, Math.abs(speed) * 5);
      for (let i = 0; i < n; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const offset = i - s.current;
        const abs = Math.abs(offset);
        const x = offset * SPACING;
        const y = Math.sin(offset * 2.4 + s.current * 2.2) * WAVE_AMP * absSpeed;
        const scaleV = Math.max(0.9, 1 - Math.min(abs, 4) * 0.035);
        const op = abs > 3.4 ? 0 : Math.max(0.4, 1 - Math.min(abs, 4) * 0.16);
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scaleV})`;
        el.style.opacity = String(op);
        el.style.zIndex = String(100 - Math.round(abs * 10));
        el.style.pointerEvents = op <= 0 ? "none" : "auto";
        el.classList.toggle("is-center", abs < 0.5);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [n]);

  // 拖动/滚轮后稳一下 → snap 到最近一张 → 提交 active。
  function scheduleSnap() {
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const snapped = Math.max(0, Math.min(n - 1, Math.round(scroll.current.target)));
      scroll.current.target = snapped;
      setActive(snapped);
    }, 150);
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    // 不在 down 里 setPointerCapture:否则纯点击(没拖)也被轨道捕获,卡本体的 click(翻面/详情)收不到。
    drag.current = { down: true, startX: e.clientX, base: scroll.current.target, moved: false, pointerId: e.pointerId };
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true; // 真拖起来了才捕获指针(拖出元素也不丢轨迹)
      if (trackRef.current && trackRef.current.setPointerCapture) {
        try { trackRef.current.setPointerCapture(d.pointerId); } catch (_) {}
      }
    }
    if (d.moved) {
      scroll.current.target = Math.max(-0.4, Math.min(n - 0.6, d.base - dx / SPACING));
    }
  }
  function onPointerUp() {
    const d = drag.current;
    if (!d.down) return;
    d.down = false;
    justDragged.current = d.moved;
    if (d.moved) scheduleSnap(); // 纯点击不 snap、不吞 click → 留给卡本体翻面/详情
  }
  // 拖动刚结束那一下 click:吞掉,别误触卡本体。
  function onClickCapture(e) {
    if (justDragged.current) {
      e.stopPropagation();
      justDragged.current = false;
    }
  }
  // 滚轮控制卡片切换,限定在轮播这块「固定区域」:native 非 passive 监听 + preventDefault,
  // 不让页面跟着上下滚(React 的 onWheel 是 passive,preventDefault 无效 → 必须 native 监听)。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      const dd = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(dd) < 2) return;
      const cur = Math.round(scroll.current.target);
      const next = Math.max(0, Math.min(n - 1, cur + (dd > 0 ? 1 : -1)));
      if (next === cur) return; // 到头了:不拦截,让页面正常滚过去(卡少时不憋着 / 缩小"固定区域"的感知)
      e.preventDefault(); // 还有卡可切才拦,不带动页面
      scroll.current.target = next;
      clearTimeout(settleRef.current);
      settleRef.current = setTimeout(() => setActiveRef.current(next), 140);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [n]);
  function onKeyDown(e) {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive(active - 1); }
  }

  return (
    <div
      className="ccz"
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClickCapture={onClickCapture}
    >
      <div
        className="ccz-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {list.map((item, i) => (
          <div
            key={i}
            ref={(el) => (itemRefs.current[i] = el)}
            className="ccz-item"
            onClick={() => {
              if (i !== active && !justDragged.current) setActive(i);
            }}
          >
            {renderItem(item, { active: i === active, index: i })}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="ccz-dots">
          {list.map((_, i) => (
            <button
              key={i}
              type="button"
              className={"ccz-dot" + (i === active ? " is-on" : "")}
              aria-label={"第 " + (i + 1) + " 张"}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
