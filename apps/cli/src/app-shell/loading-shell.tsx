import { Box, Text, useInput, useStdout } from "ink";
import React from "react";

import { InlineDotMatrixLoader } from "./dot-matrix-loader";
import { requestHardExit } from "./graceful-exit";
import {
  getLoadingDisclosure,
  getLoadingShellTimerPolicy,
  getProviderResolveWaitPresentation,
  normalizeLoadingIssue,
  normalizeProviderDetail,
  shouldShowLoadingElapsed,
  stageLabel,
} from "./loading-shell-runtime";
import type { PosterResult, PosterState } from "./poster-types";
import { getRuntimeMemoryLine } from "./runtime-memory";
import { ShellFrame } from "./shell-frame";
import { ContextStrip, DetailLine, LocalSection } from "./shell-primitives";
import { APP_LABEL, palette } from "./shell-theme";
import type { FooterAction, LoadingShellState, ShellPanelLine } from "./types";
import { usePosterPreview } from "./use-poster-preview";

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
  const [memoryPanelVisible, setMemoryPanelVisible] = React.useState(() =>
    Boolean(state.showMemory),
  );
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
  const { stdout } = useStdout();
  const terminalColumns = stdout.columns ?? 80;
  const barWidth = Math.min(48, Math.max(12, Math.floor(terminalColumns * 0.45)));
  const { poster, posterState } = usePosterPreview(state.posterUrl, {
    rows: 10,
    cols: 22,
    enabled: state.operation === "playing",
    debounceMs: 90,
    variant: "detail",
  });

  React.useEffect(() => {
    if (!memoryPanelVisible) return undefined;
    const timer = setTimeout(() => {
      setMemoryPanelVisible(false);
    }, MEMORY_PANEL_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [memoryPanelVisible]);

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
  const showPosterCompanion = shouldShowLoadingPosterCompanion({
    operation: state.operation,
    columns: terminalColumns,
    posterUrl: state.posterUrl,
    posterKind: poster.kind,
    posterState,
  });
  const infoWidth = showPosterCompanion
    ? Math.max(52, Math.min(82, terminalColumns - 36))
    : Math.min(76, Math.max(40, terminalColumns - 12));

  const activeStage = state.stage ?? (isPlaying ? "starting-playback" : "finding-stream");
  const loadingIssue = normalizeLoadingIssue(state.latestIssue);
  const providerDetail = normalizeProviderDetail(state.details);
  const providerLine = formatLoadingProviderLine(state);
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
  const footerActions: readonly FooterAction[] =
    state.operation === "playing"
      ? [
          { key: "/", label: "commands", action: "command-mode" },
          { key: "q", label: "stop", action: "quit" },
          {
            key: "n",
            label: "next",
            action: "next",
            disabled: !onNext && !state.hasNextEpisode,
            reason: state.nextEpisodeLabel ? undefined : "No next episode available.",
          },
          {
            key: "p",
            label: "previous",
            action: "previous",
            disabled: !onPrevious && !state.hasPreviousEpisode,
            reason: state.previousEpisodeLabel ? undefined : "No previous episode available.",
          },
          {
            key: "a",
            label: state.autoplayPaused ? "☐ autoplay" : "☑ autoplay",
            action: "toggle-autoplay",
            disabled: !onToggleAutoplay,
            reason: "Autoplay is unavailable for this title.",
          },
          {
            key: "u",
            label: state.autoskipPaused ? "☐ autoskip" : "☑ autoskip",
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

  const statusItems = React.useMemo(() => {
    const items: { label: string; tone: "neutral" | "info" | "success" | "warning" | "error" }[] =
      [];
    if (providerLine) items.push({ label: providerLine, tone: "info" });
    if (state.downloadStatus) items.push({ label: `dl: ${state.downloadStatus}`, tone: "info" });
    if (state.subtitleStatus)
      items.push({
        label: state.subtitleStatus,
        tone: subtitleReady ? "success" : "warning",
      });
    return items;
  }, [providerLine, state.downloadStatus, state.subtitleStatus, subtitleReady]);

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
      footerMode={state.footerMode ?? "detailed"}
      commands={state.commands ?? []}
      inputLocked={!state.onCommandAction}
      escapeAction={null}
      onResolve={(action) => state.onCommandAction?.(action)}
    >
      <Box
        flexDirection={showPosterCompanion ? "row" : "column"}
        justifyContent="space-between"
        flexGrow={1}
      >
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

              {/* Primary operation */}
              <Box marginTop={1}>
                <InlineDotMatrixLoader
                  variant="flux-columns"
                  active={timerPolicy.animate}
                  onColor={palette.teal}
                />
                <Text color={palette.teal}> </Text>
                <Text bold color="white">
                  {state.stageDetail || stageLabel(activeStage)}
                </Text>
              </Box>

              {/* Provider context — revealed after 2s so the user isn't overwhelmed */}
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

              {/* Spacer instead of separator for calmer visual rhythm */}
              {(disclosure.showDiagnostics || disclosure.showProgress) && <Box marginY={1} />}

              {/* Diagnostics strip — revealed after 5s */}
              {disclosure.showDiagnostics && (
                <Box flexDirection="column">
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
            <>
              {/* Status context strip */}
              {statusItems.length > 0 && (
                <Box marginTop={0} flexDirection="column">
                  <ContextStrip items={statusItems} />
                </Box>
              )}

              {/* Playback telemetry */}
              <LocalSection title="Now playing" tone="success" marginTop={1}>
                {state.currentPosition !== undefined &&
                state.duration !== undefined &&
                state.duration > 0 ? (
                  <Text color={palette.teal}>
                    {formatTimestamp(state.currentPosition)} / {formatTimestamp(state.duration)}
                    {"  "}
                    <Text color={palette.gray}>
                      ({Math.round((state.currentPosition / state.duration) * 100)}%)
                    </Text>
                  </Text>
                ) : null}
                <Box marginTop={1} flexDirection="column">
                  {state.qualityLabel && (
                    <DetailLine label="Quality" value={state.qualityLabel} tone="neutral" />
                  )}
                  {state.bufferHealth && (
                    <Box marginTop={1}>
                      <BufferHealthBadge health={state.bufferHealth} />
                    </Box>
                  )}
                  {state.audioTrack && (
                    <DetailLine label="Audio" value={state.audioTrack} tone="neutral" />
                  )}
                  {state.subtitleTrack && (
                    <DetailLine label="Subtitles" value={state.subtitleTrack} tone="neutral" />
                  )}
                </Box>
              </LocalSection>
            </>
          )}
        </Box>

        {showPosterCompanion ? (
          <Box marginLeft={2} flexDirection="column" width={28} justifyContent="flex-end">
            <Text color={palette.amber}>Now showing</Text>
            <Box marginTop={1}>
              {poster.kind !== "none" ? (
                <Text>{poster.placeholder}</Text>
              ) : (
                <Box flexDirection="column">
                  <Text color={posterState === "loading" ? palette.info : palette.gray} dimColor>
                    {posterState === "loading" ? "Loading artwork…" : "Artwork unavailable"}
                  </Text>
                  <Text color={palette.gray} dimColor>
                    Controls stay live while artwork catches up.
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        ) : null}
      </Box>
    </ShellFrame>
  );
});
