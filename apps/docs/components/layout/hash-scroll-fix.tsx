"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Lands a `#hash` on its target even after the page settles.
 *
 * A hash link lands where the browser first puts the anchor — before fonts swap
 * in, before generated tables and code figures take their real height, and on
 * client-side navigations sometimes before the target exists at all. Every one
 * of those shifts pushes the anchor away from where the scroll stopped, which
 * reads as "the link took me near it, not to it".
 *
 * This re-anchors twice: once after the first paint, once after fonts finish
 * loading (the last big layout shift on a text page). It runs on mount and on
 * every pathname change, so `/docs/x#y` typed directly and clicked from another
 * page both land correctly. `scrollIntoView` honours the element's
 * `scroll-margin` and `html`'s `scroll-padding`, so the heading still clears
 * the sticky nav. Smooth scrolling is the stylesheet's call.
 */
export function HashScrollFix() {
  const pathname = usePathname();

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;

    const anchor = () => document.getElementById(hash)?.scrollIntoView();
    const frame = requestAnimationFrame(anchor);
    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) anchor();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
