"use client";

import { NAV_COMPACT_AFTER_PX, shouldCompactNav } from "@/lib/nav-compact";
import { INITIAL_NAV_INTERACTION, isNavCompact, reduceNavInteraction } from "@/lib/nav-interaction";
import { Header } from "fumadocs-ui/layouts/home/slots/header";
import { m, LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useReducer } from "react";

const MotionHeader = m.create(Header);
const loadNavFeatures = () => import("motion/react").then((module) => module.domMax);

/** Position projection keeps labels crisp while the pill changes its contents. */
export function NavLabel({ children }: { readonly children: ReactNode }) {
  return (
    <m.span layout="position" className="inline-flex items-center">
      {children}
    </m.span>
  );
}

/** Home navigation has its own mobile menu, independent of the docs sidebar. */
export function NavCompact(props: ComponentProps<"header">) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [state, dispatch] = useReducer(reduceNavInteraction, INITIAL_NAV_INTERACTION);
  const { hovered, focused } = state;
  const reduced = useReducedMotion();

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry)
        dispatch({
          type: "scroll-position",
          scrolled: shouldCompactNav({
            isIntersecting: entry.isIntersecting,
            top: entry.boundingClientRect.top,
          }),
        });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Only listen while a hover has opened the bar. A later scroll dismisses that
  // expansion; focus keeps keyboard users' current destination on screen.
  useEffect(() => {
    if (!hovered) return undefined;
    const collapse = () => dispatch({ type: "scroll" });
    window.addEventListener("scroll", collapse, { passive: true });
    return () => window.removeEventListener("scroll", collapse);
  }, [hovered]);

  const {
    onAnimationStart: _onAnimationStart,
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    ...headerProps
  } = props;

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 h-px w-px"
        style={{ top: NAV_COMPACT_AFTER_PX }}
      />
      <LazyMotion features={loadNavFeatures}>
        <MotionConfig
          transition={{
            layout: { duration: reduced || focused ? 0 : 0.22, ease: [0.23, 1, 0.32, 1] },
          }}
        >
          <MotionHeader
            {...headerProps}
            layout
            data-compact={isNavCompact(state)}
            data-focused={focused}
            onPointerEnter={(event) => {
              props.onPointerEnter?.(event);
              if (
                event.pointerType === "mouse" &&
                window.matchMedia("(hover: hover) and (pointer: fine)").matches
              )
                dispatch({ type: "hover", hovered: true });
            }}
            onPointerLeave={(event) => {
              props.onPointerLeave?.(event);
              dispatch({ type: "scroll" });
            }}
            onFocusCapture={(event) => {
              props.onFocusCapture?.(event);
              dispatch({ type: "focus", focused: true });
            }}
            onBlurCapture={(event) => {
              props.onBlurCapture?.(event);
              if (!event.currentTarget.contains(event.relatedTarget))
                dispatch({ type: "focus", focused: false });
            }}
          />
        </MotionConfig>
      </LazyMotion>
    </>
  );
}
