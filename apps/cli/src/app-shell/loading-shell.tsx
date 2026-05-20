import { getRuntimeMemoryLine } from "@/services/diagnostics/runtime-memory";
import { Box, Text, useInput } from "ink";
import React from "react";

import { DotMatrixLoader } from "./dot-matrix-loader";
import { requestHardExit } from "./graceful-exit";
import {
  getLoadingDisclosure,
  getLoadingShellTimerPolicy,
  getProviderResolveWaitPresentation,
  getStageAnimationVariant,
  normalizeLoadingIssue,
  normalizeProviderDetail,
  renderStageRail,
  shouldShowPlaybackRuntimeStrip,
  shouldShowLoadingElapsed,
  stageLabel,
} from "./loading-shell-runtime";
import type { StageRailItem } from "./loading-shell-runtime";
import type { PosterResult, PosterState } from "./poster-types";
import { ShellFrame } from "./shell-frame";
import { DetailLine, selectFooterActions } from "./shell-primitives";
import { APP_LABEL, palette } from "./shell-theme";
import type { FooterAction, LoadingShellState, ShellPanelLine } from "./types";
import { useViewportPolicy } from "./use-viewport-policy";

const MEMORY_PANEL_AUTO_HIDE_MS = 8_000;

/** Legacy Braille spinner for surfaces that need a string. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${String(s)}s`;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatLoadingProviderLine(
  state: Pick<LoadingShellState, "providerName" | "providerId">,
): string | null {
  const name = state.providerName?.trim();
  const id = state.providerId?.trim();
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id || null;
}

export function shouldShowLoadingPosterCompanion({
  operation,
  columns,
  posterUrl,
  posterKind,
  posterState,
}: {
  operation: LoadingShellState["operation"];
  columns: number;
  posterUrl?: string;
  posterKind: PosterResult["kind"];
  posterState: PosterState;
}): boolean {
  if (operation !== "playing" || columns < 130) return false;
  return Boolean(
    posterUrl ||
    posterKind !== "none" ||
    posterState === "loading" ||
    posterState === "unavailable",
  );
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

function StageRail({ items }: { items: readonly StageRailItem[] }) {
  return (
    <Box flexDirection="row">
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? (
            <Text color={palette.dim} dimColor>
              {"  "}
            </Text>
          ) : null}
          <Text
            color={
              item.tone === "success"
                ? palette.green
                : item.tone === "info" || item.tone === "warning"
                  ? palette.amber
                  : palette.dim
            }
            dimColor={item.tone === "neutral"}
          >
            {item.glyph} {item.label}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

export function buildPlaybackSignalRail(
  state: Pick<LoadingShellState, "qualityLabel" | "downloadStatus" | "subtitleTrack">,
): string[] {
  const lines: string[] = [];
  if (state.qualityLabel?.trim()) {
    const fpsMatch = state.qualityLabel.match(/(\d+)\s*fps\b/i);
    const resolution = state.qualityLabel
      .replace(/\s*[·|]\s*\d+\s*fps\b/gi, "")
      .replace(/\d+\s*fps\b/gi, "")
      .trim();
    if (resolution) {
      lines.push(fpsMatch ? `${resolution} · ${fpsMatch[1]}fps` : resolution);
    } else if (fpsMatch) {
      lines.push(`${fpsMatch[1]}fps`);
    }
  }
  if (state.downloadStatus?.trim()) {
    const speed = state.downloadStatus.replace(/^dl:\s*/i, "").trim();
    if (speed) lines.push(speed.includes("↓") ? speed : `${speed} ↓`);
  }
  if (state.subtitleTrack?.trim()) {
    const track = state.subtitleTrack.trim();
    lines.push(/^sub\b/i.test(track) ? track : `sub ${track}`);
  }
  return lines;
}

function renderPlaybackProgressBar(
  currentPosition: number,
  duration: number,
  width: number,
): string {
  const safeDuration = duration > 0 ? duration : 1;
  const ratio = Math.min(1, Math.max(0, currentPosition / safeDuration));
  const filled = Math.floor(ratio * width);
  const markerIndex = Math.min(width - 1, filled);
  const bar = "━".repeat(markerIndex) + "╸" + "━".repeat(Math.max(0, width - markerIndex - 1));
  return bar.slice(0, width);
}

