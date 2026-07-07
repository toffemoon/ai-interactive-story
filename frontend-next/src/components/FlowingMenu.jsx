import React, { useMemo, useRef } from "react";
import { gsap } from "gsap";
import "./FlowingMenu.css";

// React Bits · Flowing Menu(本地 vendored,适配沐言:文字流动带、吃 token、加触摸触发)。
// 每行 hover / 触摸 → 从最近边缘划入一条朱砂带,带内文字横向滚(CSS)。
// 手机无 hover,用 onTouchStart 触发划入(点了再 onClick 跳转)。
export default function FlowingMenu({ items = [], onItemClick }) {
  return (
    <div className="menu-wrap">
      <nav className="menu">
        {items.map((it, i) => (
          <MenuRow key={it.href || i} item={it} onItemClick={onItemClick} />
        ))}
      </nav>
    </div>
  );
}

function MenuRow({ item, onItemClick }) {
  const itemRef = useRef(null);
  const marqueeRef = useRef(null);
  const innerRef = useRef(null);
  const defaults = { duration: 0.6, ease: "expo" };

  // 到「上中点 / 下中点」的距离,判光标/触点离哪条边近 → 带从那边划入。
  const closestEdge = (mx, my, w, h) => {
    const dTop = (mx - w / 2) ** 2 + my ** 2;
    const dBot = (mx - w / 2) ** 2 + (my - h) ** 2;
    return dTop < dBot ? "top" : "bottom";
  };
  const reveal = (cx, cy) => {
    const el = itemRef.current, mq = marqueeRef.current, inner = innerRef.current;
    if (!el || !mq || !inner) return;
    const r = el.getBoundingClientRect();
    const edge = closestEdge(cx - r.left, cy - r.top, r.width, r.height);
    gsap.timeline({ defaults })
      .set(mq, { y: edge === "top" ? "-101%" : "101%" }, 0)
      .set(inner, { y: edge === "top" ? "101%" : "-101%" }, 0)
      .to([mq, inner], { y: "0%" }, 0);
  };
  const hide = (cx, cy) => {
    const el = itemRef.current, mq = marqueeRef.current, inner = innerRef.current;
    if (!el || !mq || !inner) return;
    const r = el.getBoundingClientRect();
    const edge = closestEdge(cx - r.left, cy - r.top, r.width, r.height);
    gsap.timeline({ defaults })
      .to(mq, { y: edge === "top" ? "-101%" : "101%" }, 0)
      .to(inner, { y: edge === "top" ? "101%" : "-101%" }, 0);
  };

  const strip = useMemo(
    () => Array.from({ length: 8 }).map((_, i) => <span key={i}>{item.text}</span>),
    [item.text]
  );

  return (
    <div className="menu__item" ref={itemRef}>
      <a
        className="menu__item-link"
        href={"#" + item.href}
        onMouseEnter={(e) => reveal(e.clientX, e.clientY)}
        onMouseLeave={(e) => hide(e.clientX, e.clientY)}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) reveal(t.clientX, t.clientY); }}
        onClick={(e) => { if (onItemClick) { e.preventDefault(); onItemClick(item); } }}
      >
        {item.text}
      </a>
      <div className="marquee" ref={marqueeRef}>
        <div className="marquee__inner-wrap" ref={innerRef}>
          <div className="marquee__inner" aria-hidden="true">
            <div className="marquee__part">{strip}</div>
            <div className="marquee__part">{strip}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
