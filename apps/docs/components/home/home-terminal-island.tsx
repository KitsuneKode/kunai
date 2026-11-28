"use client";

import { useHomeStage } from "@/components/home/home-stage-context";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { HomeCommandMetadata, HomeProviderMetadata } from "./types";

type SimulatorProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly cliVersion: string;
  readonly publishedVersion?: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

type HomeTerminalIslandProps = SimulatorProps & {
  /** Server-rendered frame held until the interactive simulator chunk arrives. */
  readonly fallback: ReactNode;
};

/** Loads the interactive terminal simulator on browser idle or first interaction. */
export function HomeTerminalIsland({ fallback, ...simulatorProps }: HomeTerminalIslandProps) {
  const { registerTerminalLoader } = useHomeStage();
  const [Simulator, setSimulator] = useState<ComponentType<SimulatorProps> | null>(null);
  const requestedRef = useRef(false);
  const mountedRef = useRef(true);

  const loadSimulator = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    const load = async () => {
      try {
        const module = await import("./terminal-simulator");
        if (mountedRef.current) setSimulator(() => module.TerminalSimulator);
      } catch {
        // The static frame stays up; the next pointer, focus or hero command retries.
        requestedRef.current = false;
      }
    };
    void load();
  }, []);

  useEffect(() => {
    registerTerminalLoader(loadSimulator);
    return () => registerTerminalLoader(null);
  }, [loadSimulator, registerTerminalLoader]);

  useEffect(() => {
    mountedRef.current = true;
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(loadSimulator, { timeout: 1200 });
      return () => {
        mountedRef.current = false;
        window.cancelIdleCallback(idleId);
      };
    }
    const timer = globalThis.setTimeout(loadSimulator, 800);
    return () => {
      mountedRef.current = false;
      globalThis.clearTimeout(timer);
    };
  }, [loadSimulator]);

  if (!Simulator) {
    return (
      <div
        onPointerEnter={loadSimulator}
        onPointerDown={loadSimulator}
        onFocusCapture={loadSimulator}
      >
        {fallback}
      </div>
    );
  }
  return <Simulator {...simulatorProps} />;
}
