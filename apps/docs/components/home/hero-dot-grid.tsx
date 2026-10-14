"use client";

import { useEffect, useRef } from "react";

/**
 * The hero's dot-grid spotlight, after chanhdai's dot-grid-spotlight: a field
 * of pin dots over the whole hero plus an accent-tinted copy masked to a soft
 * pool that follows the pointer. One window listener writes two custom
 * properties — no React renders, no state. The mask is a radial gradient, so
 * there is no element to collide with content; it is paint only. Fine
 * pointers only: touch gets the faint base field and never the pool.
 */
export function HeroDotGrid() {
  const litRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const lit = litRef.current;
    const host = lit?.parentElement;
    if (!lit || !host || !window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      lit.style.setProperty("--mx", `${event.clientX - box.left}px`);
      lit.style.setProperty("--my", `${event.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <>
      <div className="kunai-dotgrid" aria-hidden="true" />
      <div ref={litRef} className="kunai-dotgrid kunai-dotgrid--lit" aria-hidden="true" />
    </>
  );
}
