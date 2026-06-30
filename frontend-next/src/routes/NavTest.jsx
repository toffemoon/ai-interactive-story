import { useState } from "react";
import PillNav from "../components/PillNav";
import Dock from "../components/Dock";
import "./NavTest.css";

// /test —— 手机端导航原型(D2/D5)。两摆法给 yufei 真机评估:
//   - pill 一行(顶部):米底幽灵 pill,选中朱砂,无 logo。
//   - Dock(底部):React Bits Dock,macOS 式图标坞,靠近放大(手机滑过 dock 也放大)。
//   桌面端不在本原型范围(保留现有 StaggeredMenu)。
const Icon = {
  home: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /></svg>),
  compass: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2z" /></svg>),
  chat: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></svg>),
  brush: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4l6 6L9 21H4v-5L14 4z" /><path d="m12.5 6.5 5 5" /></svg>),
  user: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></svg>),
  forum: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h13v8H8l-4 3V5z" /><path d="M20 9v9l-3-2h-6" /></svg>),
};

const ITEMS = [
  { label: "看板", href: "/home", icon: Icon.home },
  { label: "探索", href: "/explore", icon: Icon.compass },
  { label: "纯聊", href: "/chat", icon: Icon.chat },
  { label: "创作", href: "/create", icon: Icon.brush },
  { label: "我的", href: "/mine", icon: Icon.user },
  { label: "论坛", href: "/forum", icon: Icon.forum },
];

export default function NavTest() {
  const [active, setActive] = useState("/explore");
  const [variant, setVariant] = useState("dock"); // pills | dock
  const activeLabel = ITEMS.find((i) => i.href === active)?.label;

  return (
    <div className="navtest" data-theme="paper">
      {variant === "pills" && (
        <header className="navtest-top">
          <PillNav
            items={ITEMS.map((i) => ({ label: i.label, href: i.href }))}
            activeHref={active}
            forcePills
            onItemClick={(it) => setActive(it.href)}
          />
        </header>
      )}

      <div className="navtest-body">
        <div className="navtest-seg">
          <button className={variant === "pills" ? "is-on" : ""} onClick={() => setVariant("pills")}>pill 一行(顶部)</button>
          <button className={variant === "dock" ? "is-on" : ""} onClick={() => setVariant("dock")}>Dock(底部)</button>
        </div>
        <p className="navtest-hint t-ui">/test · 导航原型。当前选中:<b>{activeLabel}</b>(点 pill / dock 项只切高亮)。</p>
        <p className="navtest-note t-meta">
          「pill 一行」= 顶部米底幽灵 pill、选中朱砂;「Dock」= 底部 macOS 式图标坞,鼠标/手指靠近放大、选中朱砂。
          颜色这套贴 paper,合不合给我说。
        </p>
        <div className="navtest-card">页面内容占位 ①</div>
        <div className="navtest-card">页面内容占位 ②</div>
        <div className="navtest-card tall">往下滚 —— 看 dock 是否钉底</div>
      </div>

      {variant === "dock" && (
        <div className="navtest-dock">
          <Dock
            items={ITEMS.map((i) => ({
              icon: i.icon,
              label: i.label,
              className: i.href === active ? "is-active" : "",
              onClick: () => setActive(i.href),
            }))}
          />
        </div>
      )}
    </div>
  );
}
