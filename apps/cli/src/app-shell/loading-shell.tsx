import { getRuntimeMemoryLine } from "@/services/diagnostics/runtime-memory";
import { Box, Text, useInput } from "ink";
import React from "react";

import { DotMatrixLoader } from "./dot-matrix-loader";
import { requestHardExit } from "./graceful-exit";
import { usePlaybackPosterSurfaceCleanup } from "./image-pane";
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
import { buildPlaybackRecoveryViewModel } from "./playback-recovery-view-model";
import { ShellFrame } from "./shell-frame";
import { DetailLine, selectFooterActions } from "./shell-primitives";
import { truncateLine } from "./shell-text";
import { APP_LABEL, palette, statusColor } from "./shell-theme";
import type { FooterAction, LoadingShellState, ShellPanelLine } from "./types";
import { usePosterPreview } from "./use-poster-preview";
import { useViewportPolicy } from "./use-viewport-policy";

const MEMORY_PANEL_AUTO_HIDE_MS = 8_000;

export function buildLoadingFooterActions(state: LoadingShellState): readonly FooterAction[] {
  const fallbackLabel = state.fallbackProviderName
    ? `fallback ${state.fallbackProviderName}`
    : "fallback";
  const isSeriesPlayback = Boolean(
    state.isSeriesPlayback || state.hasNextEpisode || state.hasPreviousEpisode,
  );
  if (state.operation === "playing") {
    const playingFooterActions: readonly FooterAction[] = [
      { key: "space", label: "pause", action: "command-mode", primary: true },
      { key: "q", label: "stop", action: "quit" },
      ...(isSeriesPlayback
        ? [{ key: "e", label: "episodes", action: "pick-episode" as const }]
        : []),
      { key: "t", label: "tracks", action: "streams" },
      { key: "/", label: "commands", action: "command-mode" },
    ];
    return selectFooterActions(playingFooterActions, "minimal");
  }

  return [
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
    ...(isSeriesPlayback
      ? [
          {
            key: "a",
            label: state.autoplayPaused ? "resume autoplay" : "pause autoplay",
            action: "toggle-autoplay" as const,
          },
          {
            key: "u",
            label: state.autoskipPaused ? "resume autoskip" : "pause autoskip",
            action: "toggle-autoskip" as const,
          },
          {
            key: "x",
            label: "stop after current",
            action: "stop-after-current" as const,
          },
        ]
      : []),
    { key: "g", label: "settings", action: "settings" },
    { key: "h", label: "history", action: "history" },
    { key: "d", label: "diagnostics", action: "diagnostics" },
    { key: "?", label: "help", action: "help" },
  ];
}

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

