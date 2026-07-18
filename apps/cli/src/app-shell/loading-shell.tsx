import { requestAppShutdown } from "@/app/session/shutdown-request";
import { getRuntimeMemoryLine } from "@/services/diagnostics/runtime-memory";
import { Box, Text, useInput } from "ink";
import React from "react";

import { usePlaybackPosterSurfaceCleanup } from "./image-pane";
import { buildLoadingFooterActions } from "./loading-shell-model";
import {
  getLoadingDisclosure,
  getLoadingShellTimerPolicy,
  getProviderResolveWaitPresentation,
  isPlaybackSupervisionOperation,
  normalizeLoadingIssue,
  normalizeProviderDetail,
  renderStageRail,
  shouldShowPlaybackRuntimeStrip,
  shouldShowLoadingElapsed,
  shouldShowStallRecoveryPrompt,
  stallRecoveryPromptDetail,
  stageLabel,
} from "./loading-shell-runtime";
import type { StageRailItem } from "./loading-shell-runtime";
import { buildMediaPanel } from "./media-panel-model";
import { MediaPanel } from "./MediaPanel";
import { OffscreenFreeze } from "./offscreen-freeze";
import { buildPlaybackRecoveryViewModel } from "./playback-recovery-view-model";
import { applyPlaybackShellInputEffect, resolvePlaybackShellInput } from "./playback-shell-input";
import { ProgressBar } from "./primitives/ProgressBar";
import { GlimmerLabel, SakuraBloom } from "./SakuraLoader";
import { useShellCommandModeOpen } from "./shell-command-mode";
import { ShellFrame } from "./shell-frame";
import { DetailLine } from "./shell-primitives";
import { truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { LoadingShellState, ShellPanelLine } from "./types";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

const MEMORY_PANEL_AUTO_HIDE_MS = 8_000;
// Matches getLoadingDisclosure's `showDiagnostics`/`showElapsed` gate: the
// runtime health line only becomes visible once the diagnostics strip reveals.
const LOADING_DIAGNOSTICS_REVEAL_SECONDS = 5;

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
  // Hold the latest getter in a ref so the polling effect depends only on
  // refreshMs. The getter is rebuilt inline every parent render (and the parent
  // re-renders on every playback telemetry tick), so depending on its identity
  // would tear down and restart the interval constantly.
  const getRuntimeHealthRef = React.useRef(getRuntimeHealth);
  React.useEffect(() => {
    getRuntimeHealthRef.current = getRuntimeHealth;
  });

  const [healthLine, setHealthLine] = React.useState<ShellPanelLine | undefined>(() =>
    refreshMs === null ? undefined : getRuntimeHealth?.(),
  );

  React.useEffect(() => {
    if (refreshMs === null) {
      setHealthLine(undefined);
      return undefined;
    }

    setHealthLine(getRuntimeHealthRef.current?.());
    const timer = setInterval(() => {
      setHealthLine(getRuntimeHealthRef.current?.());
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

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
              : item.tone === "warning"
                ? statusColor("warning")
                : item.tone === "info"
                  ? statusColor("info")
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
  onPickStreams: _onPickStreams,
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
  const supervisingPlayback = isPlaybackSupervisionOperation(state.operation);
  const elapsed = useElapsed(!supervisingPlayback);
  // Only poll runtime health when it is actually rendered: while supervising
  // playback it rides the memory panel, and during bootstrap the diagnostics
  // strip (and the health line with it) is gated to elapsed >= reveal seconds.
  // Polling before that just churns re-renders behind a hidden strip.
  const timerPolicy = getLoadingShellTimerPolicy({
    operation: state.operation,
    memoryPanelVisible,
    runtimeHealthVisible:
      memoryPanelVisible || (!supervisingPlayback && elapsed >= LOADING_DIAGNOSTICS_REVEAL_SECONDS),
  });
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
  const loadingViewport = useDebouncedViewportPolicy("playback");
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

  const isPlaying = state.operation === "playing";
  const canOpenSourcePicker = Boolean(state.hasStreamCandidates) && Boolean(onPickSource);
  const loadingIssue = normalizeLoadingIssue(state.latestIssue);
  const playbackTroubleActive =
    isPlaying && (state.bufferHealth === "stalled" || Boolean(loadingIssue));
  // Recovery surface only applies before/around playback start, not while a
  // healthy stream is playing (that path has its own buffer badge + controls).
  const recoveryView = !isPlaying ? buildPlaybackRecoveryViewModel(state) : null;

  const playbackInputHandlers = React.useMemo(
    () => ({
      onCancel,
      onStop,
      onRecover,
      onReloadSubtitles,
      onNext,
      onPrevious,
      onSkipSegment,
      onPickEpisode,
      onPickSource,
      onPickQuality,
      onReturnToSearch,
      onToggleAutoplay,
      onToggleAutoskip,
      onStopAfterCurrent,
      onFallback,
      onCommandAction: state.onCommandAction,
    }),
    [
      onCancel,
      onStop,
      onRecover,
      onReloadSubtitles,
      onNext,
      onPrevious,
      onSkipSegment,
      onPickEpisode,
      onPickSource,
      onPickQuality,
      onReturnToSearch,
      onToggleAutoplay,
      onToggleAutoskip,
      onStopAfterCurrent,
      onFallback,
      state.onCommandAction,
    ],
  );

  const commandModeOpen = useShellCommandModeOpen();

  useInput((input, key) => {
    if (commandModeOpen) return;
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestAppShutdown({ reason: "SIGINT", exitCode: 130 });
      return;
    }
    if (key.escape && state.cancellable && onCancel) {
      onCancel();
      return;
    }

    const effect = resolvePlaybackShellInput(input, key, {
      operation: state.operation,
      cancellable: Boolean(state.cancellable),
      fallbackAvailable: Boolean(state.fallbackAvailable),
      canOpenSourcePicker,
      recoveryViewActive: Boolean(recoveryView),
      playbackTroubleActive,
      handlers: playbackInputHandlers,
    });
    if (!effect) return;

    applyPlaybackShellInputEffect(effect, playbackInputHandlers, () => {
      setMemoryPanelVisible((visible) => !visible);
    });
  });
  const isWide = loadingViewport.breakpoint === "wide";
  const isWidePlaying = isPlaying && isWide;
  // Show the metadata panel during bootstrap too — not only once mpv starts — so
  // the right side is populated (poster, facts, synopsis stream in reactively)
  // instead of an empty column while we resolve. Gate on having real content so
  // a bare title never renders a lonely panel.
  const hasPanelContent = Boolean(state.posterUrl || state.titleDetail || state.videoMeta);
  const showSidePanel = isWide && (isPlaying || hasPanelContent);
  const totalPlayingWidth = Math.max(60, terminalColumns - 2);
  const sidePanelWidth = showSidePanel
    ? Math.min(36, Math.max(28, Math.floor(totalPlayingWidth * 0.27)))
    : 0;
  const infoWidth = showSidePanel
    ? Math.max(28, totalPlayingWidth - sidePanelWidth - 4)
    : Math.max(40, terminalColumns - 4);
  const playingPanelModel = React.useMemo(
    () =>
      buildMediaPanel({
        surface: "playing",
        contentKind: state.contentKind ?? (state.isSeriesPlayback ? "series" : "movie"),
        title: state.title,
        titleDetail: state.titleDetail,
        videoMeta: state.videoMeta,
        posterUrl: state.posterUrl,
        currentSeason: state.currentSeason,
        currentEpisode: state.currentEpisode,
        nextEpisodeLabel: state.hasNextEpisode ? state.nextEpisodeLabel : undefined,
        nextEpisodeThumbUrl: state.nextEpisodeThumbUrl,
        queueNextLabel: state.queueNextLabel,
        autoplayPaused: state.autoplayPaused,
      }),
    [
      state.contentKind,
      state.isSeriesPlayback,
      state.title,
      state.titleDetail,
      state.videoMeta,
      state.posterUrl,
      state.currentSeason,
      state.currentEpisode,
      state.hasNextEpisode,
      state.nextEpisodeLabel,
      state.nextEpisodeThumbUrl,
      state.queueNextLabel,
      state.autoplayPaused,
    ],
  );

  const activeStage = state.stage ?? (isPlaying ? "starting-playback" : "finding-stream");
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
        state.subtitleTrack ?? (subtitleReady ? "subs on" : undefined),
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
    dominantPhaseLabel: state.dominantPhaseLabel,
  });
  const disclosure = getLoadingDisclosure(
    elapsed,
    Boolean(loadingIssue),
    state.progress !== undefined,
  );
  // When loading has stalled for ≥ 20s and there is no fallback and the
  // surface is not cancellable, the user would otherwise see an eternal
  // spinner. Surface an explicit "wait / exit" prompt so they always have
  // a way out. See shouldShowStallRecoveryPrompt in loading-shell-runtime.
  const showStallPrompt = shouldShowStallRecoveryPrompt({
    operation: state.operation,
    elapsedSeconds: elapsed,
    cancellable: Boolean(state.cancellable),
    fallbackAvailable: state.fallbackAvailable === true,
  });

  const footerActions = buildLoadingFooterActions(state);

  return (
    <ShellFrame
      eyebrow="playback"
      title={state.title}
      subtitle={state.subtitle ?? "Preparing playback"}
      contentOnlyChrome
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
      letterKeysHandledExternally
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
        <Box flexDirection="column" flexGrow={1} width="100%">
          {/* ── Resolving / Loading ───────────────────────────────────────── */}
          {!isPlaying && (
            <Box flexDirection="row" flexGrow={1}>
              <Box flexDirection="column" justifyContent="center" flexGrow={1} paddingY={1}>
                {/* Signature ❀ bloom + glimmer stage label, then stage context */}
                <Box flexDirection="row" marginTop={1} alignItems="flex-start">
                  <Box marginRight={2}>
                    <OffscreenFreeze
                      active={timerPolicy.animate}
                      frozen={timerPolicy.freezeWhenOffscreen}
                    >
                      <SakuraBloom
                        active={timerPolicy.animate && !timerPolicy.freezeWhenOffscreen}
                        stalled={showStallPrompt}
                      />
                    </OffscreenFreeze>
                  </Box>
                  <Box flexDirection="column" flexGrow={1}>
                    <GlimmerLabel
                      label={state.stageDetail || stageLabel(activeStage)}
                      active={timerPolicy.animate && !timerPolicy.freezeWhenOffscreen}
                      stalled={showStallPrompt}
                    />
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
                    {showStallPrompt && (
                      <Box flexDirection="column" marginTop={1}>
                        <Text color={statusColor("warning")} bold>
                          Source not responding
                        </Text>
                        <Text color={palette.dim}>
                          {stallRecoveryPromptDetail({
                            canOpenDiagnostics: Boolean(state.onCommandAction),
                          })}
                        </Text>
                      </Box>
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
                  <Box marginTop={1} flexDirection="row">
                    <ProgressBar value={state.progress} max={100} width={barWidth} />
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
              {showSidePanel ? (
                <MediaPanel
                  model={playingPanelModel}
                  railWidth={sidePanelWidth}
                  active={timerPolicy.animate && !timerPolicy.freezeWhenOffscreen}
                />
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
                  <Box marginTop={1} flexDirection="row">
                    <Text color={palette.accent} bold>
                      {formatTimestamp(state.currentPosition)}
                    </Text>
                    <Text color={palette.dim}> </Text>
                    <ProgressBar
                      value={state.currentPosition}
                      max={state.duration}
                      width={barWidth}
                    />
                    <Text color={palette.dim}> {formatTimestamp(state.duration)}</Text>
                    {state.progress !== undefined ? (
                      <Text color={palette.dim}>{`  ·  ${Math.round(state.progress)}%`}</Text>
                    ) : null}
                  </Box>
                ) : (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={palette.text} bold>
                      Starting mpv session
                    </Text>
                    <Text color={palette.dim} dimColor>
                      Waiting for first playback progress from mpv
                    </Text>
                  </Box>
                )}

                {state.playbackSourceLine ? (
                  <Box marginTop={2}>
                    <Text color={palette.dim}>{"SRC  "}</Text>
                    <Text color={palette.text}>
                      {truncateLine(state.playbackSourceLine, infoWidth - 6)}
                    </Text>
                  </Box>
                ) : null}

                {state.sourceToggleHint ? (
                  <Box marginTop={state.playbackSourceLine ? 1 : 2}>
                    <Text color={palette.dim}>{"ALT  "}</Text>
                    <Text color={palette.accentDeep}>
                      {truncateLine(state.sourceToggleHint, infoWidth - 6)}
                    </Text>
                  </Box>
                ) : null}

                {/* NOW — facts on one line (quality · subs · session). */}
                <Box marginTop={state.playbackSourceLine || state.sourceToggleHint ? 1 : 2}>
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

                {/* GO — live key hints from session state or wired callbacks. */}
                <Box>
                  <Text color={palette.dim}>{"GO   "}</Text>
                  <Text color={palette.textDim}>
                    {truncateLine(
                      state.playbackKeysHint ??
                        [
                          state.hasNextEpisode && onNext ? "n next" : null,
                          state.hasPreviousEpisode && onPrevious ? "p prev" : null,
                          onSkipSegment ? "b skip" : null,
                          canOpenSourcePicker ? "o source" : null,
                          onPickQuality ? "k quality" : null,
                          onPickEpisode ? "e episodes" : null,
                          onToggleAutoplay ? "a autoplay" : null,
                          onToggleAutoskip ? "u autoskip" : null,
                          "q stop",
                          "/ commands",
                        ]
                          .filter((part): part is string => Boolean(part))
                          .join("  ·  "),
                      infoWidth - 5,
                    )}
                  </Text>
                </Box>

                {/* mpv ownership hint — Kunai owns session, mpv owns the video. */}
                <Box marginTop={1}>
                  <Text color={palette.dim} dimColor>
                    Terminal or mpv — n/p/e/o/v/u shortcuts stay live · / for full commands
                  </Text>
                </Box>

                {/* Health/trouble only surfaces when there is something to act on. */}
                {playbackTrouble ? (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={palette.danger} bold>
                      {`⚠ ${truncateLine(playbackTrouble, infoWidth - 2)}`}
                    </Text>
                    <Text color={palette.dim}>
                      {"r recover  ·  f fallback  ·  o source  ·  d diagnostics"}
                    </Text>
                  </Box>
                ) : state.bufferHealth === "buffering" || state.bufferHealth === "stalled" ? (
                  <Box marginTop={1}>
                    <BufferHealthBadge health={state.bufferHealth} />
                  </Box>
                ) : null}

                {/* Up next on narrow/medium — wide terminals show this on the right rail. */}
                {!isWidePlaying && state.upNextLabel?.trim() ? (
                  <Box marginTop={1}>
                    <Text color={palette.accent}>{"▶ "}</Text>
                    <Text color={palette.dim} dimColor>
                      {"up next  "}
                    </Text>
                    <Text color={palette.text}>
                      {truncateLine(state.upNextLabel, infoWidth - 10)}
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
              {showSidePanel ? (
                <MediaPanel model={playingPanelModel} railWidth={sidePanelWidth} />
              ) : null}
            </Box>
          )}
        </Box>
      </Box>
    </ShellFrame>
  );
});
