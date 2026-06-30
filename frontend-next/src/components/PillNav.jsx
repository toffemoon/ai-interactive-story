import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import "./PillNav.css";

// React Bits · PillNav(本地 vendored,适配沐言:文字 logo + 吃语义 token + HashRouter)。
// 原组件:桌面显示 pill 行(.desktop-only)、窄屏收成汉堡(.mobile-only)。
//   - forcePills:窄屏也强制显示 pill 一行(横滑),用来对比「pill 一行 vs 汉堡」。
//   - onItemClick(item):拦截点击(原型里只切 active 不跳走;正式接 transitionNav 时换成 navigate)。
// 动效保持原样:hover 圆形揭示 + label 上移、汉堡变叉、初载弹入。用项目已有的 gsap。
export default function PillNav({
  items = [],
  activeHref,
  brandText = "沐",
  className = "",
  ease = "power3.easeOut",
  forcePills = false,
  onItemClick,
  onBrandClick,
  initialLoadAnimation = true,
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const circleRefs = useRef([]);
  const tlRefs = useRef([]);
  const activeTweenRefs = useRef([]);
  const hamburgerRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const navItemsRef = useRef(null);
  const logoRef = useRef(null);

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle) => {
        if (!circle?.parentElement) return;
        const pill = circle.parentElement;
        const rect = pill.getBoundingClientRect();
        const { width: w, height: h } = rect;
        if (!w || !h) return;
        const R = ((w * w) / 4 + h * h) / (2 * h);
        const D = Math.ceil(2 * R) + 2;
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
        const originY = D - delta;
        circle.style.width = `${D}px`;
        circle.style.height = `${D}px`;
        circle.style.bottom = `-${delta}px`;
        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });
        const label = pill.querySelector(".pill-label");
        const white = pill.querySelector(".pill-label-hover");
        if (label) gsap.set(label, { y: 0 });
        if (white) gsap.set(white, { y: h + 12, opacity: 0 });
        const index = circleRefs.current.indexOf(circle);
        if (index === -1) return;
        tlRefs.current[index]?.kill();
        const tl = gsap.timeline({ paused: true });
        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: "auto" }, 0);
        if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: "auto" }, 0);
        if (white) {
          gsap.set(white, { y: Math.ceil(h + 100), opacity: 0 });
          tl.to(white, { y: 0, opacity: 1, duration: 2, ease, overwrite: "auto" }, 0);
        }
        tlRefs.current[index] = tl;
      });
    };
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    if (document.fonts?.ready) document.fonts.ready.then(layout).catch(() => {});
    const menu = mobileMenuRef.current;
    if (menu) gsap.set(menu, { visibility: "hidden", opacity: 0, scaleY: 1 });
    if (initialLoadAnimation) {
      const logo = logoRef.current;
      const navItems = navItemsRef.current;
      if (logo) {
        gsap.set(logo, { scale: 0 });
        gsap.to(logo, { scale: 1, duration: 0.6, ease });
      }
      // 原版做 navItems width:0→auto 展开动画;GSAP 动到 "auto" 在本仓会卡在 width:0(把整条 pill 行裁没)。
      // 改成淡入 + 轻微下移,并 clearProps 掉可能残留的 width:0/overflow:hidden,pill 行保持自然宽度。
      if (navItems) {
        gsap.set(navItems, { clearProps: "width,overflow" });
        gsap.set(navItems, { opacity: 0, y: -6 });
        gsap.to(navItems, { opacity: 1, y: 0, duration: 0.5, ease });
      }
    }
    return () => window.removeEventListener("resize", onResize);
  }, [items, ease, initialLoadAnimation]);

  const handleEnter = (i) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease, overwrite: "auto" });
  };
  const handleLeave = (i) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(0, { duration: 0.2, ease, overwrite: "auto" });
  };

  const toggleMobileMenu = () => {
    const newState = !isMobileMenuOpen;
    setIsMobileMenuOpen(newState);
    const hamburger = hamburgerRef.current;
    const menu = mobileMenuRef.current;
    if (hamburger) {
      const lines = hamburger.querySelectorAll(".hamburger-line");
      if (newState) {
        gsap.to(lines[0], { rotation: 45, y: 3, duration: 0.3, ease });
        gsap.to(lines[1], { rotation: -45, y: -3, duration: 0.3, ease });
      } else {
        gsap.to(lines[0], { rotation: 0, y: 0, duration: 0.3, ease });
        gsap.to(lines[1], { rotation: 0, y: 0, duration: 0.3, ease });
      }
    }
    if (menu) {
      if (newState) {
        gsap.set(menu, { visibility: "visible" });
        gsap.fromTo(menu, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease, transformOrigin: "top center" });
      } else {
        gsap.to(menu, {
          opacity: 0, y: 10, duration: 0.2, ease, transformOrigin: "top center",
          onComplete: () => gsap.set(menu, { visibility: "hidden" }),
        });
      }
    }
  };

  const clickItem = (e, item) => {
    if (onItemClick) {
      e.preventDefault();
      onItemClick(item);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <div className={"pill-nav-container" + (forcePills ? " force-pills" : "") + (className ? " " + className : "")}>
      <nav className="pill-nav" aria-label="Primary">
        <button
          className="pill-logo"
          aria-label="沐言 · 看板"
          ref={logoRef}
          type="button"
          onClick={(e) => { if (onBrandClick) { e.preventDefault(); onBrandClick(); } }}
        >
          <span className="pill-logo-mark t-kai">{brandText}</span>
        </button>

        <div className="pill-nav-items desktop-only" ref={navItemsRef}>
          <ul className="pill-list" role="menubar">
            {items.map((item, i) => (
              <li key={item.href || i} role="none">
                <a
                  role="menuitem"
                  href={"#" + item.href}
                  className={"pill" + (activeHref === item.href ? " is-active" : "")}
                  aria-label={item.label}
                  onMouseEnter={() => handleEnter(i)}
                  onMouseLeave={() => handleLeave(i)}
                  onClick={(e) => clickItem(e, item)}
                >
                  <span className="hover-circle" aria-hidden="true" ref={(el) => (circleRefs.current[i] = el)} />
                  <span className="label-stack">
                    <span className="pill-label">{item.label}</span>
                    <span className="pill-label-hover" aria-hidden="true">{item.label}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <button className="mobile-menu-button mobile-only" onClick={toggleMobileMenu} aria-label="Toggle menu" ref={hamburgerRef} type="button">
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
      </nav>

      <div className="mobile-menu-popover mobile-only" ref={mobileMenuRef}>
        <ul className="mobile-menu-list">
          {items.map((item, i) => (
            <li key={item.href || i}>
              <a
                href={"#" + item.href}
                className={"mobile-menu-link" + (activeHref === item.href ? " is-active" : "")}
                onClick={(e) => clickItem(e, item)}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