const PlaybackSignalRail = React.memo(function PlaybackSignalRail({
  lines,
}: {
  lines: readonly string[];
}) {
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column" alignItems="flex-end">
      {lines.map((line) => (
        <Text key={line} color={palette.dim} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
});

const BufferHealthBadge = React.memo(function BufferHealthBadge({
  health,
}: {
  health?: "healthy" | "buffering" | "stalled";
}) {
  if (!health) return null;
  const color =
    health === "healthy" ? palette.green : health === "buffering" ? palette.amber : palette.red;
  const label =
    health === "healthy"
      ? "● buffer healthy"
      : health === "buffering"
        ? "● buffer building"
        : "● buffer stalled";
  return (
    <Text color={color} bold>
      {label}
    </Text>
  );
});

export const LoadingShell = React.memo(function LoadingShell({
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
  const [memoryPanelVisible, setMemoryPanelVisible] = React.useState(false);
  const memoryPanelPinned = Boolean(state.showMemory && memoryPanelVisible);
  const timerPolicy = getLoadingShellTimerPolicy({
    operation: state.operation,
    memoryPanelVisible,
    runtimeHealthVisible: memoryPanelVisible || state.operation !== "playing",
  });
  const elapsed = useElapsed(timerPolicy.trackElapsed);
  const memoryLine = useRuntimeMemoryLine(timerPolicy.memoryRefreshMs);
  const runtimeHealthLine = useRuntimeHealthLine(
    timerPolicy.runtimeHealthRefreshMs,
    state.getRuntimeHealth,
  );
  const showPlaybackRuntimeStrip = shouldShowPlaybackRuntimeStrip({
    operation: state.operation,
    memoryPanelVisible,
    hasMemoryLine: Boolean(memoryLine),
    hasRuntimeHealthLine: Boolean(runtimeHealthLine),
  });
  const loadingViewport = useViewportPolicy("playback");
  const terminalColumns = loadingViewport.columns;
  const barWidth = Math.min(48, Math.max(12, Math.floor(terminalColumns * 0.45)));
  React.useEffect(() => {
    if (memoryPanelPinned) return undefined;
    if (!memoryPanelVisible) return undefined;
    const timer = setTimeout(() => {
      setMemoryPanelVisible(false);
    }, MEMORY_PANEL_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [memoryPanelPinned, memoryPanelVisible]);

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
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
      setMemoryPanelVisible((visible) => !visible);
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
  const infoWidth = Math.min(76, Math.max(40, terminalColumns - 12));
  const playbackSignalLines = buildPlaybackSignalRail(state);

  const activeStage = state.stage ?? (isPlaying ? "starting-playback" : "finding-stream");
  const loadingIssue = normalizeLoadingIssue(state.latestIssue);
  const stageRailItems = renderStageRail(activeStage, loadingIssue);
  const providerDetail = normalizeProviderDetail(state.details);
  const subtitleReady = Boolean(
    state.subtitleStatus?.toLowerCase().includes("attached") ||
    state.subtitleStatus?.toLowerCase().includes("ready"),
  );

  const waitPresentation = getProviderResolveWaitPresentation({
    elapsedSeconds: elapsed,
    fallbackAvailable: state.fallbackAvailable,
    latestIssue: loadingIssue,
    stageDetail: state.stageDetail,
  });
  const disclosure = getLoadingDisclosure(
    elapsed,
    Boolean(loadingIssue),
    state.progress !== undefined,
  );

  const fallbackLabel = state.fallbackProviderName
    ? `fallback ${state.fallbackProviderName}`
    : "fallback";
  const playingFooterActions: readonly FooterAction[] = [
    { key: "space", label: "pause", action: "command-mode", primary: true },
    { key: "/", label: "commands", action: "command-mode" },
    { key: "q", label: "stop", action: "quit" },
  ];
  const footerActions: readonly FooterAction[] =
    state.operation === "playing"
      ? selectFooterActions(playingFooterActions, "minimal")
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
        label: isPlaying ? "playing" : stageLabel(activeStage),
        tone: isPlaying ? "success" : loadingIssue ? "warning" : "neutral",
      }}
      footerTask={
        state.operation === "playing"
          ? "Playback"
          : state.cancellable
            ? waitPresentation.footerTask
            : "Playback bootstrap"
      }
      footerActions={footerActions}
      footerMode={isPlaying ? "minimal" : (state.footerMode ?? "detailed")}
      commands={state.commands ?? []}
      inputLocked={!state.onCommandAction}
      escapeAction={null}
      onResolve={(action) => {
        if (action === "memory") {
          setMemoryPanelVisible((visible) => !visible);
          return;
        }
        state.onCommandAction?.(action);
      }}
    >
      <Box flexDirection="column" justifyContent="space-between" flexGrow={1}>
        <Box flexDirection="column" width={infoWidth} justifyContent="center" flexGrow={1}>
          {/* ── Resolving / Loading ───────────────────────────────────────── */}
          {!isPlaying && (
            <Box flexDirection="column" justifyContent="center" flexGrow={1} paddingY={1}>
              {/* App identity */}
              <Box marginBottom={1}>
                <Text color={palette.muted} dimColor>
                  {APP_LABEL}
                </Text>
              </Box>

              {/* Animation grid + stage context side-by-side */}
              <Box flexDirection="row" marginTop={1} alignItems="flex-start">
                <Box marginRight={2}>
                  <DotMatrixLoader
                    variant={getStageAnimationVariant(activeStage)}
                    active={timerPolicy.animate}
                    onColor={palette.teal}
                    offColor={palette.dim}
                  />
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                  <Text bold color="white">
                    {state.stageDetail || stageLabel(activeStage)}
                  </Text>
                  <Box marginTop={1}>
                    <StageRail items={stageRailItems} />
                  </Box>
                  {/* Provider context — revealed after 2s */}
                  {disclosure.showProvider && providerDetail && (
                    <Box marginTop={1}>
                      <Text color={palette.gray} dimColor>
                        {providerDetail}
                      </Text>
                    </Box>
                  )}
                  {/* Subtitle status — revealed after 2s */}
                  {disclosure.showSubtitleStatus && state.subtitleStatus && (
                    <Box marginTop={1}>
                      <Text color={subtitleReady ? palette.green : palette.amber}>
                        {state.subtitleStatus}
                      </Text>
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Diagnostics strip — revealed after 5s */}
              {disclosure.showDiagnostics && (
                <Box flexDirection="column" marginTop={2}>
                  {state.trace && (
                    <Text color={palette.gray} dimColor>
                      {state.trace}
                    </Text>
                  )}
                  {shouldShowLoadingElapsed(state.operation, elapsed) && (
                    <Text color={palette.gray} dimColor>
                      {formatElapsed(elapsed)} elapsed
                    </Text>
                  )}
                  {memoryPanelVisible && memoryLine && (
                    <Text color={palette.gray} dimColor>
                      Memory: {memoryLine}
                    </Text>
                  )}
                  {runtimeHealthLine && (
                    <Text
                      color={
                        !runtimeHealthLine.tone || runtimeHealthLine.tone === "neutral"
                          ? palette.gray
                          : palette[runtimeHealthLine.tone as keyof typeof palette]
                      }
                    >
                      {runtimeHealthLine.label}: {runtimeHealthLine.detail}
                    </Text>
                  )}
                </Box>
              )}

              {/* Progress bar or wait message */}
              {disclosure.showProgress && state.progress !== undefined ? (
                <Box marginTop={1}>
                  <Text>
                    {"█".repeat(Math.floor((state.progress / 100) * barWidth))}
                    {"░".repeat(barWidth - Math.floor((state.progress / 100) * barWidth))}
                  </Text>
                  <Text color={palette.teal}> {Math.round(state.progress)}%</Text>
                </Box>
              ) : disclosure.showElapsed ? (
                <Box marginTop={1}>
                  <Text color={palette.dim} dimColor>
                    {waitPresentation.message}
                  </Text>
                </Box>
              ) : null}

              {/* Issue warning — always visible immediately if present */}
              {disclosure.showIssue && loadingIssue && (
                <Box marginTop={1}>
                  <Text color={palette.amber}>⚠ {loadingIssue}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* ── Playing ───────────────────────────────────────────────────── */}
          {isPlaying && (
            <Box marginTop={1} flexDirection="column" flexGrow={1} justifyContent="center">
              <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
                <Box flexDirection="column" flexGrow={1} marginRight={2}>
                  <Text bold color="white">
                    {state.title}
                  </Text>
                  {state.subtitle ? (
                    <Text color={palette.dim} dimColor>
                      {state.subtitle}
                    </Text>
                  ) : null}
                  {state.playbackFactsStrip ? (
                    <Box marginTop={1}>
                      <Text color={palette.teal}>{state.playbackFactsStrip}</Text>
                    </Box>
                  ) : null}
                  {state.playbackKeysHint ? (
                    <Box marginTop={state.playbackFactsStrip ? 0 : 1}>
                      <Text color={palette.dim} dimColor>
                        {state.playbackKeysHint}
                      </Text>
                    </Box>
                  ) : state.controlHint ? (
                    <Box marginTop={1}>
                      <Text color={palette.dim} dimColor>
                        {state.controlHint}
                      </Text>
                    </Box>
                  ) : null}
                  {state.bufferHealth === "stalled" || state.bufferHealth === "buffering" ? (
                    <Box marginTop={1}>
                      <BufferHealthBadge health={state.bufferHealth} />
                    </Box>
                  ) : null}
                </Box>
                <PlaybackSignalRail lines={playbackSignalLines} />
              </Box>
              {state.currentPosition !== undefined &&
              state.duration !== undefined &&
              state.duration > 0 ? (
                <Box marginTop={2} flexDirection="column">
                  <Text>
                    <Text color={palette.amber}>{formatTimestamp(state.currentPosition)}</Text>
                    <Text color={palette.dim}>
                      {" "}
                      {renderPlaybackProgressBar(
                        state.currentPosition,
                        state.duration,
                        barWidth,
                      )}{" "}
                    </Text>
                    <Text color={palette.dim} dimColor>
                      {formatTimestamp(state.duration)} total
                    </Text>
                  </Text>
                </Box>
              ) : null}
              {memoryPanelVisible && showPlaybackRuntimeStrip ? (
                <Box marginTop={2} flexDirection="column">
                  {memoryLine ? (
                    <DetailLine label="Memory" value={memoryLine} tone="neutral" />
                  ) : null}
                  {runtimeHealthLine ? (
                    <DetailLine
                      label={runtimeHealthLine.label}
                      value={runtimeHealthLine.detail ?? ""}
                      tone={runtimeHealthLine.tone ?? "neutral"}
                    />
                  ) : null}
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Box>
    </ShellFrame>
  );
});
