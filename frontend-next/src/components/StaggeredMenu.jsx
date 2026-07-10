import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import "./StaggeredMenu.css";

// React Bits · StaggeredMenu(JS+CSS 变体)· 适配沐言:
//   - logo 用文字「沐言」(无 logo 资产);开关文案「菜单/关闭」;
//   - 菜单项 onItemClick 交给上层走 react-router navigate(HashRouter)。
// hoverExpand(桌面半常驻 rail)对原动画的改造:图标列和大字菜单同住一块面板,
//   悬停 = 面板原地展宽(72px → clamp 宽)+ 图标列让位 + 大字保留原错层长入;
//   不再从屏外滑入、不扫 prelayer 色层——同一块表面在生长,不是切出一整页。
// 非 hoverExpand 路径保持 React Bits 原样(错层滑入 + prelayer + 数字 + 图标旋转)。
export const StaggeredMenu = ({
  position = "right",
  colors = ["#B497CF", "#5227FF"],
  items = [],
  socialItems = [],
  displaySocials = true,
  displayItemNumbering = true,
  className,
  brandText = "沐言",
  menuButtonColor = "#fff",
  openMenuButtonColor = "#fff",
  accentColor = "#5227FF",
  changeMenuColorOnOpen = true,
  isFixed = false,
  hoverExpand = false,
  closeOnClickAway = true,
  onItemClick,
  onMenuOpen,
  onMenuClose,
}) => {
  const [open, setOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  const openRef = useRef(false);
  const pinnedOpenRef = useRef(false);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);
  const headerRef = useRef(null);
  const preLayersRef = useRef(null);
  const preLayerElsRef = useRef([]);
  const plusHRef = useRef(null);
  const plusVRef = useRef(null);
  const iconRef = useRef(null);
  const textInnerRef = useRef(null);
  const textWrapRef = useRef(null);
  const [textLines, setTextLines] = useState([brandText, "关闭"]);

  const openTlRef = useRef(null);
  const closeTweenRef = useRef(null);
  const spinTweenRef = useRef(null);
  const textCycleAnimRef = useRef(null);
  const colorTweenRef = useRef(null);
  const toggleBtnRef = useRef(null);
  const busyRef = useRef(false);
  const itemEntranceTweenRef = useRef(null);
  const hoverOpenTimerRef = useRef(null);
  const hoverCloseTimerRef = useRef(null);
  const hoverArmedRef = useRef(true);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    if (media.addEventListener) media.addEventListener("change", sync);
    else media.addListener(sync);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", sync);
      else media.removeListener(sync);
    };
  }, []);

  // rail 收起宽 / 展开目标宽。展开宽须与 CSS 的 clamp(210px, 24vw, 300px) 保持同一公式
  // (面板宽由 gsap 内联驱动,.sm-panel-inner 固定吃这个 clamp,展宽只做揭示、文字不回流)。
  const getRailWidth = useCallback(() => {
    const wrapper = wrapperRef.current;
    return wrapper
      ? parseFloat(getComputedStyle(wrapper).getPropertyValue("--sm-rail-width")) || 72
      : 72;
  }, []);
  const getPanelWidth = useCallback(
    () => Math.round(Math.min(300, Math.max(210, window.innerWidth * 0.24))),
    []
  );

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preContainer = preLayersRef.current;
      const plusH = plusHRef.current;
      const plusV = plusVRef.current;
      const icon = iconRef.current;
      const textInner = textInnerRef.current;
      if (!panel || !plusH || !plusV || !icon || !textInner) return;

      let preLayers = [];
      if (preContainer) {
        preLayers = Array.from(preContainer.querySelectorAll(".sm-prelayer"));
      }
      preLayerElsRef.current = preLayers;

      if (hoverExpand) {
        // 半常驻 rail:面板常驻原位,宽度收在 rail 宽;印章头同宽同步(同一条 tween 免接缝)。
        const railW = getRailWidth();
        gsap.set(panel, { xPercent: 0, opacity: 1, width: railW });
        if (headerRef.current) gsap.set(headerRef.current, { width: railW });
        // 色层停在面板左外(被 overflow:hidden 裁掉),等展开时扫入。
        if (preLayers.length) {
          gsap.set(preLayers, { xPercent: position === "left" ? -100 : 100, opacity: 1 });
        }
        // 大字菜单首帧就得藏进入场前位置:原版靠整块面板在屏外,此处面板常驻屏内,
        // 不预置 yPercent 的话首次加载每项第一个字会漏进 72px 裁切区、叠在图标上。
        const itemEls = panel.querySelectorAll(".sm-panel-itemLabel");
        if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10, autoAlpha: 1 });
        const numberEls = panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item");
        if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
      } else {
        const offscreen = position === "left" ? -100 : 100;
        gsap.set([panel, ...preLayers], { xPercent: offscreen, opacity: 1 });
        if (preContainer) {
          gsap.set(preContainer, { xPercent: 0, opacity: 1 });
        }
      }
      gsap.set(plusH, { transformOrigin: "50% 50%", rotate: 0 });
      gsap.set(plusV, { transformOrigin: "50% 50%", rotate: 90 });
      gsap.set(icon, { rotate: 0, transformOrigin: "50% 50%" });
      gsap.set(textInner, { yPercent: 0 });
      // 开关颜色不在这里写(改由 CSS 驱动,见下方说明),避免内联色覆盖主题色。
    });
    return () => ctx.revert();
  }, [position, hoverExpand, getRailWidth]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }
    itemEntranceTweenRef.current?.kill();

    const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
    const numberEls = Array.from(panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item"));
    const socialTitle = panel.querySelector(".sm-socials-title");
    const socialLinks = Array.from(panel.querySelectorAll(".sm-socials-link"));

    // —— 半常驻 rail:同一块面板原地展宽,图标列让位、大字保留原错层长入 ——
    if (hoverExpand) {
      const railLinks = Array.from(panel.querySelectorAll(".sm-rail-link"));
      const widthEls = headerRef.current ? [panel, headerRef.current] : [panel];
      const targetW = getPanelWidth();

      if (reducedMotion) {
        const tl = gsap.timeline({ paused: true });
        tl.set(widthEls, { width: targetW });
        if (layers.length) tl.set(layers, { xPercent: 0 });
        if (railLinks.length) tl.set(railLinks, { autoAlpha: 0 });
        if (itemEls.length) tl.set(itemEls, { yPercent: 0, rotate: 0, autoAlpha: 1 });
        if (numberEls.length) tl.set(numberEls, { "--sm-num-opacity": 1 });
        openTlRef.current = tl;
        return tl;
      }

      // autoAlpha 一并复位:收回动画(大字快淡出)被中途打断再展开时,别让大字停在半透明。
      if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10, autoAlpha: 1 });
      if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });

      const tl = gsap.timeline({ paused: true });
      tl.to(widthEls, { width: targetW, duration: 0.55, ease: "power4.out" }, 0);
      // 色层在生长中的面板内依次扫入(原版节奏):金/绛每层错 0.07s,暖纸盖层最后落定。
      layers.forEach((el, i) => {
        const isCover = el.classList.contains("sm-prelayer--cover");
        tl.to(
          el,
          { xPercent: 0, duration: isCover ? 0.65 : 0.5, ease: "power4.out" },
          isCover ? 0.15 : i * 0.07
        );
      });
      if (railLinks.length) {
        tl.to(
          railLinks,
          { autoAlpha: 0, x: -12, duration: 0.25, ease: "power2.out", stagger: { each: 0.03, from: "start" } },
          0
        );
      }
      if (itemEls.length) {
        // 大字等暖纸盖层大致落定再上(0.25 ≈ 盖层入场 + 原版 panel*0.15 的比例),别踩在色层上。
        tl.to(
          itemEls,
          { yPercent: 0, rotate: 0, duration: 1, ease: "power4.out", stagger: { each: 0.1, from: "start" } },
          0.25
        );
        if (numberEls.length) {
          tl.to(
            numberEls,
            { duration: 0.6, ease: "power2.out", "--sm-num-opacity": 1, stagger: { each: 0.08, from: "start" } },
            0.35
          );
        }
      }
      openTlRef.current = tl;
      return tl;
    }

    if (reducedMotion) {
      const tl = gsap.timeline({ paused: true });
      tl.set([...layers, panel], { xPercent: 0, opacity: 1 });
      if (itemEls.length) tl.set(itemEls, { yPercent: 0, rotate: 0 });
      if (numberEls.length) tl.set(numberEls, { "--sm-num-opacity": 1 });
      if (socialTitle) tl.set(socialTitle, { opacity: 1 });
      if (socialLinks.length) tl.set(socialLinks, { y: 0, opacity: 1 });
      openTlRef.current = tl;
      return tl;
    }

    const layerStates = layers.map((el) => ({ el }));

    if (itemEls.length) {
      gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    }
    if (numberEls.length) {
      gsap.set(numberEls, { "--sm-num-opacity": 0 });
    }
    if (socialTitle) {
      gsap.set(socialTitle, { opacity: 0 });
    }
    if (socialLinks.length) {
      gsap.set(socialLinks, { y: 25, opacity: 0 });
    }

    const tl = gsap.timeline({ paused: true });

    layerStates.forEach((ls, i) => {
      tl.to(ls.el, { xPercent: 0, duration: 0.5, ease: "power4.out" }, i * 0.07);
    });
    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;
    tl.to(panel, { xPercent: 0, duration: panelDuration, ease: "power4.out" }, panelInsertTime);

    if (itemEls.length) {
      const itemsStartRatio = 0.15;
      const itemsStart = panelInsertTime + panelDuration * itemsStartRatio;
      tl.to(
        itemEls,
        { yPercent: 0, rotate: 0, duration: 1, ease: "power4.out", stagger: { each: 0.1, from: "start" } },
        itemsStart
      );
      if (numberEls.length) {
        tl.to(
          numberEls,
          { duration: 0.6, ease: "power2.out", "--sm-num-opacity": 1, stagger: { each: 0.08, from: "start" } },
          itemsStart + 0.1
        );
      }
    }

    if (socialTitle || socialLinks.length) {
      const socialsStart = panelInsertTime + panelDuration * 0.4;
      if (socialTitle) {
        tl.to(socialTitle, { opacity: 1, duration: 0.5, ease: "power2.out" }, socialsStart);
      }
      if (socialLinks.length) {
        tl.to(
          socialLinks,
          {
            y: 0,
            opacity: 1,
            duration: 0.55,
            ease: "power3.out",
            stagger: { each: 0.08, from: "start" },
            onComplete: () => {
              gsap.set(socialLinks, { clearProps: "opacity" });
            },
          },
          socialsStart + 0.04
        );
      }
    }

    openTlRef.current = tl;
    return tl;
  }, [position, reducedMotion, hoverExpand, getPanelWidth]);

  const playOpen = useCallback(() => {
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (tl) {
      tl.eventCallback("onComplete", () => {
        busyRef.current = false;
      });
      tl.play(0);
    } else {
      busyRef.current = false;
    }
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;
    itemEntranceTweenRef.current?.kill();

    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return;

    closeTweenRef.current?.kill();

    // —— 半常驻 rail:面板收回 rail 宽,大字快淡出、图标列错峰归位 ——
    if (hoverExpand) {
      const railLinks = Array.from(panel.querySelectorAll(".sm-rail-link"));
      const widthEls = headerRef.current ? [panel, headerRef.current] : [panel];
      const railW = getRailWidth();
      const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
      const resetClosedContent = () => {
        if (itemEls.length) gsap.set(itemEls, { autoAlpha: 1, yPercent: 140, rotate: 10 });
        const numberEls = Array.from(panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item"));
        if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
        busyRef.current = false;
      };

      const layerOff = position === "left" ? -100 : 100;

      if (reducedMotion) {
        gsap.set(widthEls, { width: railW });
        if (layers.length) gsap.set(layers, { xPercent: layerOff });
        if (railLinks.length) gsap.set(railLinks, { autoAlpha: 1, x: 0 });
        resetClosedContent();
        return;
      }

      const tl = gsap.timeline({ onComplete: resetClosedContent });
      if (itemEls.length) {
        tl.to(itemEls, { autoAlpha: 0, duration: 0.16, ease: "power2.in" }, 0);
      }
      // 色层成叠滑出(盖层在最上,底下的金/绛同步走,不闪色),露出的面板底就是纸面。
      if (layers.length) {
        tl.to(layers, { xPercent: layerOff, duration: 0.3, ease: "power3.in", overwrite: "auto" }, 0);
      }
      tl.to(widthEls, { width: railW, duration: 0.4, ease: "power4.inOut", overwrite: "auto" }, 0.04);
      if (railLinks.length) {
        tl.to(
          railLinks,
          { autoAlpha: 1, x: 0, duration: 0.3, ease: "power2.out", stagger: { each: 0.02, from: "start" } },
          0.16
        );
      }
      closeTweenRef.current = tl;
      return;
    }

    const all = [...layers, panel];
    const offscreen = position === "left" ? -100 : 100;
    const resetClosedContent = () => {
      const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel"));
      if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
      const numberEls = Array.from(panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item"));
      if (numberEls.length) gsap.set(numberEls, { "--sm-num-opacity": 0 });
      const socialTitle = panel.querySelector(".sm-socials-title");
      const socialLinks = Array.from(panel.querySelectorAll(".sm-socials-link"));
      if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
      if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });
      busyRef.current = false;
    };

    if (reducedMotion) {
      gsap.set(all, { xPercent: offscreen });
      resetClosedContent();
      return;
    }

    closeTweenRef.current = gsap.to(all, {
      xPercent: offscreen,
      duration: 0.32,
      ease: "power3.in",
      overwrite: "auto",
      onComplete: resetClosedContent,
    });
  }, [position, reducedMotion, hoverExpand, getRailWidth]);

  const animateIcon = useCallback((opening) => {
    const icon = iconRef.current;
    if (!icon) return;
    spinTweenRef.current?.kill();
    if (reducedMotion) {
      gsap.set(icon, { rotate: opening ? 225 : 0 });
      return;
    }
    if (opening) {
      spinTweenRef.current = gsap.to(icon, { rotate: 225, duration: 0.8, ease: "power4.out", overwrite: "auto" });
    } else {
      spinTweenRef.current = gsap.to(icon, { rotate: 0, duration: 0.35, ease: "power3.inOut", overwrite: "auto" });
    }
  }, [reducedMotion]);

  // 开关颜色改由 CSS 按主题([data-theme])+ 开合([data-open])驱动:
  // 切页时残留的、带 0.18s 延迟的 gsap color tween 会把颜色写成上一页的(切到 home 还是黑),故不再用 gsap 写内联色。
  const animateColor = useCallback(() => {}, []);

  const animateText = useCallback((opening) => {
    const inner = textInnerRef.current;
    if (!inner) return;
    textCycleAnimRef.current?.kill();

    const currentLabel = opening ? brandText : "关闭";
    const targetLabel = opening ? "关闭" : brandText;
    if (reducedMotion) {
      setTextLines([targetLabel]);
      gsap.set(inner, { yPercent: 0 });
      return;
    }
    const cycles = 3;
    const seq = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === brandText ? "关闭" : brandText;
      seq.push(last);
    }
    if (last !== targetLabel) seq.push(targetLabel);
    seq.push(targetLabel);
    setTextLines(seq);

    gsap.set(inner, { yPercent: 0 });
    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;
    textCycleAnimRef.current = gsap.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: "power4.out",
    });
  }, [brandText, reducedMotion]);

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const openMenu = useCallback((pinned = false) => {
    const focusedRailLink = document.activeElement?.matches?.(".sm-rail-link")
      ? document.activeElement
      : null;
    const focusedRailIndex = focusedRailLink
      ? Number(focusedRailLink.getAttribute("data-rail-index"))
      : -1;
    if (pinned) {
      pinnedOpenRef.current = true;
      hoverArmedRef.current = true;
    }
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    onMenuOpen?.();
    playOpen();
    animateIcon(true);
    animateColor(true);
    animateText(true);
    if (focusedRailIndex >= 0) {
      requestAnimationFrame(() => {
        panelRef.current
          ?.querySelectorAll(".sm-panel-item")
          [focusedRailIndex]?.focus({ preventScroll: true });
      });
    }
  }, [playOpen, animateIcon, animateColor, animateText, onMenuOpen]);

  const toggleMenu = useCallback(() => {
    clearHoverTimers();
    const target = !openRef.current;
    pinnedOpenRef.current = target;
    hoverArmedRef.current = target;
    openRef.current = target;
    setOpen(target);
    if (target) {
      onMenuOpen?.();
      playOpen();
    } else {
      onMenuClose?.();
      playClose();
    }
    animateIcon(target);
    animateColor(target);
    animateText(target);
  }, [clearHoverTimers, playOpen, playClose, animateIcon, animateColor, animateText, onMenuOpen, onMenuClose]);

  const closeMenu = useCallback((suppressHoverUntilLeave = false) => {
    clearHoverTimers();
    pinnedOpenRef.current = false;
    if (suppressHoverUntilLeave) hoverArmedRef.current = false;
    if (openRef.current) {
      openRef.current = false;
      setOpen(false);
      onMenuClose?.();
      playClose();
      animateIcon(false);
      animateColor(false);
      animateText(false);
    }
  }, [clearHoverTimers, playClose, animateIcon, animateColor, animateText, onMenuClose]);

  const closeAndRestoreFocus = useCallback(() => {
    closeMenu(true);
    requestAnimationFrame(() => toggleBtnRef.current?.focus());
  }, [closeMenu]);

  const handleHoverEnter = useCallback((event) => {
    if (!hoverExpand || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    if (!hoverArmedRef.current) return;
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (openRef.current || hoverOpenTimerRef.current !== null) return;
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      openMenu(false);
    }, reducedMotion ? 0 : 120);
  }, [hoverExpand, openMenu, reducedMotion]);

  const handleHoverStay = useCallback((event) => {
    if (!hoverExpand || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, [hoverExpand]);

  const handleHoverLeave = useCallback((event) => {
    if (!hoverExpand || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (!openRef.current) {
      const wrapper = wrapperRef.current;
      const rect = wrapper?.getBoundingClientRect();
      const railWidth = getRailWidth();
      const stillOverCollapsedRail = rect
        && event.clientX >= rect.left
        && event.clientX <= rect.left + railWidth
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
      if (!stillOverCollapsedRail) hoverArmedRef.current = true;
      return;
    }
    if (pinnedOpenRef.current || hoverCloseTimerRef.current !== null || !openRef.current) return;
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (wrapperRef.current?.contains(document.activeElement)) return;
      closeMenu();
    }, reducedMotion ? 0 : 180);
  }, [hoverExpand, closeMenu, reducedMotion, getRailWidth]);

  const handleBlurCapture = useCallback((event) => {
    if (!hoverExpand || event.currentTarget.contains(event.relatedTarget)) return;
    closeMenu(true);
  }, [hoverExpand, closeMenu]);

  React.useEffect(() => () => clearHoverTimers(), [clearHoverTimers]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeAndRestoreFocus]);

  const handleItemClick = (e, it) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (onItemClick) {
      e.preventDefault();
      closeAndRestoreFocus();
      onItemClick(it);
    }
  };

  // prelayer 色层色板(React Bits 原逻辑:≥3 色抽掉中间一层)
  const preLayerColors = (() => {
    const raw = colors && colors.length ? colors.slice(0, 4) : ["#1e1e22", "#35353c"];
    const arr = [...raw];
    if (arr.length >= 3) {
      const mid = Math.floor(arr.length / 2);
      arr.splice(mid, 1);
    }
    return arr;
  })();

  return (
    <div
      ref={wrapperRef}
      className={(className ? className + " " : "") + "staggered-menu-wrapper" + (isFixed ? " fixed-wrapper" : "") + (hoverExpand ? " sm-hover-rail" : "")}
      style={accentColor ? { ["--sm-accent"]: accentColor } : undefined}
      data-position={position}
      data-open={open || undefined}
      data-hover-expand={hoverExpand || undefined}
      onBlurCapture={hoverExpand ? handleBlurCapture : undefined}
    >
      {open && closeOnClickAway ? (
        <div
          className="sm-backdrop"
          onPointerDown={closeAndRestoreFocus}
          aria-hidden="true"
        />
      ) : null}
      {hoverExpand && open ? (
        <div
          className="sm-hover-bridge"
          onPointerEnter={handleHoverStay}
          onPointerLeave={handleHoverLeave}
          aria-hidden="true"
        />
      ) : null}
      {/* 非 rail(原版):prelayer 色层与面板平级,从屏外扫入。rail 模式的色层在面板内部(见下)。 */}
      {hoverExpand ? null : (
        <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
          {preLayerColors.map((c, i) => (
            <div key={i} className="sm-prelayer" style={{ background: c }} />
          ))}
        </div>
      )}
      <header
        ref={headerRef}
        className="staggered-menu-header"
        aria-label="主导航菜单"
        onPointerEnter={hoverExpand ? handleHoverEnter : undefined}
        onPointerLeave={hoverExpand ? handleHoverLeave : undefined}
      >
        {/* 「沐言」即开关:不再单独做 logo(YOR-136 反馈) */}
        <button
          ref={toggleBtnRef}
          className="sm-toggle"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          aria-controls="staggered-menu-panel"
          onClick={toggleMenu}
          type="button"
        >
          {hoverExpand ? <span className="sm-toggle-railMark" aria-hidden="true">{brandText.slice(0, 1)}</span> : null}
          <span ref={textWrapRef} className="sm-toggle-textWrap" aria-hidden="true">
            <span ref={textInnerRef} className="sm-toggle-textInner">
              {textLines.map((l, i) => (
                <span className="sm-toggle-line" key={i}>
                  {l}
                </span>
              ))}
            </span>
          </span>
          <span ref={iconRef} className="sm-icon" aria-hidden="true">
            <span ref={plusHRef} className="sm-icon-line" />
            <span ref={plusVRef} className="sm-icon-line sm-icon-line-v" />
          </span>
        </button>
      </header>

      {/* rail 图标列与大字菜单同住一块面板:悬停时面板原地展宽,表面连续不切页。
          收起态面板即 72px rail 条(pointer-events 常开),进入即触发展开。 */}
      <nav
        id="staggered-menu-panel"
        ref={panelRef}
        className="staggered-menu-panel"
        aria-label="主导航"
        aria-hidden={hoverExpand ? undefined : !open}
        onPointerEnter={hoverExpand ? handleHoverEnter : undefined}
        onPointerLeave={hoverExpand ? handleHoverLeave : undefined}
      >
        {/* rail 模式的 prelayer 色层:住在面板内部、被生长中的面板裁切——
            金/绛依次扫过、暖纸盖层最后落定,保住原版的扫层节奏又不破坏「同一块表面」。 */}
        {hoverExpand ? (
          <div ref={preLayersRef} className="sm-prelayers sm-prelayers--rail" aria-hidden="true">
            {preLayerColors.map((c, i) => (
              <div key={i} className="sm-prelayer" style={{ background: c }} />
            ))}
            <div className="sm-prelayer sm-prelayer--cover" />
          </div>
        ) : null}
        {hoverExpand ? (
          <ul className="sm-rail-list" role="list" aria-hidden={open || undefined}>
            {items.map((it, idx) => {
              const Icon = it.icon;
              return (
                <li className="sm-rail-item" key={`${it.label}-rail-${idx}`}>
                  <a
                    className={`sm-rail-link${it.active ? " is-active" : ""}`}
                    href={`#${it.link}`}
                    aria-label={it.ariaLabel}
                    aria-current={it.active ? "page" : undefined}
                    data-rail-index={idx}
                    tabIndex={open ? -1 : 0}
                    onClick={(event) => handleItemClick(event, it)}
                  >
                    {Icon
                      ? React.createElement(Icon, { size: 22, strokeWidth: 1.6, "aria-hidden": true })
                      : <span aria-hidden="true">{it.label.slice(0, 1)}</span>}
                    <span className="sm-rail-label">{it.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="sm-panel-inner" aria-hidden={hoverExpand ? !open : undefined}>
          <ul className="sm-panel-list" role="list" data-numbering={displayItemNumbering || undefined}>
            {items && items.length ? (
              items.map((it, idx) => (
                <li className="sm-panel-itemWrap" key={it.label + idx}>
                  <a
                    className={`sm-panel-item${it.active ? " is-active" : ""}`}
                    href={`#${it.link}`}
                    aria-label={it.ariaLabel}
                    aria-current={it.active ? "page" : undefined}
                    tabIndex={open ? 0 : -1}
                    data-index={idx + 1}
                    onClick={(e) => handleItemClick(e, it)}
                  >
                    <span className="sm-panel-itemLabel">{it.label}</span>
                  </a>
                </li>
              ))
            ) : (
              <li className="sm-panel-itemWrap" aria-hidden="true">
                <span className="sm-panel-item">
                  <span className="sm-panel-itemLabel">No items</span>
                </span>
              </li>
            )}
          </ul>
          {displaySocials && socialItems && socialItems.length > 0 && (
            <div className="sm-socials" aria-label="Social links">
              <h3 className="sm-socials-title">Socials</h3>
              <ul className="sm-socials-list" role="list">
                {socialItems.map((s, i) => (
                  <li key={s.label + i} className="sm-socials-item">
                    <a href={s.link} target="_blank" rel="noopener noreferrer" className="sm-socials-link" tabIndex={open ? 0 : -1}>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
};

export default StaggeredMenu;
