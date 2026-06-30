import { useState } from "react";
import PillNav from "../components/PillNav";
import "./NavTest.css";

// /test —— 手机端顶部 Pill Nav 导航原型(D2/D5)。给 yufei 真机评估:
//   - 「pill 一行(横滑)」 vs 「汉堡(PillNav 原生窄屏)」两种摆法。
//   - 桌面端不在本原型范围(保留现有 StaggeredMenu)。满意后再并回 AppShell。
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
  const [variant, setVariant] = useState("pills"); // pills | hamburger

  return (
    <div className="navtest" data-theme="paper">
      <header className="navtest-top">
        <PillNav
          items={ITEMS}
          activeHref={active}
          forcePills={variant === "pills"}
          onItemClick={(it) => setActive(it.href)}
          onBrandClick={() => setActive("/home")}
        />
      </header>

      <div className="navtest-body">
        <div className="navtest-seg">
          <button className={variant === "pills" ? "is-on" : ""} onClick={() => setVariant("pills")}>pill 一行(横滑)</button>
          <button className={variant === "hamburger" ? "is-on" : ""} onClick={() => setVariant("hamburger")}>汉堡(原生窄屏)</button>
        </div>
        <p className="navtest-hint t-ui">
          /test · 手机顶部 Pill Nav 原型。点 pill / 汉堡里的项看选中态(只切高亮,不跳页)。
          当前选中:<b>{active}</b>。
        </p>
        <p className="navtest-note t-meta">
          「pill 一行」= 6 个入口排一行、挤了就左右滑;「汉堡」= React Bits 原生窄屏(logo + 汉堡 → 下拉)。
          挑一个方向 + 颜色/留哪些入口给我,我并回正式壳(桌面端不动)。
        </p>
        <div className="navtest-card">页面内容占位 ①</div>
        <div className="navtest-card">页面内容占位 ②</div>
        <div className="navtest-card tall">往下滚 —— 看顶栏是否钉住 / 内容有没有被挡</div>
      </div>
    </div>
  );
}
