import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";

import type { LoadingShellState } from "./types";
import { Badge, DetailLine } from "./shell-primitives";
import { palette } from "./shell-theme";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function useSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return SPINNER_FRAMES[frame];
}

function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

function usePulse(periodMs: number): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const phase = ((Date.now() - start) % periodMs) / periodMs;
      setOn(phase < 0.5);
    }, 80);
    return () => clearInterval(timer);
  }, [periodMs]);
  return on;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${String(s)}s`;
}

function formatMemoryUsage(): string {
  const memory = process.memoryUsage();
  const toMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `Mem  RSS ${toMb(memory.rss)}  ·  Heap ${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)}`;
}

function renderPhaseRail(active: LoadingShellState["operation"]): readonly {
  label: string;
  tone: "neutral" | "info" | "success";
}[] {
  const order: readonly LoadingShellState["operation"][] = [
    "searching",
    "scraping",
    "resolving",
    "playing",
  ];
  const activeIndex = order.indexOf(active);

  return order.map((phase, index) => ({
    label: phase === "playing" ? "play" : phase,
    tone: index < activeIndex ? "success" : index === activeIndex ? "info" : "neutral",
  }));
}

export function LoadingShell({
  state,
  onCancel,
  onStop,
  onRefresh,
  onFallback,
  onReloadSubtitles,
}: {
  state: LoadingShellState;
  onCancel?: () => void;
  onStop?: () => void;
  onRefresh?: () => void;
  onFallback?: () => void;
  onReloadSubtitles?: () => void;
}) {
  const spinner = useSpinner();
  const elapsed = useElapsed();
  const pulse = usePulse(1400);
  const { stdout } = useStdout();

  useInput((input, key) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
    }
    if (input.toLowerCase() === "q" && state.operation === "playing" && onStop) {
      onStop();
    }
    if (input.toLowerCase() === "r" && state.operation === "playing" && onRefresh) {
      onRefresh();
    }
    if (input.toLowerCase() === "f" && state.operation === "playing" && onFallback) {
      onFallback();
    }
    if (input.toLowerCase() === "s" && state.operation === "playing" && onReloadSubtitles) {
      onReloadSubtitles();
    }
  });

  const isPlaying = state.operation === "playing";
  const leadIcon = isPlaying ? "▶" : spinner;
  const accentColor = isPlaying ? palette.green : pulse ? palette.cyan : "white";
  const separatorWidth = Math.min(52, Math.max(24, (stdout.columns ?? 80) - 22));
  const infoWidth = Math.min(76, Math.max(40, (stdout.columns ?? 80) - 12));
  const subtitleTone =
    state.subtitleStatus?.includes("attached") || state.subtitleStatus?.includes("available")
      ? "success"
      : "warning";

  const operationLabels: Record<LoadingShellState["operation"], string> = {
    searching: "Searching",
    scraping: "Scraping",
    resolving: "Resolving stream",
    playing: "Now playing",
    loading: "Loading",
  };
  const phaseRail =
    state.operation === "loading"
      ? [{ label: "loading", tone: "info" as const }]
      : renderPhaseRail(state.operation);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" paddingX={2} paddingY={1}>
      <Box flexDirection="column" width={infoWidth}>
        <Box>
          <Badge
            label={operationLabels[state.operation].toLowerCase()}
            tone={isPlaying ? "success" : "info"}
          />
          {state.details ? <Badge label={state.details.toLowerCase()} tone="neutral" /> : null}
          {state.subtitleStatus ? <Badge label={state.subtitleStatus} tone={subtitleTone} /> : null}
        </Box>
        <Box marginTop={1}>
          <Text color={accentColor}>{leadIcon} </Text>
          <Text bold color="white">
            {state.title}
          </Text>
        </Box>
        {state.subtitle && (
          <Box marginLeft={2}>
            <Text color={palette.muted}>{state.subtitle}</Text>
          </Box>
        )}

        <Box marginY={1}>
          <Text color={palette.muted} dimColor>
            {"─".repeat(separatorWidth)}
          </Text>
        </Box>

        <Box flexWrap="wrap">
          {phaseRail.map((phase, index) => (
            <Badge key={`${phase.label}-${index}`} label={phase.label} tone={phase.tone} />
          ))}
        </Box>

        <Box>
          <Text color={accentColor}>{operationLabels[state.operation]}</Text>
          <Text color={palette.gray} dimColor>
            {"  "}
            {isPlaying ? "Playback shell stays alive in the background" : "Gathering stream data"}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {state.subtitleStatus ? (
            <DetailLine label="Subtitle state" value={state.subtitleStatus} tone={subtitleTone} />
          ) : null}
          <DetailLine
            label="Status"
            value={
              isPlaying
                ? "mpv is active; the shell will return here when playback ends"
                : "Resolving provider data, stream headers, and playback context"
            }
            tone={isPlaying ? "success" : "info"}
          />
          {!isPlaying && elapsed >= 2 ? (
            <DetailLine label="Elapsed" value={formatElapsed(elapsed)} />
          ) : null}
          {state.showMemory ? <DetailLine label="Memory" value={formatMemoryUsage()} /> : null}
        </Box>

        {state.trace && (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              {state.trace}
            </Text>
          </Box>
        )}

        {state.progress !== undefined ? (
          <Box marginTop={1}>
            <Box
              width={Math.min(40, (stdout.columns ?? 80) - 4)}
              borderStyle="round"
              borderColor={palette.cyan}
              paddingX={1}
            >
              <Text>
                {"█".repeat(Math.floor(state.progress / 2.5))}
                {"░".repeat(40 - Math.floor(state.progress / 2.5))}
              </Text>
              <Text color={palette.cyan}> {Math.round(state.progress)}%</Text>
            </Box>
          </Box>
        ) : (
          !isPlaying && (
            <Box marginTop={1}>
              <Text color={pulse ? palette.cyan : palette.gray} dimColor>
                {pulse ? "Preparing playback context…" : "Waiting on provider response…"}
              </Text>
            </Box>
          )
        )}

        {state.cancellable && (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              ESC to cancel
            </Text>
          </Box>
        )}
        {state.stopHint ? (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              {state.stopHint}
            </Text>
          </Box>
        ) : null}
        {state.controlHint ? (
          <Box>
            <Text color={palette.gray} dimColor>
              {state.controlHint}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
