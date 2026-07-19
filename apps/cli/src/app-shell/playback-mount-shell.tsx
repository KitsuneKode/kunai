import { buildPlaybackBootstrapPresentation } from "@/app/playback/playback-bootstrap-presenter";
import { isLocalPlaybackStream } from "@/app/playback/playback-source-ui";
import {
  formatPlaybackSessionFactsStrip,
  formatPlaybackSourceLine,
} from "@/app/playback/source-quality";
import {
  compactPlaybackSubtitleStatus,
  describePlaybackSubtitleStatus,
} from "@/app/playback/subtitle-status";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import {
  mediaLanguageProfileFor,
  resolveContentKind,
  showsEpisodeLabel,
} from "@/domain/media/content-kind";
import {
  describePlaybackTelemetrySnapshot,
  type PlaybackTelemetrySnapshot,
} from "@/domain/playback/playback-telemetry-snapshot";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import type { SessionState } from "@/domain/session/SessionState";
import { peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import { isEpisodeDownloaded } from "@/services/offline/offline-episode-index";
import type { ProviderId } from "@kunai/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { COMMAND_CONTEXTS, resolveCommandContext } from "./commands";
import { usePosterSurfaceBoundaryCleanup } from "./image-pane";
import { LoadingShell } from "./loading-shell";
import { formatPlaybackSessionKeysHint } from "./playback-session-key-hints";
import { buildPostPlayFooterActions } from "./post-play-footer-actions";
import { PostPlayShell } from "./post-play-shell";
import {
  buildPostPlayView,
  isPostPlayPlaybackRestartResult,
  resolvePostPlayMenuAction,
  resolvePostPlayUnhandledInput,
} from "./post-play-view";
import { mountRootContent } from "./root-content-state";
import { fallbackCommandState } from "./shell-command-model";
import { ShellFrame } from "./shell-frame";
import { ResizeBlocker } from "./shell-primitives";
import { APP_LABEL } from "./shell-theme";
import type {
  LoadingShellState,
  PlaybackShellResult,
  PlaybackShellState,
  ShellAction,
} from "./types";
import { useSessionSelector } from "./use-session-selector";
import { useDebouncedViewportPolicy } from "./use-viewport-policy";

export type PlaybackRootContentHandlers = {
  readonly onCommandAction: (action: ShellAction) => void;
  readonly onCancel: () => void;
  readonly onStop: () => void;
  readonly onNext?: () => void;
  readonly onPrevious?: () => void;
  readonly onRecover: () => void;
  readonly onFallback: () => void;
  readonly onPickStreams: () => void;
  readonly onPickEpisode?: () => void;
  readonly onReloadSubtitles: () => void;
  readonly onSkipSegment: () => void;
  readonly onToggleAutoplay?: () => void;
  readonly onToggleAutoskip: () => void;
  readonly onStopAfterCurrent?: () => void;
  readonly onPickSource: () => void;
  readonly onPickQuality: () => void;
  readonly onReturnToSearch: () => void;
};

export type PlaybackRootContentInput = {
  readonly container: Container;
  readonly state: SessionState;
  readonly playbackSubtitle: string | undefined;
  readonly playbackSubtitleStatus: string;
  readonly playbackBootstrapPresentation: ReturnType<typeof buildPlaybackBootstrapPresentation>;
  readonly playbackBootstrapStageDetail: string | undefined;
  readonly downloadStatus: string | null;
  readonly playbackCanCancel: boolean;
  readonly playbackTrace: string | undefined;
  readonly fallbackProvider: { metadata: { name?: string; id: string } } | undefined;
  readonly activeProvider: { metadata: { name: string } } | undefined;
  readonly hasStreamCandidates: boolean;
  readonly isSeriesPlayback: boolean;
  readonly activePlaybackTelemetrySnapshot?: PlaybackTelemetrySnapshot | null;
  readonly canGoNext: boolean;
  readonly canGoPrevious: boolean;
  readonly canToggleAutoplay: boolean;
  readonly canStopAfterCurrent: boolean;
  readonly playingTitleDetail: ReturnType<typeof peekTitleDetail>;
  readonly handlers: PlaybackRootContentHandlers;
};

export function buildPlaybackRootLoadingShellState(
  input: PlaybackRootContentInput,
): LoadingShellState {
  const {
    container,
    state,
    playbackSubtitle,
    playbackSubtitleStatus,
    playbackBootstrapPresentation,
    playbackBootstrapStageDetail,
    downloadStatus,
    playbackCanCancel,
    playbackTrace,
    fallbackProvider,
    activeProvider,
    hasStreamCandidates,
    isSeriesPlayback,
    activePlaybackTelemetrySnapshot,
    canGoNext,
    canGoPrevious,
    canToggleAutoplay,
    playingTitleDetail,
    handlers,
  } = input;

  const isActivePlayback =
    state.playbackStatus === "playing" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled";

  const queueNextLabel = formatQueueEntryLabel(container.queueService.peekNext());

  return {
    title: state.currentTitle?.name || "Resolving...",
    subtitle: playbackSubtitle,
    operation: playbackBootstrapPresentation.operation,
    stage: playbackBootstrapPresentation.stage,
    stageDetail: playbackBootstrapStageDetail,
    dominantPhaseLabel: playbackBootstrapPresentation.dominantPhaseLabel,
    details: state.playbackDetail ?? `Provider: ${state.provider}`,
    providerName: activeProvider?.metadata.name ?? state.provider,
    providerId: state.provider,
    subtitleStatus: isActivePlayback ? playbackSubtitleStatus : undefined,
    downloadStatus: downloadStatus ?? undefined,
    cancellable: playbackCanCancel,
    trace: playbackTrace,
    showMemory: container.config.showMemory,
    posterUrl: state.currentTitle?.posterUrl,
    getRuntimeHealth: () => {
      const persisted = state.provider
        ? container.providerHealth.get(state.provider as ProviderId)
        : undefined;
      const snapshot = buildRuntimeHealthSnapshot({
        recentEvents: container.diagnosticsService.getRecent(25),
        currentProvider: state.provider,
        persistedProviderHealth: persisted,
      });
      return isActivePlayback ? snapshot.network : snapshot.provider;
    },
    fallbackAvailable: Boolean(fallbackProvider),
    fallbackProviderName: fallbackProvider?.metadata.name ?? fallbackProvider?.metadata.id,
    hasStreamCandidates,
    autoskipPaused: state.autoskipSessionPaused,
    autoplayPaused: state.autoplaySessionPaused,
    isSeriesPlayback,
    latestIssue: state.playbackNote,
    currentPosition: activePlaybackTelemetrySnapshot?.positionSeconds,
    duration: activePlaybackTelemetrySnapshot?.durationSeconds,
    bufferHealth:
      state.playbackStatus === "stalled"
        ? "stalled"
        : state.playbackStatus === "buffering" || activePlaybackTelemetrySnapshot?.pausedForCache
          ? "buffering"
          : activePlaybackTelemetrySnapshot
            ? "healthy"
            : undefined,
    playbackSourceLine: formatPlaybackSourceLine(state.stream) ?? undefined,
    sourceToggleHint: (() => {
      const episode = state.currentEpisode;
      const title = state.currentTitle;
      if (!episode || !title) return undefined;
      if (isLocalPlaybackStream(state.stream)) {
        return "/watch-online to stream this episode online";
      }
      if (
        isEpisodeDownloaded(
          container.offlineAssetService,
          title.id,
          episode.season,
          episode.episode,
        )
      ) {
        return "/play-local to use the downloaded copy";
      }
      return undefined;
    })(),
    playbackFactsStrip: isActivePlayback
      ? formatPlaybackSessionFactsStrip({
          stream: state.stream,
          autoplayPaused: state.autoplaySessionPaused,
          autoskipPaused: state.autoskipSessionPaused,
          canToggleAutoplay,
          stopAfterCurrent: state.stopAfterCurrent,
          isSeries: state.currentTitle?.type === "series",
        })
      : undefined,
    playbackKeysHint: isActivePlayback
      ? formatPlaybackSessionKeysHint({
          stream: state.stream,
          autoplayPaused: state.autoplaySessionPaused,
          autoskipPaused: state.autoskipSessionPaused,
          canToggleAutoplay,
          stopAfterCurrent: state.stopAfterCurrent,
          isSeries: state.currentTitle?.type === "series",
          hasNextEpisode: canGoNext,
          hasPreviousEpisode: canGoPrevious,
        })
      : undefined,
    commands: resolveCommandContext(state, "activePlayback"),
    footerMode: effectiveFooterHints(container),
    qualityLabel: (() => {
      const result = state.stream?.providerResolveResult;
      const selected = result?.streams.find(
        (candidate) => candidate.id === result.selectedStreamId,
      );
      return selected?.qualityLabel ?? selected?.container;
    })(),
    audioTrack: state.stream?.audioLanguages?.length
      ? state.stream.audioLanguages.join(", ")
      : undefined,
    subtitleTrack: compactPlaybackSubtitleStatus(playbackSubtitleStatus),
    nextEpisodeLabel: state.episodeNavigation.nextLabel,
    previousEpisodeLabel: state.episodeNavigation.previousLabel,
    hasNextEpisode: state.episodeNavigation.hasNext,
    hasPreviousEpisode: state.episodeNavigation.hasPrevious,
    upNextLabel: state.episodeNavigation.hasNext
      ? state.episodeNavigation.nextLabel
      : queueNextLabel,
    queueNextLabel: state.episodeNavigation.hasNext ? undefined : queueNextLabel,
    titleDetail: playingTitleDetail ?? undefined,
    // The media panel resolves the next-episode still itself (season-aware, with
    // a graceful poster fallback) from titleDetail + the next-episode label, so
    // there is one resolution path instead of a redundant precomputed value.
    episodeLabel:
      state.currentEpisode && state.currentTitle?.type === "series"
        ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(state.currentEpisode.episode).padStart(2, "0")}`
        : undefined,
    currentSeason: state.currentEpisode?.season,
    currentEpisode: state.currentEpisode?.episode,
    contentKind: resolveContentKind(state.currentTitle, state.mode),
    videoMeta: state.videoMeta,
    onCommandAction: handlers.onCommandAction,
  };
}

/**
 * Warm the modules behind the track/source panel (`o`, quality, subtitles)
 * while the playback surface is idle. Both entry points lazy-import them, and
 * a cold import on the first keypress read as "o does nothing" for a beat.
 */
function preloadTracksPanelModules(): void {
  void import("./workflows");
  void import("@/app/playback/tracks-panel-pick");
}

export function PlaybackRootContent(input: PlaybackRootContentInput) {
  const { state, handlers, canGoNext, canGoPrevious, canToggleAutoplay, canStopAfterCurrent } =
    input;
  useEffect(preloadTracksPanelModules, []);
  const playbackIsActive =
    state.playbackStatus === "ready" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled" ||
    state.playbackStatus === "playing";
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<PlaybackTelemetrySnapshot | null>(
    null,
  );

  useEffect(() => {
    if (!playbackIsActive) return undefined;
    const refreshSnapshot = () => {
      setTelemetrySnapshot(input.container.playerControl.getTelemetrySnapshot());
    };
    refreshSnapshot();
    const timer = setInterval(refreshSnapshot, 1_000);
    return () => clearInterval(timer);
  }, [input.container.playerControl, playbackIsActive]);

  const activePlaybackTelemetrySnapshot = playbackIsActive ? telemetrySnapshot : null;
  const telemetryInput = useMemo(
    () => ({
      ...input,
      activePlaybackTelemetrySnapshot,
      playbackTrace:
        state.playbackNote ??
        (activePlaybackTelemetrySnapshot
          ? describePlaybackTelemetrySnapshot(activePlaybackTelemetrySnapshot)
          : input.playbackTrace),
    }),
    [activePlaybackTelemetrySnapshot, input, state.playbackNote],
  );
  const loadingState = useMemo(
    () => buildPlaybackRootLoadingShellState(telemetryInput),
    [telemetryInput],
  );

  return (
    <LoadingShell
      key={`playback-ep-${state.currentTitle?.id ?? "none"}:${state.currentEpisode?.season ?? 0}:${state.currentEpisode?.episode ?? 0}`}
      state={loadingState}
      onCancel={handlers.onCancel}
      onStop={handlers.onStop}
      onNext={canGoNext ? handlers.onNext : undefined}
      onPrevious={canGoPrevious ? handlers.onPrevious : undefined}
      onRecover={handlers.onRecover}
      onFallback={handlers.onFallback}
      onPickStreams={handlers.onPickStreams}
      onPickEpisode={state.currentTitle?.type === "series" ? handlers.onPickEpisode : undefined}
      onReloadSubtitles={handlers.onReloadSubtitles}
      onSkipSegment={handlers.onSkipSegment}
      onToggleAutoplay={canToggleAutoplay ? handlers.onToggleAutoplay : undefined}
      onToggleAutoskip={handlers.onToggleAutoskip}
      onStopAfterCurrent={canStopAfterCurrent ? handlers.onStopAfterCurrent : undefined}
      onPickSource={handlers.onPickSource}
      onPickQuality={handlers.onPickQuality}
      onReturnToSearch={handlers.onReturnToSearch}
    />
  );
}

export function buildPlaybackSubtitleLine(state: SessionState): string | undefined {
  return state.currentEpisode && showsEpisodeLabel(state.currentTitle)
    ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
        state.currentEpisode.episode,
      ).padStart(2, "0")}`
    : undefined;
}

export function buildPlaybackSubtitleStatusLine(state: SessionState): string {
  return describePlaybackSubtitleStatus(state.stream, mediaLanguageProfileFor(state).subtitle);
}

function PlaybackShell({
  container,
  state,
  onResolve,
}: {
  container: Container;
  state: PlaybackShellState;
  onResolve: (result: PlaybackShellResult) => void;
}) {
  usePosterSurfaceBoundaryCleanup(true);
  useEffect(preloadTracksPanelModules, []);
  const playbackViewport = useDebouncedViewportPolicy("playback");
  const overlayBlocksInput = useSessionSelector(
    container.stateManager,
    (session) => session.activeModals.length > 0,
    (left, right) => left === right,
  );
  const watchTimeSummary = useSessionSelector(
    container.stateManager,
    (session) => session.watchTimeSummary,
    (left, right) => left === right,
  );
  const commands = state.commands ?? fallbackCommandState(COMMAND_CONTEXTS.postPlayback);
  const postPlayState = state.postPlayState ?? { kind: "mid-series" as const };
  const canResume = Boolean(state.resumeLabel);
  const providerCount = useMemo(
    () =>
      container.providerRegistry
        .getAll()
        .filter((provider) => provider.metadata.isAnimeProvider === (state.mode === "anime"))
        .length,
    [container, state.mode],
  );
  const footerActions = buildPostPlayFooterActions(postPlayState, {
    canResume,
    providerCount,
    autoplayPaused: state.autoplayPaused,
    autoskipPaused: state.autoskipPaused,
    stopAfterCurrent: state.stopAfterCurrent,
  });
  const contextStrip = [
    "post-play",
    state.provider,
    state.episodeLabel,
    state.mode === "anime" ? "anime" : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("  ·  ");
  const recommendations = state.recommendationRailItems ?? [];
  const postPlayView = buildPostPlayView({
    title: state.title,
    episodeLabel: state.episodeLabel ?? "",
    nextEpisodeLabel: state.nextEpisodeLabel,
    queueNextLabel: state.queueNextLabel,
    resumeLabel: state.resumeLabel,
    postPlayState,
    recommendations,
    totalEpisodes: state.totalEpisodes,
    watchedEpisodes: state.watchedEpisodes,
    currentSeason: state.currentSeason ?? state.season,
    titleDetail: state.titleDetail,
    autoplayPaused: state.autoplayPaused,
    autoskipPaused: state.autoskipPaused,
    stopAfterCurrent: state.stopAfterCurrent,
  });
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const postPlayResetKey = `${postPlayState.kind}|${state.episodeLabel ?? ""}|${state.resumeLabel ?? ""}`;
  const [prevPostPlayResetKey, setPrevPostPlayResetKey] = useState(postPlayResetKey);
  if (postPlayResetKey !== prevPostPlayResetKey) {
    setPrevPostPlayResetKey(postPlayResetKey);
    setSelectedActionIndex(0);
  }

  const openInlineTracks = useCallback(
    async (initialSection: DecodedTrackSelection["section"]) => {
      const stream = container.stateManager.getState().stream;
      if (!stream) {
        onResolve("source");
        return;
      }
      const { openTracksPanel } = await import("./workflows");
      const picked = await openTracksPanel(stream, { initialSection }, container);
      if (picked) {
        onResolve({ type: "track-selection", pick: picked });
      }
    },
    [container, onResolve],
  );

  const resolvePostPlayAction = useCallback(
    (result: PlaybackShellResult) => {
      if (
        result === "source" ||
        result === "quality" ||
        result === "audio" ||
        result === "subtitle"
      ) {
        void openInlineTracks(
          result === "source"
            ? "source"
            : result === "quality"
              ? "quality"
              : result === "audio"
                ? "audio"
                : "subtitle",
        );
        return;
      }
      if (isPostPlayPlaybackRestartResult(result)) {
        container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "loading" });
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          detail: result === "resume" ? "Resuming playback" : "Preparing playback",
        });
      }
      onResolve(result);
    },
    [container.stateManager, onResolve, openInlineTracks],
  );

  const runSelectedPostPlayAction = useCallback(() => {
    const action = postPlayView.actions[selectedActionIndex];
    if (!action) return;
    const resolved = resolvePostPlayMenuAction(action);
    if (resolved) {
      resolvePostPlayAction(resolved);
    }
  }, [resolvePostPlayAction, postPlayView.actions, selectedActionIndex]);

  return (
    <ShellFrame
      eyebrow={APP_LABEL}
      title={state.title}
      subtitle={contextStrip}
      contentOnlyChrome
      status={state.status}
      footerTask="Post-play"
      footerActions={footerActions}
      footerMode="minimal"
      commands={commands}
      inputLocked={overlayBlocksInput}
      escapeAction="back-to-results"
      onUnhandledInput={(input, key) => {
        if (key.upArrow || input === "k") {
          setSelectedActionIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow || input === "j") {
          setSelectedActionIndex((index) =>
            Math.min(Math.max(0, postPlayView.actions.length - 1), index + 1),
          );
          return;
        }
        const resolved = resolvePostPlayUnhandledInput(input, key, {
          blockedByOverlay: overlayBlocksInput,
          postPlayStateKind: postPlayState.kind,
          canResume,
          hasNextSeason:
            postPlayState.kind === "season-finale" ? postPlayState.hasNextSeason : false,
          selectedActionAvailable: postPlayView.actions[selectedActionIndex] !== undefined,
          recommendationCount: recommendations.length,
        });
        if (!resolved) return;
        if (resolved.type === "run-selected-action") {
          runSelectedPostPlayAction();
          return;
        }
        if (resolved.type === "recommendation") {
          const item = recommendations[resolved.index];
          if (item) onResolve({ type: "play-recommendation", item });
          return;
        }
        if (resolved.type === "recommendation-actions") {
          const item = recommendations[resolved.index];
          if (item) onResolve({ type: "open-recommendation-actions", items: [item] });
          return;
        }
        if (resolved.result === "source") {
          void openInlineTracks("source");
          return;
        }
        onResolve(resolved.result);
      }}
      onResolve={resolvePostPlayAction}
    >
      {playbackViewport.tooSmall ? (
        <ResizeBlocker
          columns={playbackViewport.columns}
          rows={playbackViewport.rows}
          minColumns={playbackViewport.minColumns}
          minRows={playbackViewport.minRows}
          message="Resize terminal for post-play controls"
        />
      ) : (
        <PostPlayShell
          title={state.title}
          episodeLabel={state.episodeLabel ?? ""}
          nextEpisodeLabel={state.nextEpisodeLabel}
          previousEpisodeLabel={state.previousEpisodeLabel}
          queueNextLabel={state.queueNextLabel}
          resumeLabel={state.resumeLabel}
          postPlayState={postPlayState}
          recommendations={recommendations}
          totalEpisodes={state.totalEpisodes}
          watchedEpisodes={state.watchedEpisodes}
          currentSeason={state.currentSeason ?? state.season}
          currentEpisode={state.currentEpisode ?? state.episode}
          contentKind={state.contentKind}
          videoMeta={state.videoMeta}
          posterUrl={state.posterUrl}
          nextEpisodeThumbUrl={state.nextEpisodeThumbUrl}
          previousEpisodeThumbUrl={state.previousEpisodeThumbUrl}
          titleDetail={state.titleDetail}
          autoplayPaused={state.autoplayPaused}
          autoskipPaused={state.autoskipPaused}
          stopAfterCurrent={state.stopAfterCurrent}
          selectedActionIndex={selectedActionIndex}
          watchTimeSummary={watchTimeSummary ?? undefined}
        />
      )}
    </ShellFrame>
  );
}

export function openPlaybackShell({
  state,
  container,
}: {
  state: PlaybackShellState;
  container: Container;
}): Promise<PlaybackShellResult> {
  const session = mountRootContent<PlaybackShellResult>({
    kind: state.postPlayState ? "post-playback" : "playback",
    renderContent: (finish) => (
      <PlaybackShell container={container} state={state} onResolve={finish} />
    ),
    fallbackValue: "quit",
  });

  return session.result;
}
