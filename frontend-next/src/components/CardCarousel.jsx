import { useEffect, useRef, useState, useCallback } from "react";
import "./CardCarousel.css";

// DOM 曲面轮播(coverflow):居中卡正面全尺寸,两侧卡缩小 + rotateY 转向 + 变暗,纵深排开。
//   - 拖动(鼠标/触屏)/ 滚轮 / 方向键 / 圆点 换居中卡;点侧卡→居中它;点居中卡→透传给卡本体(翻面/详情)。
//   - 渲染交给 renderItem(item,{active,index}),所以角色用 <Card>、扮演用角色选择卡都能复用同一轮播。
//   - 守 HANDOFF §0.5:3D transform 只作用在轮播内的卡,不包整页;详情弹窗 / 固定入局条放轮播外。
const SPACING = 128; // 相邻卡水平间距(px)
const ANGLE = 38; // 侧卡 rotateY(deg)封顶
const MIN_SCALE = 0.74;

export default function CardCarousel({ items, renderItem, activeIndex, onActiveChange, ariaLabel = "卡片轮播" }) {
  const list = items || [];
  const n = list.length;
  const [internal, setInternal] = useState(0);
  const active = activeIndex != null ? activeIndex : internal;

  const setActive = useCallback(
    (i) => {
      const clamped = Math.max(0, Math.min(n - 1, i));
      if (activeIndex == null) setInternal(clamped);
      if (onActiveChange) onActiveChange(clamped);
    },
    [n, activeIndex, onActiveChange]
  );

  const trackRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, base: 0, moved: false });
  const justDragged = useRef(false);
  const wheelLock = useRef(0);
  const [drag, setDrag] = useState(0); // 连续拖动分数(单位 = 一张卡)
  const [dragging, setDragging] = useState(false);

  // items 变少时把 active 拉回界内
  useEffect(() => {
    if (active > n - 1) setActive(n - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    dragRef.current = { down: true, startX: e.clientX, base: active, moved: false };
    setDragging(true);
    if (trackRef.current && trackRef.current.setPointerCapture) {
      try { trackRef.current.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d.down) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 4) d.moved = true;
    setDrag(-dx / SPACING);
  }
  function onPointerUp(e) {
    const d = dragRef.current;
    if (!d.down) return;
    d.down = false;
    setDragging(false);
    const target = Math.round(d.base + (-(e.clientX - d.startX) / SPACING));
    justDragged.current = d.moved;
    setDrag(0);
    setActive(target);
  }
  // 拖动刚结束的那一下 click:吞掉,别误触卡本体(翻面/详情)
  function onClickCapture(e) {
    if (justDragged.current) {
      e.stopPropagation();
      justDragged.current = false;
    }
  }
  function onWheel(e) {
    const now = e.timeStamp || 0;
    if (now - wheelLock.current < 130) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 2) return;
    wheelLock.current = now;
    setActive(active + (d > 0 ? 1 : -1));
  }
  function onKeyDown(e) {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive(active - 1); }
  }

  return (
    <div
      className={"ccz" + (dragging ? " is-dragging" : "")}
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onWheel={onWheel}
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
        {list.map((item, i) => {
          const offset = i - active + drag;
          const abs = Math.abs(offset);
          const centered = abs < 0.5;
          const scale = Math.max(MIN_SCALE, 1 - abs * 0.12);
          const rot = Math.max(-ANGLE, Math.min(ANGLE, -offset * (ANGLE / 1.4)));
          const opacity = abs > 2.5 ? 0 : Math.max(0.26, 1 - abs * 0.3);
          const style = {
            transform: `translateX(calc(-50% + ${offset * SPACING}px)) rotateY(${rot}deg) scale(${scale})`,
            opacity,
            zIndex: 100 - Math.round(abs * 10),
            pointerEvents: opacity <= 0 ? "none" : "auto",
          };
          return (
            <div
              key={i}
              className={"ccz-item" + (centered ? " is-center" : "")}
              style={style}
              onClick={() => {
                if (!centered && !justDragged.current) setActive(i);
              }}
              aria-hidden={!centered}
            >
              {renderItem(item, { active: centered, index: i })}
            </div>
          );
        })}
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
