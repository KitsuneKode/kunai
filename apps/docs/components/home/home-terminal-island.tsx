"use client";

import { type ComponentType, type ReactNode, useEffect, useState } from "react";

import type { HomeCommandMetadata, HomeProviderMetadata } from "./types";

type SimulatorProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

type HomeTerminalIslandProps = SimulatorProps & {
  /**
   * The server-rendered frame. Held on screen until the simulator chunk has
   * actually arrived, so the hero never flashes an empty placeholder.
   */
  readonly fallback: ReactNode;
};

/**
 * Loads the terminal simulator on the client only.
 *
 * This used `next/dynamic` with `ssr: false` and an `animate-pulse` box. That
 * put a blank rectangle in the initial HTML and, because nothing under an
 * `ssr: false` boundary is prerendered, kept every word the simulator prints
 * out of the server response. The import is still its own chunk; the
 * difference is that the frame beneath it is real, server-rendered content.
 */
export function HomeTerminalIsland({ fallback, ...simulatorProps }: HomeTerminalIslandProps) {
  const [Simulator, setSimulator] = useState<ComponentType<SimulatorProps> | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const module = await import("./terminal-simulator");
      if (active) setSimulator(() => module.TerminalSimulator);
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (!Simulator) return fallback;
  return <Simulator {...simulatorProps} />;
}
