"use client";

import {
  NAV_COMPACT_AFTER_PX,
  NAV_HOVER_INTENT_MS,
  nextNavHover,
  nextNavPin,
  shouldCompactNav,
  type NavPinEvent,
} from "@/lib/nav-compact";
import { useEffect, useRef } from "react";

/**
 * Drives the floating nav's compact state. Renders nothing visible.
 *
 * It sets two attributes on the root element and the stylesheet does the rest, so
 * no React state changes while scrolling:
 *
 * - `data-nav-compact`: the page has scrolled, so the nav shrinks to the mark, the
 *   wordmark and a search icon.
 * - `data-nav-open`: the visitor pinned it open (a press on the expander, which is
 *   how a touch screen gets at the links).
 * - `data-nav-hover`: a mouse is resting on the pill, by the rule in
 *   `nextNavHover` (the brand and the search icon do not open it, because they are
 *   what a visitor aims at and they must not move).
 *
 * Keyboard focus expands a compact nav in CSS alone, via `:focus-visible`.
 *
 * There is deliberately no scroll listener: an `IntersectionObserver` on a
 * one-pixel sentinel reports the one transition that matters (top of page ->
 * scrolled) and costs nothing between the two.
 */
export function NavCompact() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const root = document.documentElement;

    const expander = () => document.querySelector<HTMLElement>("[data-nav-expander]");
    const setPinned = (pinned: boolean) => {
      if (pinned) root.dataset.navOpen = "true";
      else delete root.dataset.navOpen;
      expander()?.setAttribute("aria-expanded", String(pinned));
    };
    const send = (event: NavPinEvent) =>
      setPinned(nextNavPin(root.dataset.navOpen === "true", event));

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const compact = shouldCompactNav({
        isIntersecting: entry.isIntersecting,
        top: entry.boundingClientRect.top,
      });
      if (compact) {
        root.dataset.navCompact = "true";
      } else {
        delete root.dataset.navCompact;
        send("uncompact");
      }
    });
    observer.observe(sentinel);

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-nav-expander]")) send("toggle");
      else if (!target?.closest("#nd-nav")) send("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      send("escape");
      // After a key press the browser treats whatever is focused as `:focus-visible`,
      // and a focused control inside the bar keeps it open. Escape means "close it",
      // so it also lets go of focus there.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest("#nd-nav")) focused.blur();
    };

    let intent: number | undefined;
    const setHover = (hovering: boolean) => {
      if (hovering) root.dataset.navHover = "true";
      else delete root.dataset.navHover;
    };
    const onPointerOver = (event: PointerEvent) => {
      // A touch has no hover; the expander is its way in.
      if (event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target : null;
      const hovering = root.dataset.navHover === "true";
      const wants = nextNavHover(hovering, {
        insidePill: Boolean(target?.closest("#nd-nav > div")),
        onSteadyControl: Boolean(target?.closest('a[href="/"], [data-search-full]')),
      });
      window.clearTimeout(intent);
      if (wants === hovering) return;
      // Closing is immediate (the stylesheet lingers); opening waits a beat so
      // sweeping the pointer across the pill does not trigger it.
      if (wants) intent = window.setTimeout(() => setHover(true), NAV_HOVER_INTENT_MS);
      else setHover(false);
    };
    const onPointerLeave = () => {
      window.clearTimeout(intent);
      setHover(false);
    };
    document.addEventListener("pointerover", onPointerOver);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      observer.disconnect();
      window.clearTimeout(intent);
      document.removeEventListener("pointerover", onPointerOver);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("pointerdown", onPointerDown);
      delete root.dataset.navHover;
      document.removeEventListener("keydown", onKeyDown);
      delete root.dataset.navCompact;
      setPinned(false);
    };
  }, []);

  return (
    <div
      ref={sentinelRef}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 h-px w-px"
      style={{ top: NAV_COMPACT_AFTER_PX }}
    />
  );
}
