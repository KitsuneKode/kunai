import { playbackSubtitleStatusTone } from "@/app/subtitle-status";
import { Box, Text, useInput, useStdout } from "ink";
import React from "react";

import {
  getLoadingShellTimerPolicy,
  getProviderResolveWaitPresentation,
  shouldShowLoadingElapsed,
} from "./loading-shell-runtime";
import { getRuntimeMemoryLine } from "./runtime-memory";
import { ShellFrame } from "./shell-frame";
import { Badge, DetailLine } from "./shell-primitives";
import { palette } from "./shell-theme";
import type { FooterAction, LoadingShellState, ShellPanelLine } from "./types";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MEMORY_PANEL_AUTO_HIDE_MS = 8_000;

export function useSpinner(active = true) {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[frame];
}

function useElapsed(active = true): number {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

function usePulse(periodMs: number, active = true): boolean {
  const [on, setOn] = React.useState(true);
  React.useEffect(() => {
    if (!active) return undefined;
    const start = Date.now();
    const timer = setInterval(() => {
      const phase = ((Date.now() - start) % periodMs) / periodMs;
      setOn(phase < 0.5);
    }, 80);
    return () => clearInterval(timer);
  }, [active, periodMs]);
  return on;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${String(s)}s`;
}

function useRuntimeMemoryLine(refreshMs: number | null): string {
  const [memoryLine, setMemoryLine] = React.useState(() =>
    refreshMs === null ? "" : getRuntimeMemoryLine(),
  );

  React.useEffect(() => {
    if (refreshMs === null) {
      setMemoryLine("");
      return undefined;
    }

    setMemoryLine(getRuntimeMemoryLine());
    const timer = setInterval(() => {
      setMemoryLine(getRuntimeMemoryLine());
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  return memoryLine;
}

function useRuntimeHealthLine(
  refreshMs: number | null,
  getRuntimeHealth: (() => ShellPanelLine | undefined) | undefined,
): ShellPanelLine | undefined {
  const [healthLine, setHealthLine] = React.useState<ShellPanelLine | undefined>(() =>
    refreshMs === null ? undefined : getRuntimeHealth?.(),
  );

  React.useEffect(() => {
    if (refreshMs === null || !getRuntimeHealth) {
      setHealthLine(undefined);
      return undefined;
    }

    setHealthLine(getRuntimeHealth());
    const timer = setInterval(() => {
      setHealthLine(getRuntimeHealth());
    }, refreshMs);
    return () => clearInterval(timer);
  }, [getRuntimeHealth, refreshMs]);

  return healthLine;
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
  onPickEpisode,
  onPickSource,
  onPickQuality,
  onReturnToSearch,
  onToggleAutoplay,
  onToggleAutoskip,
  onStopAfterCurrent,
  onFallback,
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
  onPickEpisode?: () => void;
  onPickSource?: () => void;
  onPickQuality?: () => void;
  onReturnToSearch?: () => void;
  onToggleAutoplay?: () => void;
  onToggleAutoskip?: () => void;
  onStopAfterCurrent?: () => void;
  onFallback?: () => void;
}) {
  const [memoryPanelVisible, setMemoryPanelVisible] = React.useState(() =>
    Boolean(state.showMemory),
  );
  const timerPolicy = getLoadingShellTimerPolicy({
    operation: state.operation,
    memoryPanelVisible,
    runtimeHealthVisible: memoryPanelVisible || state.operation !== "playing",
  });
  const spinner = useSpinner(timerPolicy.animate);
  const elapsed = useElapsed(timerPolicy.trackElapsed);
  const pulse = usePulse(1400, timerPolicy.animate);
  const memoryLine = useRuntimeMemoryLine(timerPolicy.memoryRefreshMs);
  const runtimeHealthLine = useRuntimeHealthLine(
    timerPolicy.runtimeHealthRefreshMs,
    state.getRuntimeHealth,
  );
  const { stdout } = useStdout();

  React.useEffect(() => {
    if (!memoryPanelVisible) return undefined;
    const timer = setTimeout(() => {
      setMemoryPanelVisible(false);
    }, MEMORY_PANEL_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [memoryPanelVisible]);

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
      if (state.operation === "playing" && onStop && !state.onCommandAction) {
        onStop();
      } else if (state.cancellable && onCancel) {
        onCancel();
      }
    }
    if (
      input.toLowerCase() === "r" &&
      state.operation === "playing" &&
      onRecover &&
      !state.onCommandAction
    ) {
      onRecover();
    }
    if (input.toLowerCase() === "s" && state.operation === "playing" && onReloadSubtitles) {
      onReloadSubtitles();
    }
    if (input === "S" && state.operation === "playing" && onReturnToSearch) {
      onReturnToSearch();
    }
    if (
      input.toLowerCase() === "n" &&
      state.operation === "playing" &&
      onNext &&
      !state.onCommandAction
    ) {
      onNext();
    }
    if (
      input.toLowerCase() === "p" &&
      state.operation === "playing" &&
      onPrevious &&
      !state.onCommandAction
    ) {
      onPrevious();
    }
    if (input.toLowerCase() === "b" && state.operation === "playing" && onSkipSegment) {
      onSkipSegment();
    }
    if (input.toLowerCase() === "m" && state.operation === "playing") {
      setMemoryPanelVisible(true);
    }
    if (
      input.toLowerCase() === "e" &&
      state.operation === "playing" &&
      onPickEpisode &&
      !state.onCommandAction
    ) {
      onPickEpisode();
    }
    if (
      input.toLowerCase() === "k" &&
      state.operation === "playing" &&
      onPickStreams &&
      !state.onCommandAction
    ) {
      onPickStreams();
      return;
    }
    if (
      input.toLowerCase() === "o" &&
      state.operation === "playing" &&
      onPickSource &&
      !state.onCommandAction
    ) {
      onPickSource();
    }
    if (
      input.toLowerCase() === "v" &&
      state.operation === "playing" &&
      onPickQuality &&
      !state.onCommandAction
    ) {
      onPickQuality();
    }
    if (
      input.toLowerCase() === "a" &&
      state.operation === "playing" &&
      onToggleAutoplay &&
      !state.onCommandAction
    ) {
      onToggleAutoplay();
    }
    if (
      input.toLowerCase() === "u" &&
      state.operation === "playing" &&
      onToggleAutoskip &&
      !state.onCommandAction
    ) {
      onToggleAutoskip();
    }
    if (input.toLowerCase() === "x" && state.operation === "playing" && onStopAfterCurrent) {
      onStopAfterCurrent();
    }
    if (
      input.toLowerCase() === "f" &&
      state.fallbackAvailable &&
      onFallback &&
      !state.onCommandAction
    ) {
      onFallback();
    }
  });

  const isPlaying = state.operation === "playing";
  const leadIcon = isPlaying ? "▶" : spinner;
  const accentColor = isPlaying ? palette.green : pulse ? palette.cyan : "white";
  const separatorWidth = Math.min(52, Math.max(24, (stdout.columns ?? 80) - 22));
  const infoWidth = Math.min(76, Math.max(40, (stdout.columns ?? 80) - 12));
  const subtitleTone = state.subtitleStatus
    ? playbackSubtitleStatusTone(state.subtitleStatus)
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
  const waitPresentation = getProviderResolveWaitPresentation({
    elapsedSeconds: elapsed,
    fallbackAvailable: state.fallbackAvailable,
    latestIssue: state.latestIssue,
  });

  const fallbackLabel = state.fallbackProviderName
    ? `fallback ${state.fallbackProviderName}`
    : "fallback";
  const footerActions: readonly FooterAction[] =
    state.operation === "playing"
      ? [
          { key: "q", label: "stop", action: "quit" },
          {
            key: "n",
            label: "next",
            action: "next",
            disabled: !onNext,
            reason: "No next episode available.",
          },
          {
            key: "p",
            label: "previous",
            action: "previous",
            disabled: !onPrevious,
            reason: "No previous episode available.",
          },
          {
            key: "a",
            label: "autoplay",
            action: "toggle-autoplay",
            disabled: !onToggleAutoplay,
            reason: "Autoplay is unavailable for this title.",
          },
          {
            key: "u",
            label: state.autoskipPaused ? "autoskip paused" : "autoskip",
            action: "toggle-autoskip",
            disabled: !onToggleAutoskip,
            reason: "Autoskip is unavailable for this playback.",
          },
          {
            key: "e",
            label: "episodes",
            action: "pick-episode",
            disabled: !onPickEpisode,
            reason: "Episode picker is unavailable for this title.",
          },
          {
            key: "k",
            label: "streams",
            action: "streams",
            disabled: !onPickStreams,
            reason: "No stream picker is available.",
          },
          {
            key: "o",
            label: "source",
            action: "source",
            disabled: !onPickSource,
            reason: "No source picker is available.",
          },
          {
            key: "v",
            label: "quality",
            action: "quality",
            disabled: !onPickQuality,
            reason: "No quality picker is available.",
          },
          {
            key: "f",
            label: fallbackLabel,
            action: "fallback",
            disabled: !state.fallbackAvailable || !onFallback,
            reason: "No fallback provider is available.",
          },
          {
            key: "S",
            label: "search",
            action: "back-to-search",
            disabled: !onReturnToSearch,
            reason: "Search is unavailable during this playback state.",
          },
          {
            key: "r",
            label: "recover",
            action: "recover",
            disabled: !onRecover,
            reason: "Recovery is unavailable.",
          },
        ]
      : [
          { key: "/", label: "commands", action: "command-mode" },
          ...(state.fallbackAvailable
            ? [
                {
                  key: "f",
                  label: fallbackLabel,
                  action: "fallback" as const,
                },
              ]
            : []),
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
          ? "Playback"
          : state.cancellable
            ? waitPresentation.footerTask
            : "Playback bootstrap"
      }
      footerActions={footerActions}
      footerMode={state.footerMode ?? "detailed"}
      commands={state.operation === "playing" ? [] : (state.commands ?? [])}
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
          {shouldShowLoadingElapsed(state.operation, elapsed) ? (
            <DetailLine label="Elapsed" value={formatElapsed(elapsed)} />
          ) : null}
          {memoryPanelVisible && memoryLine ? (
            <DetailLine label="Memory" value={memoryLine} />
          ) : null}
          {runtimeHealthLine ? (
            <DetailLine
              label={runtimeHealthLine.label}
              value={runtimeHealthLine.detail ?? ""}
              tone={runtimeHealthLine.tone === "neutral" ? undefined : runtimeHealthLine.tone}
            />
          ) : null}
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
                {pulse ? waitPresentation.message : "Waiting on provider response..."}
              </Text>
            </Box>
          )
        )}

        {!isPlaying && state.stopHint ? (
          <Box marginTop={1}>
            <Text color={palette.gray} dimColor>
              {state.stopHint}
            </Text>
          </Box>
        ) : null}
        {!isPlaying && state.controlHint ? (
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
