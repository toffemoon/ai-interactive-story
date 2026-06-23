"use client";

import { useEffect, useState, useRef } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import "./preloader.css";

export interface PreloaderProps {
  /** Whether the preloader is active */
  loading: boolean;

  /** Visual variant of the preloader */
  variant?: "stairs" | "percentage" | "circle" | "slide" | "curtain";

  /** Position type of the preloader container */
  position?: "fixed" | "absolute";

  /** Duration of the loading animation in milliseconds */
  duration?: number;

  /** Loading text to display (for stairs and circle variants) */
  loadingText?: string;

  /** Callback when loading completes */
  onComplete?: () => void;

  /** Callback when loading starts */
  onLoadingStart?: () => void;

  /** Callback when exit animation completes */
  onLoadingComplete?: () => void;

  /** Additional CSS classes */
  className?: string;

  /** Z-index for the preloader */
  zIndex?: number;

  /** Background color (overrides default) */
  bgColor?: string;

  /** CSS classes for the loading text */
  textClassName?: string;

  /** Content to show after loading */
  children?: React.ReactNode;

  /** Respect prefers-reduced-motion setting */
  respectReducedMotion?: boolean;

  /** Fallback behavior when reduced motion is preferred */
  reducedMotionFallback?: "fade" | "none";

  /** ARIA label for screen readers */
  ariaLabel?: string;

  /** ARIA live region politeness */
  ariaLive?: "polite" | "assertive" | "off";

  /** Progress threshold (0-100) when text starts fading */
  textFadeThreshold?: number;

  /** Backdrop blur amount in pixels */
  backdropBlur?: number;

  /** Custom content to replace default loader (render prop) */
  customContent?: (progress: number) => React.ReactNode;

  /** Position of percentage counter */
  percentagePosition?: "center" | "bottom-left" | "top-left";

  /** Show percentage sign */
  showPercentageSign?: boolean;

  /** CSS classes for percentage text */
  percentageTextClassName?: string;

  /** Show progress bar */
  showProgressBar?: boolean;

  /** Progress bar position */
  progressBarPosition?: "top" | "bottom";

  /** Number of stairs */
  stairCount?: number;

  /** Direction stairs reveal from */
  stairsRevealFrom?: "left" | "right" | "center";

  /** Direction stairs move when revealing */
  stairsRevealDirection?: "up" | "down";
}

