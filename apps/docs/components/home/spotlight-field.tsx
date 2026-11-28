"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Delegated cursor-spotlight border controller.
 * One rAF-batched `pointermove` listener per section writes `--mx`/`--my` and
 * `data-spot="true"` onto the hovered `.kunai-spotlight` surface.
 */
export function SpotlightField({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return undefined;
    }

    let rafId: number | null = null;
    let activeCard: HTMLElement | null = null;

    const clearActive = () => {
      if (activeCard) {
        delete activeCard.dataset.spot;
        activeCard = null;
      }
    };

    const onMove = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const card = target?.closest<HTMLElement>(".kunai-spotlight") ?? null;
      const { clientX, clientY } = event;
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (card !== activeCard) clearActive();
        if (!card || !host.contains(card)) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${(clientX - rect.left).toFixed(1)}px`);
        card.style.setProperty("--my", `${(clientY - rect.top).toFixed(1)}px`);
        card.dataset.spot = "true";
        activeCard = card;
      });
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", clearActive);

    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", clearActive);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      clearActive();
    };
  }, []);

  return (
    <div ref={hostRef} className={className}>
      {children}
    </div>
  );
}
