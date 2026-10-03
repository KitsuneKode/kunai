"use client";

import { BACK_TO_TOP_AFTER_PX, isScrolledPast } from "@/lib/scrolled-past";
import { IconArrowUp } from "@tabler/icons-react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

/** The ring's radius in the 44-unit box the button is drawn in, and its length. */
const RADIUS = 19;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A way back to the top of a long page, drawn with a ring that fills as you read.
 *
 * It appears once you are about a screen and a half down and is gone again at the
 * top, so it is never on the page when it has nothing to do. The ring is the scroll
 * position: it fills as you go, which makes the button double as a "how far through
 * am I" without adding a bar to the top of the page. It is written straight to the
 * SVG attribute from motion's scroll value, so scrolling never renders React.
 *
 * It is a real button 44px square, named for assistive tech, and while it is hidden
 * it is `inert`, so it cannot be tabbed to or clicked invisibly. Pressing it scrolls
 * smoothly unless the visitor asked for reduced motion, and moves focus to the top of
 * the page: leaving it on a button that then hides would drop focus on the floor.
 */
export function BackToTop() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const [visible, setVisible] = useState(false);
  const { scrollYProgress } = useScroll();

  const paint = useCallback((progress: number) => {
    ringRef.current?.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE * (1 - progress)));
  }, []);
  useMotionValueEvent(scrollYProgress, "change", paint);

  useEffect(() => {
    paint(scrollYProgress.get());
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setVisible(
        isScrolledPast({ isIntersecting: entry.isIntersecting, top: entry.boundingClientRect.top }),
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [paint, scrollYProgress]);

  const goToTop = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    document.querySelector<HTMLElement>("#nd-nav a")?.focus({ preventScroll: true });
  };

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 h-px w-px"
        style={{ top: BACK_TO_TOP_AFTER_PX }}
      />
      <div
        inert={!visible}
        className={`fixed right-4 bottom-4 z-40 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] sm:right-6 sm:bottom-6 ${
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={goToTop}
          aria-label="Back to top"
          title="Back to top"
          className="focus-visible:ring-ring relative flex size-11 items-center justify-center rounded-full border border-[var(--kunai-line)] bg-[color-mix(in_oklab,var(--kunai-surface)_88%,transparent)] text-[var(--kunai-accent)] shadow-[var(--kunai-shadow-md)] backdrop-blur-md transition-[transform,border-color,color] duration-150 ease-[var(--ease-out)] outline-none hover:-translate-y-0.5 hover:border-[var(--kunai-accent-deep)] hover:text-[var(--kunai-accent-soft)] focus-visible:ring-2 active:scale-[0.94]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 44 44"
            className="absolute inset-0 size-full -rotate-90"
            fill="none"
          >
            <circle
              cx="22"
              cy="22"
              r={RADIUS}
              stroke="var(--kunai-line)"
              strokeWidth="2"
              opacity="0.7"
            />
            <circle
              ref={ringRef}
              cx="22"
              cy="22"
              r={RADIUS}
              stroke="var(--kunai-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE}
            />
          </svg>
          <IconArrowUp className="relative size-[18px]" stroke={1.75} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
