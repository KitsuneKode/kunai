"use client";

import { type ComponentType, useEffect, useRef, useState } from "react";

/**
 * Idle/pointer-gated wrapper for `KunaiFoxRoamer`.
 * Keeps the roamer, vector walker rig, and gait maths out of initial first-paint
 * JS on every route — and never downloads the chunk on touch devices or under
 * `prefers-reduced-motion`. If either preference changes later, eligibility is
 * re-checked, so turning reduced motion off still brings her in.
 */
export function KunaiFoxRoamerIsland() {
  const [Roamer, setRoamer] = useState<ComponentType | null>(null);
  const mountedRoamer = useRef(false);
  const pendingRestore = useRef(false);

  useEffect(() => {
    mountedRoamer.current = Roamer !== null;
    // A "Bring Kanna back" click that landed before the roamer chunk arrived is
    // replayed now. Child effects run first, so the roamer is already listening.
    if (Roamer && pendingRestore.current) {
      pendingRestore.current = false;
      window.dispatchEvent(new Event("kunai:roamer-restore"));
    }
  }, [Roamer]);

  useEffect(() => {
    const onRestore = () => {
      if (!mountedRoamer.current) pendingRestore.current = true;
    };
    window.addEventListener("kunai:roamer-restore", onRestore);
    return () => window.removeEventListener("kunai:roamer-restore", onRestore);
  }, []);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let requested = false;
    let teardownSchedule: (() => void) | undefined;

    const load = () => {
      if (requested || cancelled) return;
      requested = true;
      const run = async () => {
        try {
          const mod = await import("./kunai-fox-roamer");
          if (!cancelled) setRoamer(() => mod.KunaiFoxRoamer);
        } catch {
          // A failed chunk (offline, deploy swap) releases the latch so the
          // next pointer move or preference change can try again.
          requested = false;
          if (!cancelled) {
            window.addEventListener("pointermove", load, { once: true, passive: true });
          }
        }
      };
      void run();
    };

    const schedule = () => {
      teardownSchedule?.();
      teardownSchedule = undefined;
      if (requested || !fine.matches || reduced.matches) return;
      window.addEventListener("pointermove", load, { once: true, passive: true });
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(load, { timeout: 2600 });
        teardownSchedule = () => {
          window.removeEventListener("pointermove", load);
          window.cancelIdleCallback(id);
        };
        return;
      }
      const idleTimer = globalThis.setTimeout(load, 1800);
      teardownSchedule = () => {
        window.removeEventListener("pointermove", load);
        globalThis.clearTimeout(idleTimer);
      };
    };

    schedule();
    fine.addEventListener("change", schedule);
    reduced.addEventListener("change", schedule);
    return () => {
      cancelled = true;
      teardownSchedule?.();
      fine.removeEventListener("change", schedule);
      reduced.removeEventListener("change", schedule);
    };
  }, []);

  return Roamer ? <Roamer /> : null;
}
