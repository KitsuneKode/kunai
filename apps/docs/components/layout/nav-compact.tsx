"use client";

import { NAV_COMPACT_AFTER_PX, shouldCompactNav } from "@/lib/nav-compact";
import { useEffect, useRef } from "react";

/** Pointer approach distance around the compact desktop pill before expanding. */
const APPROACH_PX = 44;
/** Hysteresis exit radius so hovering near the pill edge never flickers. */
const LEAVE_PX = 76;
/** Brief grace period before re-compacting once pointer leaves the nav zone. */
const COLLAPSE_DELAY_MS = 180;

/**
 * Smart desktop scroll-shrinking navbar with proximity/hover expansion.
 *
 * - On scroll past `NAV_COMPACT_AFTER_PX`, sets `data-nav-compact="true"` on
 *   `<html>` via `IntersectionObserver` (zero scroll listeners).
 * - On desktop (`min-width: 768px` and `pointer: fine`), approaching within
 *   `APPROACH_PX` of the floating pill, hovering it, or focusing inside it sets
 *   `data-nav-expanded="true"` so secondary links smoothly unfurl without
 *   shifting page content below.
 * - On mobile/touch viewports, expansion logic stays inert and Fumadocs' native
 *   mobile popover handles full navigation.
 */
export function NavCompact() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const root = document.documentElement;
    let isCompact = false;
    let isExpanded = false;
    let collapseTimer: number | null = null;
    let rafId: number | null = null;

    const clearCollapseTimer = () => {
      if (collapseTimer !== null) {
        window.clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    };

    const setExpanded = (next: boolean) => {
      if (isExpanded === next) return;
      isExpanded = next;
      if (next) root.dataset.navExpanded = "true";
      else delete root.dataset.navExpanded;
    };

    const scheduleCollapse = () => {
      clearCollapseTimer();
      collapseTimer = window.setTimeout(() => {
        const nav = document.querySelector("#nd-home-layout #nd-nav");
        if (nav && nav.contains(document.activeElement)) return;
        setExpanded(false);
      }, COLLAPSE_DELAY_MS);
    };

    const desktopFineQuery = window.matchMedia("(min-width: 768px) and (pointer: fine)");
    // At 1024px+ the header shows its links inline and hides the menu toggle. A
    // touch user there cannot hover the pill open, so the nav never compacts.
    const coarseWideQuery = window.matchMedia("(min-width: 1024px) and (pointer: coarse)");
    let pastThreshold = false;

    const applyCompact = () => {
      isCompact = pastThreshold && !coarseWideQuery.matches;
      if (isCompact) {
        root.dataset.navCompact = "true";
        // Compacting under a focused link would clip it with no way back:
        // focus did not move, so focusin never fires.
        const nav = document.querySelector("#nd-home-layout #nd-nav");
        if (nav && nav.contains(document.activeElement)) {
          clearCollapseTimer();
          setExpanded(true);
        }
      } else {
        delete root.dataset.navCompact;
        clearCollapseTimer();
        setExpanded(false);
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      pastThreshold = shouldCompactNav({
        isIntersecting: entry.isIntersecting,
        top: entry.boundingClientRect.top,
      });
      applyCompact();
    });
    observer.observe(sentinel);
    coarseWideQuery.addEventListener("change", applyCompact);

    const onPointerMove = (event: PointerEvent) => {
      if (!isCompact || !desktopFineQuery.matches) return;
      if (rafId !== null) return;
      const { clientX, clientY } = event;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const pill = document.querySelector("#nd-home-layout #nd-nav > div");
        if (!pill) return;
        const rect = pill.getBoundingClientRect();
        const pad = isExpanded ? LEAVE_PX : APPROACH_PX;
        const inside =
          clientX >= rect.left - pad &&
          clientX <= rect.right + pad &&
          clientY >= rect.top - pad &&
          clientY <= rect.bottom + pad;
        if (inside) {
          clearCollapseTimer();
          setExpanded(true);
        } else if (isExpanded) {
          scheduleCollapse();
        }
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isCompact || !desktopFineQuery.matches) return;
      const nav = document.querySelector("#nd-home-layout #nd-nav");
      if (nav && event.target instanceof Node && nav.contains(event.target)) {
        clearCollapseTimer();
        setExpanded(true);
      }
    };

    const onFocusOut = () => {
      if (!isCompact || !desktopFineQuery.matches) return;
      scheduleCollapse();
    };

    // Gliding hover highlight pill across desktop home nav links
    let glideEl: HTMLSpanElement | null = null;
    const ensureGlide = (container: HTMLElement) => {
      if (glideEl && container.contains(glideEl)) return glideEl;
      const existing = container.querySelector<HTMLSpanElement>(".kunai-nav-glide");
      if (existing) {
        glideEl = existing;
        return existing;
      }
      const span = document.createElement("span");
      span.className = "kunai-nav-glide";
      span.setAttribute("aria-hidden", "true");
      container.prepend(span);
      glideEl = span;
      return span;
    };

    const onNavOver = (event: PointerEvent) => {
      if (!desktopFineQuery.matches) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("#nd-home-layout #nd-nav ul a");
      const pill = document.querySelector<HTMLElement>("#nd-home-layout #nd-nav > div");
      if (!pill) return;
      if (!link) {
        glideEl?.classList.remove("is-visible");
        return;
      }
      const glide = ensureGlide(pill);
      const pillRect = pill.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      glide.style.width = `${Math.round(linkRect.width + 12)}px`;
      glide.style.transform = `translate3d(${Math.round(linkRect.left - pillRect.left - 6)}px, -50%, 0)`;
      glide.classList.add("is-visible");
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerover", onNavOver, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerover", onNavOver);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      coarseWideQuery.removeEventListener("change", applyCompact);
      clearCollapseTimer();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      glideEl?.remove();
      delete root.dataset.navCompact;
      delete root.dataset.navExpanded;
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