// Vertical "Mission" checklist (.prototypes/playback-postplay 'Mission card'):
// one stage per line with its status glyph, so bootstrap reads as a checklist
// being ticked off rather than a horizontal breadcrumb.
function StageRail({ items }: { items: readonly StageRailItem[] }) {
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Text
          key={item.label}
          color={
            item.tone === "success"
              ? palette.ok
              : item.tone === "info" || item.tone === "warning"
                ? palette.accentDeep
                : palette.dim
          }
          dimColor={item.tone === "neutral"}
        >
          {item.glyph} {item.label}
        </Text>
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

// ── Recovery view (§6) ────────────────────────────────────────────────────
// Renders the Failure & Recovery surface per the Sakura canonical spec:
//   • one primary safe verb (recover) dominant — never "next" primary after failure
//   • crimson (danger) ONLY on the live fault line itself
//   • preserved-progress fact inline so user knows progress is safe
//   • secondary actions (fallback, sources) at normal weight
//   • diagnostics behind [d] in dim, never in the primary column
//
// This replaces the generic StateBlock for the recovery path so the surface
// carries the correct visual hierarchy without modifying shared primitives.
const PlaybackRecoveryView = React.memo(function PlaybackRecoveryView({
  model,
  state,
  width,
}: {
  model: NonNullable<ReturnType<typeof buildPlaybackRecoveryViewModel>>;
  state: Pick<LoadingShellState, "currentPosition" | "duration" | "progress">;
  width: number;
}) {
  const { state: block } = model;
  const isLiveFault = block.kind === "error";
  const titleColor = isLiveFault ? palette.danger : palette.accentDeep;
  const glyph = isLiveFault ? "×" : "◐";

  // Preserved-progress fact: show saved timestamp if we have it, else % if
  // available. This is the key trust signal — progress is not lost.
  const preservedFact: string | null =
    state.currentPosition !== undefined && state.currentPosition > 0
      ? `${formatTimestamp(state.currentPosition)} saved`
      : state.progress !== undefined && state.progress > 0
        ? `${Math.round(state.progress)}% saved`
        : null;

  // Split actions: primary (recover), secondary (fallback, sources), diagnostic
  const primaryAction = block.actions?.find((a) => a.id === "recover");
  const secondaryActions =
    block.actions?.filter((a) => a.id !== "recover" && a.id !== "diagnostics") ?? [];
  const hasDiagnostics = block.actions?.some((a) => a.id === "diagnostics") ?? false;

  const detailWidth = Math.max(10, width - 28);

  return (
    <Box flexDirection="column">
      {/* Fault headline — crimson only if live (stalled/no-source/did-not-start) */}
      <Text color={titleColor} bold>
        {glyph} {block.title}
      </Text>

      {/* Preserved progress — the key trust signal */}
      {preservedFact ? (
        <Box marginTop={1}>
          <Text color={palette.muted}>{"progress  "}</Text>
          <Text color={palette.ok}>{preservedFact}</Text>
          <Text color={palette.muted}>{" · "}</Text>
          <Text color={palette.ok}>not marked watched</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={palette.ok}>progress preserved · not marked watched</Text>
        </Box>
      )}

      {/* Primary action — recover, dominant weight */}
      {primaryAction ? (
        <Box marginTop={1}>
          <Text color={palette.accent} bold>
            {"▌ "}
          </Text>
          <Text color={palette.accent} bold>
            {primaryAction.label.padEnd(16)}
          </Text>
          <Text color={palette.muted}>{truncateLine(primaryAction.detail ?? "", detailWidth)}</Text>
          <Text color={palette.accent}>
            {primaryAction.shortcut ? `  ${primaryAction.shortcut}` : ""}
          </Text>
        </Box>
      ) : null}

      {/* Secondary actions — fallback / sources, normal weight */}
      {secondaryActions.length > 0 ? (
        <Box flexDirection="column">
          {secondaryActions.map((action) => (
            <Box key={action.id}>
              <Text color={palette.dim}>{"  "}</Text>
              <Text color={palette.textDim}>{action.label.padEnd(16)}</Text>
              <Text color={palette.dim}>{truncateLine(action.detail ?? "", detailWidth)}</Text>
              <Text color={palette.dim}>{action.shortcut ? `  ${action.shortcut}` : ""}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {/* Diagnostics — dim, behind [d], never primary */}
      {hasDiagnostics ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            [d] diagnostics
          </Text>
        </Box>
      ) : null}
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
    health === "healthy"
      ? palette.ok
      : health === "buffering"
        ? palette.accentDeep
        : palette.danger;
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

  usePlaybackPosterSurfaceCleanup(state.operation);
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

  // Recovery surface only applies before/around playback start, not while a
  // healthy stream is playing (that path has its own buffer badge + controls).
  const recoveryView = state.operation !== "playing" ? buildPlaybackRecoveryViewModel(state) : null;

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
      return;
    }
    // While a failure/recovery surface is shown, its action shortcuts take
    // precedence so the rows it advertises actually work (footer input is
    // locked when there is no command action).
    if (recoveryView) {
      const rk = input.toLowerCase();
      if (rk === "r" && onRecover) {
        onRecover();
        return;
      }
      if (rk === "f" && onFallback) {
        onFallback();
        return;
      }
      if (rk === "s" && onPickStreams) {
        onPickStreams();
        return;
      }
      if (rk === "d") {
        state.onCommandAction?.("diagnostics");
        return;
      }
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
      (input.toLowerCase() === "t" || input.toLowerCase() === "k") &&
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
  // Poster rail on wide terminals — paints a real image where the prior surface's
  // stale Kitty placement would otherwise bleed through (A6 ghost).
  const showPlaybackPoster =
    isPlaying && loadingViewport.breakpoint === "wide" && Boolean(state.posterUrl);
  const { poster: playbackPoster } = usePosterPreview(state.posterUrl, {
    rows: 11,
    cols: 18,
    enabled: showPlaybackPoster,
    debounceMs: 120,
    variant: "detail",
  });

  const activeStage = state.stage ?? (isPlaying ? "starting-playback" : "finding-stream");
  const loadingIssue = normalizeLoadingIssue(state.latestIssue);
  const stageRailItems = renderStageRail(activeStage, loadingIssue);
  const providerDetail = normalizeProviderDetail(state.details);
  const subtitleReady = Boolean(
    state.subtitleStatus?.toLowerCase().includes("attached") ||
    state.subtitleStatus?.toLowerCase().includes("ready"),
  );

  // Active control-surface state, derived from existing playback telemetry — the
  // playing body renders structured rows (health · tracks · session · up next)
  // instead of one scattered facts strip. Color = state; weight = hierarchy.
  const activeTracksLine = isPlaying
    ? [
        state.qualityLabel,
        state.audioTrack ? `audio ${state.audioTrack}` : undefined,
        state.subtitleTrack ? `subs ${state.subtitleTrack}` : subtitleReady ? "subs on" : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join("  ·  ")
    : "";
  // Trouble is promoted into the body only while playing: a stalled buffer or a
  // live issue names what's wrong and surfaces recover/fallback inline.
  const playbackTrouble =
    isPlaying && (state.bufferHealth === "stalled" || Boolean(loadingIssue))
      ? (loadingIssue ?? "Stream stalled")
      : null;

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

  const footerActions = buildLoadingFooterActions(state);

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
                    onColor={palette.accent}
                    offColor={palette.dim}
                  />
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                  <Text bold color={palette.text}>
                    {state.stageDetail || stageLabel(activeStage)}
                  </Text>
                  <Box marginTop={1}>
                    <StageRail items={stageRailItems} />
                  </Box>
                  {/* Session toggles surfaced early so autoplay/autoskip intent is
                      visible before playback starts (Mission card). */}
                  <Box marginTop={1}>
                    <Text color={palette.dim}>{"session  "}</Text>
                    <Text color={state.autoskipPaused ? palette.muted : palette.ok}>
                      {state.autoskipPaused ? "autoskip off" : "autoskip on"}
                    </Text>
                    <Text color={palette.dim}>{" · "}</Text>
                    <Text color={state.autoplayPaused ? palette.muted : palette.ok}>
                      {state.autoplayPaused ? "autoplay off" : "autoplay on"}
                    </Text>
                  </Box>
                  {/* Provider context — revealed after 2s */}
                  {disclosure.showProvider && providerDetail && (
                    <Box marginTop={1}>
                      <Text color={palette.dim} dimColor>
                        {providerDetail}
                      </Text>
                    </Box>
                  )}
                  {/* Subtitle status — revealed after 2s */}
                  {disclosure.showSubtitleStatus && state.subtitleStatus && (
                    <Box marginTop={1}>
                      <Text color={subtitleReady ? palette.ok : palette.accentDeep}>
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
                    <Text color={palette.dim} dimColor>
                      {state.trace}
                    </Text>
                  )}
                  {shouldShowLoadingElapsed(state.operation, elapsed) && (
                    <Text color={palette.dim} dimColor>
                      {formatElapsed(elapsed)} elapsed
                    </Text>
                  )}
                  {memoryPanelVisible && memoryLine && (
                    <Text color={palette.dim} dimColor>
                      Memory: {memoryLine}
                    </Text>
                  )}
                  {runtimeHealthLine && (
                    <Text
                      color={
                        !runtimeHealthLine.tone || runtimeHealthLine.tone === "neutral"
                          ? palette.dim
                          : statusColor(runtimeHealthLine.tone)
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
                  <Text color={palette.accent}> {Math.round(state.progress)}%</Text>
                </Box>
              ) : disclosure.showElapsed ? (
                <Box marginTop={1}>
                  <Text color={palette.dim} dimColor>
                    {waitPresentation.message}
                  </Text>
                </Box>
              ) : null}

              {/* Failure / recovery surface takes priority over the bare issue
                  line: it names what failed and offers recover/fallback/sources/
                  diagnostics. Falls back to the quiet warning when not a failure. */}
              {recoveryView ? (
                <Box marginTop={1}>
                  <PlaybackRecoveryView model={recoveryView} state={state} width={infoWidth} />
                </Box>
              ) : disclosure.showIssue && loadingIssue ? (
                <Box marginTop={1}>
                  <Text color={palette.accentDeep}>⚠ {loadingIssue}</Text>
                </Box>
              ) : null}
            </Box>
          )}

          {/* ── Playing ───────────────────────────────────────────────────── */}
          {isPlaying && (
            <Box marginTop={1} flexDirection="row" flexGrow={1}>
              <Box flexDirection="column" flexGrow={1}>
                {/* Control deck (.prototypes/playback-postplay): progress leads,
                  then a single NOW facts line + GO key-hints, then the mpv hint.
                  Title/episode live in the ShellFrame header. */}
                <Text color={palette.lineSoft}>
                  {"─".repeat(Math.min(infoWidth, barWidth + 16))}
                </Text>

                {/* Progress — the prominent current-watch line */}
                {state.currentPosition !== undefined &&
                state.duration !== undefined &&
                state.duration > 0 ? (
                  <Box marginTop={1}>
                    <Text>
                      <Text color={palette.accent} bold>
                        {formatTimestamp(state.currentPosition)}
                      </Text>
                      <Text color={palette.accentDeep}>
                        {" "}
                        {renderPlaybackProgressBar(
                          state.currentPosition,
                          state.duration,
                          barWidth,
                        )}{" "}
                      </Text>
                      <Text color={palette.dim} dimColor>
                        {formatTimestamp(state.duration)}
                      </Text>
                      {state.progress !== undefined ? (
                        <Text color={palette.dim}>{`  ·  ${Math.round(state.progress)}%`}</Text>
                      ) : null}
                    </Text>
                  </Box>
                ) : null}

                {/* NOW — facts on one line (quality · subs · session). */}
                <Box marginTop={2}>
                  <Text color={palette.dim}>{"NOW  "}</Text>
                  {activeTracksLine ? (
                    <Text
                      color={palette.text}
                    >{`${truncateLine(activeTracksLine, infoWidth - 32)} · `}</Text>
                  ) : null}
                  <Text color={state.autoskipPaused ? palette.muted : palette.ok}>
                    {state.autoskipPaused ? "autoskip off" : "autoskip"}
                  </Text>
                  <Text color={palette.dim}>{" · "}</Text>
                  <Text color={state.autoplayPaused ? palette.muted : palette.ok}>
                    {state.autoplayPaused ? "autoplay off" : "autoplay"}
                  </Text>
                </Box>

                {/* GO — live key hints; only list keys that are actually wired. */}
                <Box>
                  <Text color={palette.dim}>{"GO   "}</Text>
                  <Text color={palette.textDim}>
                    {truncateLine(
                      [
                        state.hasNextEpisode && onNext ? "n next" : null,
                        state.hasPreviousEpisode && onPrevious ? "p prev" : null,
                        onSkipSegment ? "b skip" : null,
                        onPickSource ? "o source" : null,
                        onPickQuality ? "v quality" : null,
                        onPickEpisode ? "e episodes" : null,
                        onPickStreams ? "t tracks" : null,
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join("  ·  "),
                      infoWidth - 5,
                    )}
                  </Text>
                </Box>

                {/* Health/trouble only surfaces when there is something to act on. */}
                {playbackTrouble ? (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={palette.danger} bold>
                      {`⚠ ${truncateLine(playbackTrouble, infoWidth - 2)}`}
                    </Text>
                    <Text color={palette.dim}>
                      {"r recover  ·  f fallback  ·  t tracks  ·  d diagnostics"}
                    </Text>
                  </Box>
                ) : state.bufferHealth === "buffering" || state.bufferHealth === "stalled" ? (
                  <Box marginTop={1}>
                    <BufferHealthBadge health={state.bufferHealth} />
                  </Box>
                ) : null}

                {/* mpv ownership hint — Kunai owns session, mpv owns the video. */}
                <Box marginTop={1}>
                  <Text color={palette.dim} dimColor>
                    mpv focused — Kunai shortcuts stay live · / for full commands
                  </Text>
                </Box>

                {/* Up next */}
                {state.hasNextEpisode && state.nextEpisodeLabel?.trim() ? (
                  <Box marginTop={1}>
                    <Text color={palette.accent}>{"▶ "}</Text>
                    <Text color={palette.dim} dimColor>
                      {"up next  "}
                    </Text>
                    <Text color={palette.text}>
                      {truncateLine(state.nextEpisodeLabel, infoWidth - 10)}
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
              {showPlaybackPoster && playbackPoster.kind !== "none" ? (
                <Box marginLeft={2} flexShrink={0}>
                  <Text>{playbackPoster.placeholder}</Text>
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Box>
    </ShellFrame>
  );
});
