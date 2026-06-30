import { useState } from "react";
import PillNav from "../components/PillNav";
import FlowingMenu from "../components/FlowingMenu";
import "./NavTest.css";

// /test —— 手机端顶部导航原型(D2/D5)。两摆法给 yufei 真机评估:
//   - pill 一行(横滑):配色改贴 paper(米底幽灵 pill,选中朱砂),去掉「沐」标。
//   - 汉堡 → Flowing Menu:点汉堡开全屏流动菜单(React Bits Flowing Menu,触摸/hover 划入朱砂带、文字横滚)。
//   桌面端不在本原型范围(保留现有 StaggeredMenu)。
const ITEMS = [
  { label: "看板", href: "/home" },
  { label: "探索", href: "/explore" },
  { label: "纯聊", href: "/chat" },
  { label: "创作", href: "/create" },
  { label: "我的", href: "/mine" },
  { label: "论坛", href: "/forum" },
];

export default function NavTest() {
  const [active, setActive] = useState("/explore");
  const [variant, setVariant] = useState("flowing"); // pills | flowing
  const [menuOpen, setMenuOpen] = useState(false);
  const activeLabel = ITEMS.find((i) => i.href === active)?.label;

  return (
    <div className="navtest" data-theme="paper">
      <header className="navtest-top">
        {variant === "pills" ? (
          <PillNav
            items={ITEMS.map((i) => ({ label: i.label, href: i.href }))}
            activeHref={active}
            forcePills
            onItemClick={(it) => setActive(it.href)}
          />
        ) : (
          <div className="navtest-bar">
            <button className="navtest-burger" aria-label="打开菜单" onClick={() => setMenuOpen(true)}>
              <span /><span /><span />
            </button>
            <span className="navtest-bar-active t-kai">{activeLabel}</span>
          </div>
        )}
      </header>

      <div className="navtest-body">
        <div className="navtest-seg">
          <button className={variant === "pills" ? "is-on" : ""} onClick={() => setVariant("pills")}>pill 一行(横滑)</button>
          <button className={variant === "flowing" ? "is-on" : ""} onClick={() => setVariant("flowing")}>汉堡 → Flowing Menu</button>
        </div>
        <p className="navtest-hint t-ui">
          /test · 顶部导航原型(去「沐」标 + pill 配色改贴 paper)。当前选中:<b>{activeLabel}</b>。
        </p>
        <p className="navtest-note t-meta">
          「pill 一行」= 米底幽灵 pill、选中朱砂;「汉堡 → Flowing Menu」= 点汉堡开全屏流动菜单(每行触摸/hover 划入朱砂带、文字横滚)。
          手机没 hover,加了触摸触发:点行会先划带再跳。
        </p>
        <div className="navtest-card">页面内容占位 ①</div>
        <div className="navtest-card tall">往下滚 —— 看顶栏</div>
      </div>

      {menuOpen && (
        <div className="navtest-menu-overlay">
          <button className="navtest-menu-close" aria-label="关闭" onClick={() => setMenuOpen(false)}>关闭 ×</button>
          <FlowingMenu
            items={ITEMS.map((i) => ({ text: i.label, href: i.href }))}
            onItemClick={(it) => { setActive(it.href); setMenuOpen(false); }}
          />
        </div>
      )}
    </div>
  );
}
