"use client";

import type { DirectoryLaneFilter, HeroLane } from "@/lib/provider-sieve";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export const SPRING_SNAP = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const;
export const SPRING_SETTLE = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 260, damping: 30, mass: 1 } as const;

export const LANE_DEMO_COMMAND: Record<HeroLane, string> = {
  anime: "/anime Frieren",
  series: "/series Severance",
  movie: "/series Dune",
  youtube: "/youtube lofi radio",
};

type RunOptions = {
  readonly scroll?: boolean;
};

type HomeStageContextValue = {
  readonly activeLane: HeroLane;
  readonly setActiveLane: (lane: HeroLane, options?: { readonly runDemo?: boolean }) => void;
  readonly directoryLane: DirectoryLaneFilter;
  readonly setDirectoryLane: (lane: DirectoryLaneFilter) => void;
  readonly terminalStageRef: RefObject<HTMLDivElement | null>;
  readonly directoryRef: RefObject<HTMLElement | null>;
  readonly runTerminalCommand: (command: string, options?: RunOptions) => void;
  readonly focusDirectory: (lane?: DirectoryLaneFilter) => void;
  readonly registerTerminalRunner: (runner: ((command: string) => void) | null) => void;
  readonly registerTerminalLoader: (loader: (() => void) | null) => void;
};

const HomeStageContext = createContext<HomeStageContextValue | null>(null);

export function HomeStageProvider({ children }: { readonly children: ReactNode }) {
  const [activeLane, setActiveLaneState] = useState<HeroLane>("anime");
  const [directoryLane, setDirectoryLane] = useState<DirectoryLaneFilter>("all");

  const terminalStageRef = useRef<HTMLDivElement | null>(null);
  const directoryRef = useRef<HTMLElement | null>(null);
  const runnerRef = useRef<((command: string) => void) | null>(null);
  const loaderRef = useRef<(() => void) | null>(null);
  const pendingCommandRef = useRef<string | null>(null);

  const scrollIntoStage = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, []);

  const runTerminalCommand = useCallback(
    (command: string, options?: RunOptions) => {
      if (options?.scroll) scrollIntoStage(terminalStageRef.current);
      if (runnerRef.current) {
        runnerRef.current(command);
        return;
      }
      pendingCommandRef.current = command;
      loaderRef.current?.();
    },
    [scrollIntoStage],
  );

  const registerTerminalRunner = useCallback((runner: ((command: string) => void) | null) => {
    runnerRef.current = runner;
    if (runner && pendingCommandRef.current) {
      const queued = pendingCommandRef.current;
      pendingCommandRef.current = null;
      runner(queued);
    }
  }, []);

  const registerTerminalLoader = useCallback((loader: (() => void) | null) => {
    loaderRef.current = loader;
  }, []);

  const setActiveLane = useCallback(
    (lane: HeroLane, options?: { readonly runDemo?: boolean }) => {
      setActiveLaneState(lane);
      if (options?.runDemo) {
        runTerminalCommand(LANE_DEMO_COMMAND[lane]);
      }
    },
    [runTerminalCommand],
  );

  const focusDirectory = useCallback(
    (lane?: DirectoryLaneFilter) => {
      if (lane) setDirectoryLane(lane);
      scrollIntoStage(directoryRef.current);
    },
    [scrollIntoStage],
  );

  const value = useMemo<HomeStageContextValue>(
    () => ({
      activeLane,
      setActiveLane,
      directoryLane,
      setDirectoryLane,
      terminalStageRef,
      directoryRef,
      runTerminalCommand,
      focusDirectory,
      registerTerminalRunner,
      registerTerminalLoader,
    }),
    [
      activeLane,
      setActiveLane,
      directoryLane,
      runTerminalCommand,
      focusDirectory,
      registerTerminalRunner,
      registerTerminalLoader,
    ],
  );

  return <HomeStageContext.Provider value={value}>{children}</HomeStageContext.Provider>;
}

export function useHomeStage(): HomeStageContextValue {
  const ctx = useContext(HomeStageContext);
  if (!ctx) {
    throw new Error("useHomeStage must be used inside HomeStageProvider");
  }
  return ctx;
}
