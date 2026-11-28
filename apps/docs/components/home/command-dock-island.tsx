"use client";

import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";
import { type ComponentType, useEffect, useState } from "react";

type DockProps = {
  readonly commands: readonly HomeCommandMetadata[];
  readonly providers: readonly HomeProviderMetadata[];
  readonly initialOpen?: boolean;
};

/**
 * Defers the bottom Command Dock + morphing spring drawer (`@base-ui/react/dialog` +
 * `motion/react` `domMax`) off initial first paint. Loads on first scroll, `/` keypress,
 * or browser idle, and honours an early `/` press immediately once hydrated.
 */
export function CommandDockIsland({
  commands,
  providers,
}: {
  readonly commands: readonly HomeCommandMetadata[];
  readonly providers: readonly HomeProviderMetadata[];
}) {
  const [Dock, setDock] = useState<ComponentType<DockProps> | null>(null);
  const [openOnMount, setOpenOnMount] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let requested = false;

    const load = (openImmediately = false) => {
      if (openImmediately) setOpenOnMount(true);
      if (requested) return;
      requested = true;
      const run = async () => {
        try {
          const mod = await import("./command-dock");
          if (!cancelled) setDock(() => mod.CommandDock);
        } catch {
          // A failed chunk releases the latch: the next scroll or `/` retries.
          requested = false;
        }
      };
      void run();
    };

    const onScroll = () => {
      if (window.scrollY > 180) load(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.closest(".kunai-terminal-stage"))
      ) {
        return;
      }
      event.preventDefault();
      load(true);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => load(false), { timeout: 2200 });
      return () => {
        cancelled = true;
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("keydown", onKeyDown);
        window.cancelIdleCallback(id);
      };
    }

    const timer = globalThis.setTimeout(() => load(false), 1600);
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKeyDown);
      globalThis.clearTimeout(timer);
    };
  }, []);

  return Dock ? <Dock commands={commands} providers={providers} initialOpen={openOnMount} /> : null;
}
