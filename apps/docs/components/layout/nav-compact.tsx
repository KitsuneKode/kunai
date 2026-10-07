"use client";

import { NAV_COMPACT_AFTER_PX, shouldCompactNav } from "@/lib/nav-compact";
import { useEffect, useRef } from "react";

/**
 * Shrinks the floating nav once the page has been scrolled.
 *
 * It sets `data-nav-compact` on the root element and the stylesheet does the rest,
 * so the component renders nothing visible and no React state changes while
 * scrolling. There is deliberately no scroll listener: an `IntersectionObserver` on
 * a one-pixel sentinel reports the one transition that matters (top of page ->
 * scrolled) and costs nothing between the two.
 *
 * The shrink itself is a `transform: scale()` in CSS, which stays on the
 * compositor. Animating the nav's width or padding would reflow the whole bar on
 * every frame of the transition.
 */
export function NavCompact() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const root = document.documentElement;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const compact = shouldCompactNav({
        isIntersecting: entry.isIntersecting,
        top: entry.boundingClientRect.top,
      });
      if (compact) root.dataset.navCompact = "true";
      else delete root.dataset.navCompact;
    });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      delete root.dataset.navCompact;
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
