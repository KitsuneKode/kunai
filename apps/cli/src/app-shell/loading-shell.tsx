import { Box, Text, useInput, useStdout } from "ink";
import React from "react";

import { ShellFrame } from "./shell-frame";
import { Badge, DetailLine } from "./shell-primitives";
import { palette } from "./shell-theme";
import type { FooterAction, LoadingShellState } from "./types";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function useSpinner() {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return SPINNER_FRAMES[frame];
}

function useElapsed(): number {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

function usePulse(periodMs: number): boolean {
  const [on, setOn] = React.useState(true);
  React.useEffect(() => {
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
  onRecover,
  onReloadSubtitles,
  onNext,
  onPrevious,
  onSkipSegment,
  onPickStreams,
  onPickSource,
  onPickQuality,
  onToggleAutoplay,
  onStopAfterCurrent,
}: {
  state: LoadingShellState;
  onCancel?: () => void;
  onStop?: () => void;
  onRecover?: () => void;
  onReloadSubtitles?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSkipSegment?: () => void;
  onPickStreams?: () => void;
  onPickSource?: () => void;
  onPickQuality?: () => void;
  onToggleAutoplay?: () => void;
  onStopAfterCurrent?: () => void;
}) {
  const spinner = useSpinner();
  const elapsed = useElapsed();
  const pulse = usePulse(1400);
  const { stdout } = useStdout();

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
      return;
    }
    if (input.toLowerCase() === "q") {
      if (state.operation === "playing" && onStop) {
        onStop();
      } else if (state.cancellable && onCancel) {
        onCancel();
      }
    }
    if (input.toLowerCase() === "r" && state.operation === "playing" && onRecover) {
      onRecover();
    }
    if (input.toLowerCase() === "s" && state.operation === "playing" && onReloadSubtitles) {
      onReloadSubtitles();
    }
    if (input.toLowerCase() === "n" && state.operation === "playing" && onNext) {
      onNext();
    }
    if (input.toLowerCase() === "p" && state.operation === "playing" && onPrevious) {
      onPrevious();
    }
    if (input.toLowerCase() === "b" && state.operation === "playing" && onSkipSegment) {
      onSkipSegment();
    }
    if (input.toLowerCase() === "k" && state.operation === "playing" && onPickStreams) {
      onPickStreams();
      return;
    }
    if (input.toLowerCase() === "o" && state.operation === "playing" && onPickSource) {
      onPickSource();
    }
    if (input.toLowerCase() === "k" && state.operation === "playing" && onPickQuality) {
      onPickQuality();
    }
    if (input.toLowerCase() === "a" && state.operation === "playing" && onToggleAutoplay) {
      onToggleAutoplay();
    }
    if (input.toLowerCase() === "x" && state.operation === "playing" && onStopAfterCurrent) {
      onStopAfterCurrent();
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
    loading: "Loading playback",
  };
  const phaseRail =
    state.operation === "loading"
      ? [{ label: "loading", tone: "info" as const }]
      : renderPhaseRail(state.operation);

  const footerActions: readonly FooterAction[] = [
    { key: "/", label: "commands", action: "command-mode" },
    { key: "g", label: "settings", action: "settings" },
    { key: "h", label: "history", action: "history" },
    { key: "d", label: "diagnostics", action: "diagnostics" },
    { key: "?", label: "help", action: "help" },
  ];

  return (
    <ShellFrame
      eyebrow="playback"
      title={state.title}
      subtitle={state.subtitle ?? "Preparing playback"}
      status={{
        label: isPlaying ? "playing" : operationLabels[state.operation].toLowerCase(),
        tone: isPlaying ? "success" : "neutral",
      }}
      footerTask={
        state.operation === "playing"
          ? "Playback  ·  q stop · r recover · k streams"
          : state.cancellable
            ? "Playback bootstrap  ·  q / Esc cancel"
            : "Playback bootstrap"
      }
      footerActions={footerActions}
      footerMode={state.footerMode ?? "detailed"}
      commands={state.commands ?? []}
      inputLocked={!state.onCommandAction}
      escapeAction={null}
      onResolve={(action) => state.onCommandAction?.(action)}
    >
      <Box flexDirection="column" width={infoWidth} justifyContent="center" flexGrow={1}>
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
          {phaseRail.map((phase) => (
            <Badge key={phase.label} label={phase.label} tone={phase.tone} />
          ))}
        </Box>

        <Box>
          <Text color={accentColor}>{operationLabels[state.operation]}</Text>
          <Text color={palette.gray} dimColor>
            {"  "}
            {isPlaying ? "Kunai is supervising playback" : "Gathering stream data"}
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
                ? "mpv is active; shell controls and subtitle switching remain available"
                : state.cancellable
                  ? "Resolving provider data, timing, and player startup; Esc cancels cleanly"
                  : "Resolving provider data, stream headers, and playback context"
            }
            tone={isPlaying ? "success" : "info"}
          />
          {!isPlaying && elapsed >= 10 ? (
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
    </ShellFrame>
  );
}
