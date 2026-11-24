"use client";

import { type ComponentType, useEffect, useState } from "react";

/**
 * Idle/pointer-gated wrapper for `KunaiFoxRoamer`.
 * Keeps the roamer, vector walker rig, and gait maths out of initial first-paint
 * JS on every route — and never downloads the chunk on touch devices or under
 * `prefers-reduced-motion`.
 */
export function KunaiFoxRoamerIsland() {
  const [Roamer, setRoamer] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    let cancelled = false;
    let requested = false;

    const load = () => {
      if (requested) return;
      requested = true;
      const run = async () => {
        const mod = await import("./kunai-fox-roamer");
        if (!cancelled) setRoamer(() => mod.KunaiFoxRoamer);
      };
      void run();
    };

    window.addEventListener("pointermove", load, { once: true, passive: true });
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 2600 });
      return () => {
        cancelled = true;
        window.removeEventListener("pointermove", load);
        window.cancelIdleCallback(id);
      };
    }
    const idleTimer = globalThis.setTimeout(load, 1800);
    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", load);
      globalThis.clearTimeout(idleTimer);
    };
  }, []);

  return Roamer ? <Roamer /> : null;
}
