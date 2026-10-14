"use client";

import { DEFAULT_THEME_ID, kunaiThemes, THEME_STORAGE_KEY, type ThemeReveal } from "@/lib/themes";
import { useCallback, useEffect, useState } from "react";

/** How long the whole-page reveal takes to cover the viewport. */
const REVEAL_MS = 640;
const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The DOM is the single source of truth for the worn coat — the orb and the
 *  pull cord each hold a hook instance, so index state cannot be the truth. */
function readIndex(): number {
  const applied = document.documentElement.dataset.theme ?? DEFAULT_THEME_ID;
  const found = kunaiThemes.findIndex((theme) => theme.id === applied);
  return found < 0 ? 0 : found;
}

/**
 * The skiper26 reveal variants as WAAPI keyframes for `::view-transition-new`.
 * `x`/`y` is the activation point in viewport pixels; `w`/`h` the viewport.
 * Every end state covers the full viewport so the new coat lands everywhere.
 */
function revealKeyframes(
  reveal: ThemeReveal,
  x: number,
  y: number,
  w: number,
  h: number,
): PropertyIndexedKeyframes {
  switch (reveal) {
    case "circle": {
      const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
      return {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
      };
    }
    case "circle-blur": {
      const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
      return {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        filter: ["blur(10px)", "blur(0px)"],
      };
    }
    case "rise":
      return { clipPath: ["inset(100% 0% 0% 0%)", "inset(0% 0% 0% 0%)"] };
    case "diagonal":
      return {
        clipPath: [
          "polygon(0% 0%, 0% 0%, -25% 100%, 0% 100%)",
          "polygon(0% 0%, 125% 0%, 100% 100%, 0% 100%)",
        ],
      };
    case "unfold":
      return {
        clipPath: [`inset(${y}px ${w - x}px ${h - y}px ${x}px)`, "inset(0px 0px 0px 0px)"],
      };
  }
}

/**
 * The coat cycle, shared by every control that can change it — the nav orb
 * and the pull cord alike. `cycle(x, y)` advances to the next coat, persists
 * it, and seeds its signature reveal from the activation point: a bloom from
 * the orb, a bloom from the rope's knob when Kanna's cord is yanked. `index`
 * mirrors `data-theme` through a MutationObserver, so every control wearing
 * this hook stays in step no matter which one fired.
 */
export function useCoatCycler() {
  const [index, setIndex] = useState(0);
  // The coat a transition is still leaving — the orb eclipses away from it.
  const [fromIndex, setFromIndex] = useState(0);

  useEffect(() => {
    setIndex(readIndex());
    setFromIndex(readIndex());
    const observer = new MutationObserver(() => setIndex(readIndex()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const cycle = useCallback((originX?: number, originY?: number) => {
    const current = readIndex();
    const next = (current + 1) % kunaiThemes.length;
    setFromIndex(current);
    setIndex(next);

    const apply = () => {
      const id = kunaiThemes[next]?.id ?? DEFAULT_THEME_ID;
      if (id === DEFAULT_THEME_ID) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = id;
    };
    try {
      localStorage.setItem(THEME_STORAGE_KEY, kunaiThemes[next]?.id ?? DEFAULT_THEME_ID);
    } catch {
      // Private mode may refuse the write; the coat still applies for the visit.
    }

    const x = originX ?? window.innerWidth / 2;
    const y = originY ?? 64;
    if (!reducedMotion() && "startViewTransition" in document) {
      const reveal = kunaiThemes[next]?.reveal ?? "circle";
      document
        .startViewTransition(apply)
        .ready.then(() =>
          document.documentElement.animate(
            revealKeyframes(reveal, x, y, window.innerWidth, window.innerHeight),
            {
              duration: REVEAL_MS,
              easing: EASE_DRAWER,
              pseudoElement: "::view-transition-new(root)",
            },
          ),
        )
        .catch(() => {});
    } else {
      apply();
    }

    return next;
  }, []);

  return { index, fromIndex, setIndex, setFromIndex, cycle };
}