const Preloader: React.FC<PreloaderProps> = ({
  loading,
  variant = "stairs",
  position = "absolute",
  duration = 2500,
  loadingText = "Loading your next level experience",
  onComplete,
  onLoadingStart,
  onLoadingComplete,
  className = "",
  zIndex = 50,
  bgColor,
  textClassName = "",
  children,
  respectReducedMotion = false,
  reducedMotionFallback = "fade",
  ariaLabel = "Loading content",
  ariaLive = "polite",
  textFadeThreshold = 99,
  backdropBlur = 0,
  customContent,
  percentagePosition = "center",
  showPercentageSign = true,
  percentageTextClassName = "",
  showProgressBar = true,
  progressBarPosition = "bottom",
  stairCount = 10,
  stairsRevealFrom = "left",
  stairsRevealDirection = "up",
}) => {
  const [progress, setProgress] = useState(loading ? 0 : 100);
  const [showPreloader, setShowPreloader] = useState(loading);
  const [hideText, setHideText] = useState(!loading);
  const rafRef = useRef<number | null>(null);
  const textHiddenRef = useRef(!loading);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const hasStartedRef = useRef(false);

  const prevLoadingRef = useRef(loading);

  useEffect(() => {
    const prevLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (loading && !prevLoading) {
      textHiddenRef.current = false;
      flushSync(() => {
        setShowPreloader(true);
        setHideText(false);
        setProgress(0);
      });
    }
  }, [loading]);

  useEffect(() => {
    if (!respectReducedMotion) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(e.matches);
    };

    handleChange(mediaQuery);

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [respectReducedMotion]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let completeTimeoutId: NodeJS.Timeout;

    if (loading) {
      const startTime = Date.now();
      let isActive = true;

      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        onLoadingStart?.();
      }

      const updateProgress = () => {
        if (!isActive) return;

        const elapsed = Date.now() - startTime;
        let newProgress = (elapsed / duration) * 100;

        if (newProgress > 90) {
          const excess = newProgress - 90;
          newProgress = 90 + excess * 0.1;
        }

        newProgress = Math.min(newProgress, 99);
        setProgress(newProgress);

        if (newProgress >= textFadeThreshold && !textHiddenRef.current) {
          textHiddenRef.current = true;
          setHideText(true);
        }

        rafRef.current = requestAnimationFrame(updateProgress);
      };

      updateProgress();

      return () => {
        isActive = false;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    } else if (showPreloader) {
      hasStartedRef.current = false;

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const immediateTimeoutId = setTimeout(() => {
        setProgress(100);
        if (!textHiddenRef.current) {
          textHiddenRef.current = true;
          setHideText(true);
        }
      }, 0);

      const textFadeDelay = 300;
      const exitDelay = variant === "percentage" ? 2000 : 0;

      timeoutId = setTimeout(() => {
        setShowPreloader(false);

        completeTimeoutId = setTimeout(() => {
          onComplete?.();
        }, 800);
      }, textFadeDelay + exitDelay);

      return () => {
        clearTimeout(immediateTimeoutId);
        clearTimeout(timeoutId);
        clearTimeout(completeTimeoutId);
      };
    }
  }, [
    loading,
    duration,
    onComplete,
    onLoadingStart,
    variant,
    textFadeThreshold,
    showPreloader,
  ]);

  const renderLoadingText = () => {
    const words = loadingText.split(" ");

    return (
      <div className="preloader-loading-text" style={{ zIndex: zIndex + 1 }}>
        <div className="preloader-loading-text-wrapper">
          {words.map((word, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={
                hideText
                  ? { opacity: 0, filter: "blur(10px)" }
                  : { opacity: 1, filter: "blur(0px)" }
              }
              transition={{
                duration: hideText ? 0.3 : 0.6,
                delay: hideText ? 0 : index * 0.1,
                ease: [0.65, 0, 0.35, 1],
              }}
              className={`preloader-loading-text-word ${textClassName}`}
            >
              {word}
            </motion.span>
          ))}
        </div>
      </div>
    );
  };

  const renderStairsVariant = () => {
    const stairs = Array.from({ length: stairCount });

    const getStairDelay = (index: number) => {
      if (stairsRevealFrom === "left") {
        return index * 0.06;
      } else if (stairsRevealFrom === "right") {
        return (stairCount - 1 - index) * 0.06;
      } else {
        const middle = (stairCount - 1) / 2;
        const distanceFromCenter = Math.abs(index - middle);
        return distanceFromCenter * 0.06;
      }
    };

    const exitY = stairsRevealDirection === "up" ? "-100%" : "100%";
    const shouldAnimate =
      !prefersReducedMotion || reducedMotionFallback !== "none";
    const isReducedFade =
      prefersReducedMotion && reducedMotionFallback === "fade";

    return (
      <div
        className={`preloader-stairs preloader-${position}`}
        style={{
          zIndex,
        }}
        role="status"
        aria-label={ariaLabel}
        aria-live={ariaLive}
      >
        {stairs.map((_, index) => (
          <motion.div
            key={`stair-${index}`}
            initial={{ y: "0%", opacity: 1 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={
              isReducedFade
                ? { opacity: 0 }
                : shouldAnimate
                  ? { y: exitY }
                  : { opacity: 0 }
            }
            transition={{
              duration: isReducedFade ? 0.3 : shouldAnimate ? 0.5 : 0.3,
              delay: shouldAnimate && !isReducedFade ? getStairDelay(index) : 0,
              ease: [0.65, 0, 0.35, 1],
            }}
            className="preloader-stair"
            style={{
              backgroundColor: bgColor || undefined,
            }}
          >
            {!bgColor && (
              <div
                className="preloader-stair preloader-stair-colored"
                style={{ width: "100%", height: "100%" }}
              />
            )}
          </motion.div>
        ))}
        {renderLoadingText()}
      </div>
    );
  };

  const renderPercentageVariant = () => {
    const displayProgress = Math.floor(progress);
    const shouldAnimate =
      !prefersReducedMotion || reducedMotionFallback !== "none";

    const getPositionClasses = () => {
      if (percentagePosition === "bottom-left") {
        return "preloader-percentage-bottom-left";
      } else if (percentagePosition === "top-left") {
        return "preloader-percentage-top-left";
      }
      return "";
    };

    return (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: shouldAnimate ? 0.4 : 0.2, ease: "easeInOut" }}
        className={`preloader-percentage preloader-${position} ${getPositionClasses()} ${bgColor ? "" : "preloader-percentage-bg"}`}
        style={{
          zIndex,
          backgroundColor: bgColor,
          backdropFilter:
            backdropBlur > 0 ? `blur(${backdropBlur}px)` : undefined,
        }}
        role="progressbar"
        aria-label={ariaLabel}
        aria-live={ariaLive}
        aria-valuenow={displayProgress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`preloader-percentage-number ${percentageTextClassName}`}
        >
          {displayProgress}
          {showPercentageSign && (
            <span className="preloader-percentage-symbol">%</span>
          )}
        </div>

        {showProgressBar && (
          <div
            className={`preloader-percentage-bar-container ${progressBarPosition === "top" ? "preloader-percentage-bar-top" : ""}`}
          >
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.05, ease: "linear" }}
              className="preloader-percentage-bar"
            />
          </div>
        )}
      </motion.div>
    );
  };

  const renderCircleVariant = () => {
    const shouldAnimate =
      !prefersReducedMotion || reducedMotionFallback !== "none";
    const isReducedFade =
      prefersReducedMotion && reducedMotionFallback === "fade";

    return (
      <div
        className={`preloader-circle preloader-${position}`}
        style={{ zIndex }}
        role="status"
        aria-label={ariaLabel}
        aria-live={ariaLive}
      >
        <motion.div
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={
            isReducedFade
              ? { opacity: 0 }
              : shouldAnimate
                ? { scale: 0 }
                : { opacity: 0 }
          }
          transition={{
            duration: isReducedFade ? 0.3 : shouldAnimate ? 0.7 : 0.3,
            ease: [0.65, 0, 0.35, 1],
          }}
          className={`preloader-circle-shape ${bgColor ? "" : "preloader-circle-colored"}`}
          style={{
            width: "300vmax",
            height: "300vmax",
            aspectRatio: "1",
            backgroundColor: bgColor,
          }}
        />
        {renderLoadingText()}
      </div>
    );
  };

  const renderSlideVariant = () => {
    const shouldAnimate =
      !prefersReducedMotion || reducedMotionFallback !== "none";
    const isReducedFade =
      prefersReducedMotion && reducedMotionFallback === "fade";

    return (
      <div
        className={`preloader-stairs preloader-${position}`}
        style={{ zIndex }}
        role="status"
        aria-label={ariaLabel}
        aria-live={ariaLive}
      >
        <motion.div
          initial={{ x: "0%" }}
          exit={
            isReducedFade
              ? { opacity: 0 }
              : shouldAnimate
                ? { x: "100%" }
                : { opacity: 0 }
          }
          transition={{
            duration: isReducedFade ? 0.3 : shouldAnimate ? 0.8 : 0.3,
            ease: [0.65, 0, 0.35, 1],
          }}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: bgColor || undefined,
          }}
        >
          {!bgColor && (
            <div
              className="preloader-stair-colored"
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </motion.div>
        {renderLoadingText()}
      </div>
    );
  };

  const renderCurtainVariant = () => {
    const shouldAnimate =
      !prefersReducedMotion || reducedMotionFallback !== "none";
    const isReducedFade =
      prefersReducedMotion && reducedMotionFallback === "fade";

    return (
      <div
        className={`preloader-stairs preloader-${position}`}
        style={{ zIndex }}
        role="status"
        aria-label={ariaLabel}
        aria-live={ariaLive}
      >
        <motion.div
          initial={{ x: "0%" }}
          exit={
            isReducedFade
              ? { opacity: 0 }
              : shouldAnimate
                ? { x: "-100%" }
                : { opacity: 0 }
          }
          transition={{
            duration: isReducedFade ? 0.3 : shouldAnimate ? 0.8 : 0.3,
            ease: [0.65, 0, 0.35, 1],
          }}
          style={{
            width: "50%",
            height: "100%",
            backgroundColor: bgColor || undefined,
          }}
        >
          {!bgColor && (
            <div
              className="preloader-stair-colored"
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </motion.div>

        <motion.div
          initial={{ x: "0%" }}
          exit={
            isReducedFade
              ? { opacity: 0 }
              : shouldAnimate
                ? { x: "100%" }
                : { opacity: 0 }
          }
          transition={{
            duration: isReducedFade ? 0.3 : shouldAnimate ? 0.8 : 0.3,
            ease: [0.65, 0, 0.35, 1],
          }}
          style={{
            width: "50%",
            height: "100%",
            backgroundColor: bgColor || undefined,
          }}
        >
          {!bgColor && (
            <div
              className="preloader-stair-colored"
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </motion.div>
        {renderLoadingText()}
      </div>
    );
  };

  return (
    <div className={`preloader-wrapper ${className}`}>
      <AnimatePresence onExitComplete={onLoadingComplete}>
        {showPreloader && (
          <div key="preloader">
            {customContent ? (
              <div
                className={`preloader-custom preloader-${position}`}
                style={{ zIndex }}
                role="status"
                aria-label={ariaLabel}
                aria-live={ariaLive}
              >
                {customContent(progress)}
              </div>
            ) : (
              <>
                {variant === "stairs" && renderStairsVariant()}
                {variant === "percentage" && renderPercentageVariant()}
                {variant === "circle" && renderCircleVariant()}
                {variant === "slide" && renderSlideVariant()}
                {variant === "curtain" && renderCurtainVariant()}
              </>
            )}
          </div>
        )}
      </AnimatePresence>
      <div
        className={`preloader-content ${showPreloader ? "preloader-content-hidden" : ""}`}
      >
        {children}
      </div>
    </div>
  );
};

Preloader.displayName = "Preloader";

export default Preloader;
