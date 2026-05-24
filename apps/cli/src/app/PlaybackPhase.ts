// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import { routePlaybackShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import { buildShellRuntimeBindings } from "@/app-shell/runtime-bindings";
import type { PlaybackRecommendationRailItem } from "@/app-shell/types";
import {
  openTracksPanel,
  buildPickerActionContext,
  openSubtitlePicker,
  handleShellAction,
  enqueueCurrentPlaybackDownload,
} from "@/app-shell/workflows";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { runAutoplayAdvanceCountdown } from "@/app/autoplay-advance-countdown";
import { episodeInfoFromSelection } from "@/app/episode-info-from-catalog";
import {
  adoptEpisodePrefetchBundle,
  EpisodePrefetchHandle,
  isEpisodePrefetchEligible,
  type EpisodePrefetchBundle,
  type EpisodePrefetchProgress,
  type EpisodePrefetchTarget,
} from "@/app/episode-prefetch";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";
import { resumeSecondsFromHistoryForEpisode } from "@/app/playback-resume-from-history";
import {
  createPlaybackSessionState,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  resolvePlaybackResultDecision,
  resolvePostPlaybackSessionAction,
  syncPlaybackSessionState,
  transitionPlaybackSessionPhase,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback-session-controller";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback-start-intent";
import {
  buildPostPlayEpisodeLabel,
  buildPostPlayInputFromPlaybackContext,
  buildPostPlayNextEpisodeLabel,
} from "@/app/post-play-input";
import {
  loadPostPlaybackRecommendationItems,
  type PostPlaybackRecommendationItem,
  seedPostPlaybackRecommendationItems,
} from "@/app/post-playback-recommendations";
import {
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/app/provider-resolve-copy";
import { createResolveTraceStub } from "@/app/resolve-trace";
import {
  applyPreferredStreamSelection,
  emptyStreamSelectionIntent,
  streamSelectionFromTrackPick,
} from "@/app/source-quality";
import {
  createSourceRefreshCooldownState,
  resolveSourceRefreshDecision,
  type SourceRefreshAction,
} from "@/app/source-refresh-policy";
import { choosePlaybackSubtitle } from "@/app/subtitle-selection";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import { titleInfoFromSearchResult } from "@/app/title-info";
import {
  buildProviderResolveProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import { resolvePostPlayState } from "@/domain/playback/post-play-state";
import { hardSubSatisfiesSubtitlePreference } from "@/domain/subtitle-policy";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackTimingMetadata,
  ShellMode,
  StreamInfo,
  PlaybackResult,
  SubtitleTrack,
  SearchResult,
} from "@/domain/types";
import {
  classifyPlaybackFailureFromEvent,
  recoveryForPlaybackFailure,
} from "@/infra/player/playback-failure-classifier";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import { AniSkipTimingSource, IntroDbTimingSource, PlaybackTimingAggregator } from "@/infra/timing";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { formatTimestamp } from "@/services/persistence/HistoryStore";
import { PlaybackResolveCoordinator } from "@/services/playback/PlaybackResolveCoordinator";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import type { ResolveAttempt } from "@kunai/core";

const timingAggregator = new PlaybackTimingAggregator([IntroDbTimingSource, AniSkipTimingSource]);

async function applyMpvEpisodeLoadingOverlay(
  control: ActivePlayerControl | null,
  episode: EpisodeInfo,
) {
  if (!control) return;
  const label = `Kunai · Loading S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}…`;
  if (control.setEpisodeTransitionLoading) {
    await control.setEpisodeTransitionLoading(label);
  } else {
    await control.showOsdMessage?.(label, 120_000);
  }
}

export type PlaybackOutcome =
  | "back_to_search"
  | "back_to_results"
  | "mode_switch"
  | "quit"
  | { type: "history_entry"; title: TitleInfo; episode?: EpisodeInfo }
  | {
      type: "playlist-advance";
      titleInfo: TitleInfo;
      mode: ShellMode;
      season?: number;
      episode?: number;
    };

function enqueuePostPlaybackRecommendation(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
): void {
  container.playlistService.enqueueMediaItem(
    {
      mediaKind: item.type,
      ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      titleId: item.id,
      title: item.title,
    },
    { placement: "end", source: "post-playback-recommendation" },
  );
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Queued ${item.title}.`,
  });
}

type RecommendationRailPanelAction =
  | { readonly type: "queue"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "details"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "download"; readonly item: PlaybackRecommendationRailItem }
  | { readonly type: "back" };

async function openPostPlaybackRecommendationActionPanel({
  container,
  items,
  mode,
}: {
  readonly container: PhaseContext["container"];
  readonly items: readonly PlaybackRecommendationRailItem[];
  readonly mode: "series" | "anime";
}): Promise<void> {
  if (items.length === 0) return;
  const { openListShell } = await import("../app-shell/ink-shell");
  const actionContext = buildPickerActionContext({
    container,
    taskLabel: "Recommendation actions",
  });
  const action = await openListShell<RecommendationRailPanelAction>({
    title: "Recommendations",
    subtitle: `${items.length} pick${items.length === 1 ? "" : "s"}  ·  queue is local-only  ·  download confirms before resolving`,
    actionContext,
    options: [
      ...items.flatMap((item) => {
        const titleLabel = `${item.title}${item.year ? ` (${item.year})` : ""}${item.type ? `  ·  ${item.type}` : ""}`;
        return [
          {
            value: { type: "queue" as const, item },
            label: `Queue  ·  ${titleLabel}`,
            detail: "Add to playlist queue without resolving a stream",
          },
          {
            value: { type: "download" as const, item },
            label: `Download  ·  ${titleLabel}`,
            detail: "Confirm before provider resolution  ·  will not autoplay",
          },
          {
            value: { type: "details" as const, item },
            label: `Details  ·  ${titleLabel}`,
            detail: "Show cached metadata  ·  no provider calls",
          },
        ];
      }),
      { value: { type: "back" as const }, label: "Back" },
    ],
  });
  if (!action || action.type === "back") return;
  if (action.type === "queue") {
    enqueuePostPlaybackRecommendation(container, action.item);
    return;
  }
  if (action.type === "details") {
    await openRecommendationDetailsPanel(container, action.item);
    return;
  }
  await confirmAndDownloadPostPlaybackRecommendation(container, action.item, mode);
}

async function openRecommendationDetailsPanel(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
): Promise<void> {
  const { openListShell } = await import("../app-shell/ink-shell");
  await openListShell<number>({
    title: item.title,
    subtitle: "Cached recommendation details · no provider calls",
    actionContext: buildPickerActionContext({
      container,
      taskLabel: `Details: ${item.title}`,
    }),
    options: [
      { value: 0, label: "Type", detail: item.type },
      ...(item.year ? [{ value: 1, label: "Year", detail: item.year }] : []),
      ...(item.sourceId ? [{ value: 2, label: "Source", detail: item.sourceId }] : []),
      ...(item.episodeCount
        ? [{ value: 3, label: "Episodes", detail: String(item.episodeCount) }]
        : []),
      ...(item.overview ? [{ value: 4, label: "Overview", detail: item.overview }] : []),
      { value: -1, label: "Back" },
    ],
  });
}

async function confirmAndDownloadPostPlaybackRecommendation(
  container: PhaseContext["container"],
  item: PlaybackRecommendationRailItem,
  mode: "series" | "anime",
): Promise<void> {
  const eligibility = container.downloadService.getEnqueueEligibility();
  if (!eligibility.allowed) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    return;
  }

  const { openListShell } = await import("../app-shell/ink-shell");
  const confirmed = await openListShell<boolean>({
    title: `Download ${item.title}?`,
    subtitle: "This may contact the provider to resolve playable streams. It will not autoplay.",
    actionContext: buildPickerActionContext({
      container,
      taskLabel: `Download: ${item.title}`,
    }),
    options: [
      {
        value: false,
        label: "Back",
        detail: "No provider calls, no download queued",
      },
      {
        value: true,
        label: "Queue download",
        detail: "Resolve provider stream only after this confirmation",
      },
    ],
  });
  if (!confirmed) return;

  const searchResult = recommendationRailItemToSearchResult(item);
  const mapped =
    mode === "anime"
      ? await mapAnimeDiscoveryResultToProviderNative(searchResult, {
          mode,
          providerId: container.stateManager.getState().provider,
          animeLanguageProfile: container.config.animeLanguageProfile,
          providerRegistry: container.providerRegistry,
          signal: AbortSignal.timeout(12_000),
        }).catch(() => searchResult)
      : searchResult;

  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  await new DownloadOnlyPhase().execute(
    {
      title: titleInfoFromSearchResult(mapped),
    },
    { container, signal: new AbortController().signal },
  );
}

function recommendationRailItemToSearchResult(item: PlaybackRecommendationRailItem): SearchResult {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
    year: item.year ?? "",
    overview: item.overview ?? "",
    posterPath: item.posterPath ?? null,
    ...(item.sourceId ? { metadataSource: item.sourceId } : {}),
    ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
  };
}

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private static readonly lateSubtitleInflight = new Set<string>();

  private updatePlaybackFeedback(
    context: PhaseContext,
    feedback: { detail?: string | null; note?: string | null },
  ) {
    context.container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      detail: feedback.detail,
      note: feedback.note,
    });
  }

  private transitionPlaybackSession(
    context: PhaseContext,
    session: PlaybackSessionState,
    event: PlaybackSessionPhaseEvent,
    meta: Record<string, unknown> = {},
  ): PlaybackSessionState {
    const nextSession = transitionPlaybackSessionPhase(session, event);
    if (nextSession.phase !== session.phase) {
      context.container.diagnosticsStore.record({
        category: "playback",
        operation: "playback.session.phase",
        message: `Playback session phase: ${nextSession.phase}`,
        context: {
          from: session.phase,
          to: nextSession.phase,
          event,
          ...meta,
        },
      });
    }
    return nextSession;
  }

  private async runAutoNextCountdown(
    context: PhaseContext,
    episode: EpisodeInfo,
  ): Promise<"continue" | "cancelled" | "skipped"> {
    const { stateManager, playerControl } = context.container;
    const episodeLabel = `S${String(episode.season).padStart(2, "0")}E${String(
      episode.episode,
    ).padStart(2, "0")}`;
    let cancelledByAction = false;

    return await runAutoplayAdvanceCountdown({
      seconds: 3,
      signal: context.signal,
      sleep: (ms) => Bun.sleep(ms),
      onTick: (remaining) => {
        this.updatePlaybackFeedback(context, {
          detail: "Auto-next ready",
          note: `Next ${episodeLabel} in ${remaining}s  ·  n now  ·  a pause`,
        });
      },
      isCancelled: () => {
        const state = stateManager.getState();
        return cancelledByAction || state.autoplaySessionPaused || state.stopAfterCurrent;
      },
      shouldSkip: () => {
        const action = playerControl.consumeLastAction();
        if (!action) return false;
        if (action === "next") return true;
        if (action === "stop" || action === "back-to-search" || action === "previous") {
          cancelledByAction = true;
        }
        return false;
      },
    });
  }

  private updatePresenceInBackground(
    context: PhaseContext,
    task: string,
    activity: Parameters<PhaseContext["container"]["presence"]["updatePlayback"]>[0],
    correlation?: DiagnosticCorrelation,
  ): void {
    runBackgroundTask({
      task,
      category: "presence",
      diagnosticsStore: context.container.diagnosticsStore,
      context: {
        ...correlation,
        titleId: activity.title.id,
        providerId: activity.providerId,
        season: activity.episode.season,
        episode: activity.episode.episode,
      },
      run: () => context.container.presence.updatePlayback(activity),
    });
  }

  /** Dispatches the error status to the UI and waits for the user to dismiss it. */
  private async showPlaybackError(context: PhaseContext, message: string): Promise<void> {
    const { stateManager } = context.container;
    stateManager.dispatch({
      type: "SET_PLAYBACK_STATUS",
      status: "error",
      error: message,
    });
    await new Promise<void>((resolve) => {
      const unsubscribe = stateManager.subscribe((state) => {
        if (state.playbackStatus !== "error") {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private showPlaybackProblem(context: PhaseContext, problem: PlaybackProblem): Promise<void> {
    const { diagnosticsStore, stateManager } = context.container;
    stateManager.dispatch({
      type: "SET_PLAYBACK_PROBLEM",
      problem,
    });
    diagnosticsStore.record({
      category: "playback",
      message: problem.userMessage,
      context: {
        stage: problem.stage,
        severity: problem.severity,
        cause: problem.cause,
        recommendedAction: problem.recommendedAction,
        secondaryActions: problem.secondaryActions,
      },
    });
    return this.showPlaybackError(context, problem.userMessage);
  }

  private describePlayerEvent(event: PlayerPlaybackEvent): {
    detail?: string | null;
    note?: string | null;
  } {
    switch (event.type) {
      case "launching-player":
        return { detail: "Launching player" };
      case "mpv-process-started":
        return { detail: "mpv launched" };
      case "ipc-connected":
        return { detail: "Player control connected" };
      case "ipc-command-failed":
        return {
          note: `Player command failed: ${event.command} (${event.error})`,
        };
      case "ipc-stalled":
        return {
          detail: "Player control stalled",
          note: `mpv did not answer ${event.command}; playback may still be alive`,
        };
      case "opening-stream":
        return { detail: "Opening provider stream" };
      case "resolving-playback":
        return { detail: "Resolving playback" };
      case "network-buffering": {
        const cacheAhead =
          typeof event.cacheAheadSeconds === "number"
            ? `${event.cacheAheadSeconds.toFixed(1)}s cached ahead`
            : null;
        const percent = typeof event.percent === "number" ? `${Math.round(event.percent)}%` : null;
        const status = [percent, cacheAhead].filter(Boolean).join(" / ") || "Filling demuxer cache";
        return {
          detail: "Building playback buffer",
          note: `${status}`,
        };
      }
      case "network-sample":
        return {};
      case "subtitle-inventory-ready":
        return {
          detail: "Attaching subtitles",
          note:
            event.trackCount > 0
              ? `${event.trackCount} alternate subtitle tracks are ready in mpv`
              : "Primary subtitle is ready",
        };
      case "subtitle-attached":
        return {
          note:
            event.trackCount > 0
              ? `${event.trackCount} subtitle tracks attached`
              : "Primary subtitle attached",
        };
      case "late-subtitles-attached":
        return {
          note: `${event.trackCount} late subtitle ${event.trackCount === 1 ? "track" : "tracks"} attached`,
        };
      case "player-ready":
        return { detail: "Player controls ready" };
      case "playback-started":
        return { detail: "Playing" };
      case "stream-stalled": {
        const dead = event.stallKind === "network-read-dead";
        return {
          detail: dead ? "Stream stalled (network read idle)" : "Stream stalled",
          note: `${dead ? "Demuxer underrun with no incoming bytes" : `No playback progress for ${event.secondsWithoutProgress}s`} · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      }
      case "seek-stalled":
        return {
          detail: "Seek stalled",
          note: `mpv has been seeking for ${event.secondsSeeking}s · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      case "player-closing":
        return { detail: "Closing player" };
      case "player-closed":
        return { detail: "Player closed" };
      case "segment-skipped":
        return {
          note: `${event.kind.charAt(0).toUpperCase()}${event.kind.slice(1)} ${event.automatic ? "skipped automatically" : "skipped"}`,
        };
      case "track-changed":
        return {
          note: `${event.trackType === "audio" ? "Audio" : "Subtitle"} track switched in mpv (id ${event.id})`,
        };
      case "mpv-in-process-reconnect": {
        const phaseLabel =
          event.phase === "started"
            ? "Reloading same stream in mpv"
            : event.phase === "complete"
              ? "Reload finished"
              : "Reload failed";
        return {
          detail: phaseLabel,
          note: event.detail
            ? `Attempt ${event.attempt} · ${event.detail}`
            : `Attempt ${event.attempt}`,
        };
      }
    }
    return {};
  }

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    PlaybackPhase.lateSubtitleInflight.clear();
    const {
      providerRegistry,
      engine,
      stateManager,
      logger,
      historyStore,
      config,
      cacheStore,
      diagnosticsStore,
      playerControl,
      player,
      workControl,
    } = container;
    const animeEpisodeCatalogByProvider = new Map<
      string,
      readonly EpisodePickerOption[] | undefined
    >();
    const playbackTimingByEpisode = new Map<string, PlaybackTimingMetadata | null>();
    let playbackSession: PlaybackSessionState = createPlaybackSessionState({
      autoNextEnabled: config.autoNext,
    });
    let preferredStreamSelection = emptyStreamSelectionIntent();
    let sessionSoftProviderId: string | null = null;
    const sourceRefreshCooldown = createSourceRefreshCooldownState();
    let pendingSourceRefreshAction: SourceRefreshAction | null = null;

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;
      let pendingStart = startFromBeginning();
      const startNavigationToEpisode = async (target: EpisodeInfo) =>
        startEpisodeNavigation({
          targetResumeSeconds: await resumeSecondsFromHistoryForEpisode(
            historyStore,
            title.id,
            target,
            config.quitNearEndThresholdMode,
          ),
        });
      const provider = providerRegistry.get(stateManager.getState().provider);
      const initialAnimeEpisodes = await this.getAnimeEpisodeOptions({
        title,
        mode: stateManager.getState().mode,
        provider,
        cache: animeEpisodeCatalogByProvider,
      });
      logger.info("Episode selection metadata", {
        titleId: title.id,
        mode: stateManager.getState().mode,
        provider: stateManager.getState().provider,
        episodeCount: title.episodeCount ?? null,
        animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
      });
      diagnosticsStore.record({
        category: "provider",
        message: "Episode selection metadata",
        context: {
          titleId: title.id,
          mode: stateManager.getState().mode,
          provider: stateManager.getState().provider,
          episodeCount: title.episodeCount ?? null,
          animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
        },
      });

      if (title.type === "series") {
        // Check history for resume
        const history = await historyStore.get(title.id);
        if (history) {
          logger.info("History found", {
            season: history.season,
            episode: history.episode,
            timestamp: history.timestamp,
          });
        }

        // Session-flow owns the current season/episode selection rules until the
        // mounted root shell fully absorbs the picker stack.
        const { chooseStartingEpisode } = await import("@/session-flow");
        const selection = await chooseStartingEpisode({
          currentId: title.id,
          isAnime: stateManager.getState().mode === "anime",
          animeEpisodeCount: title.episodeCount,
          animeEpisodes: initialAnimeEpisodes,
          flags: {},
          getHistoryEntry: () => Promise.resolve(history),
          container,
        });

        if (!selection) {
          logger.info("Episode selection cancelled before playback", {
            titleId: title.id,
            mode: stateManager.getState().mode,
          });
          return { status: "success", value: "back_to_results" };
        }

        episode = episodeInfoFromSelection({
          season: selection.season,
          episode: selection.episode,
          isAnime: stateManager.getState().mode === "anime",
          titleId: title.id,
          animeEpisodes: initialAnimeEpisodes,
        });
        pendingStart =
          selection.startAt !== undefined || selection.suppressResumePrompt
            ? startFromEpisodeSelection(selection)
            : await startNavigationToEpisode(episode);
      } else {
        episode = { season: 1, episode: 1 };
      }

      stateManager.dispatch({ type: "SELECT_EPISODE", episode });
      playbackSession = this.transitionPlaybackSession(
        context,
        playbackSession,
        "episode-selected",
        {
          titleId: title.id,
          season: episode.season,
          episode: episode.episode,
        },
      );

      const episodePrefetch = new EpisodePrefetchHandle();

      // In-memory cache of recently played episode streams so backward navigation
      // (P key) reuses the exact same StreamInfo without provider resolve or cache lookup.
      const recentEpisodeStreams = new Map<string, import("@/domain/types").StreamInfo>();

      // Inner playback loop
      while (true) {
        const currentEpisode = stateManager.getState().currentEpisode;
        if (!currentEpisode) break;
        playbackSession = this.transitionPlaybackSession(
          context,
          playbackSession,
          "resolve-started",
          {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            provider: stateManager.getState().provider,
          },
        );

        const resolveController = new AbortController();
        let resolveAbortIntent: "cancel" | "fallback" | null = null;
        const abortOnSessionStop = () => resolveController.abort();
        context.signal.addEventListener("abort", abortOnSessionStop, { once: true });
        resolveController.signal.addEventListener(
          "abort",
          () => {
            if (!context.signal.aborted) {
              this.updatePlaybackFeedback(context, {
                detail:
                  resolveAbortIntent === "fallback" ? "Skipping current provider…" : "Cancelling…",
                note:
                  resolveAbortIntent === "fallback"
                    ? "Trying the next compatible provider"
                    : "Returning to results",
              });
            }
          },
          { once: true },
        );
        workControl.setActive({
          id: `playback-resolve:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
          label: `${title.name} S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`,
          cancel: (reason) => {
            resolveAbortIntent = reason?.includes("fallback") ? "fallback" : "cancel";
            resolveController.abort();
          },
        });

        try {
          const currentProvider = providerRegistry.get(
            sessionSoftProviderId ?? stateManager.getState().provider,
          );

          // Kick off timing fetch in parallel with everything else — IntroDB is a
          // lightweight API call and should resolve well before stream resolution.
          const timingFetch = this.getPlaybackTimingMetadata(
            title,
            currentEpisode,
            playbackTimingByEpisode,
            resolveController.signal,
            stateManager.getState().mode === "anime",
            currentProvider?.metadata.id,
          );

          const watchedEntries = await historyStore.listByTitle(title.id);
          const currentAnimeEpisodes = await this.getAnimeEpisodeOptions({
            title,
            mode: stateManager.getState().mode,
            provider: currentProvider,
            cache: animeEpisodeCatalogByProvider,
            signal: resolveController.signal,
          });
          const shellEpisodePicker = await buildPlaybackEpisodePickerOptions({
            title,
            currentEpisode,
            isAnime: stateManager.getState().mode === "anime",
            animeEpisodeCount: title.episodeCount,
            animeEpisodes: currentAnimeEpisodes,
            watchedEntries,
          });
          const episodeAvailability = await resolveEpisodeAvailability({
            title,
            currentEpisode,
            isAnime: stateManager.getState().mode === "anime",
            animeEpisodeCount: title.episodeCount,
            animeEpisodes: currentAnimeEpisodes,
            loaders: {
              loadSeasons: fetchSeasons,
              loadEpisodes: fetchEpisodes,
            },
          });

          const navigationState = toEpisodeNavigationState(title.type, episodeAvailability, {
            isAnime: stateManager.getState().mode === "anime",
          });
          stateManager.dispatch({
            type: "SET_EPISODE_NAVIGATION",
            navigation: navigationState,
          });
          playerControl.setEpisodeNavigationAvailability(navigationState);

          if (episodeAvailability.tmdbUnavailable) {
            diagnosticsStore.record({
              category: "provider",
              message: "TMDB metadata unavailable — episode navigation disabled",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
          }

          // Resolve stream with loading UI
          if (!currentProvider) {
            return {
              status: "error",
              error: {
                code: "PROVIDER_UNAVAILABLE",
                message: `Provider ${stateManager.getState().provider} not found`,
                retryable: false,
              },
            };
          }

          stateManager.dispatch({
            type: "SET_PLAYBACK_STATUS",
            status: "loading",
          });
          stateManager.dispatch({ type: "SET_RESOLVE_RETRY_COUNT", count: 0 });
          this.updatePlaybackFeedback(context, {
            detail: "Resolving provider stream",
            note: "Esc cancels this resolve and returns to results",
          });

          const providerAttemptId = createCorrelationId("provider");
          const playbackCorrelation: DiagnosticCorrelation = {
            sessionId: container.sessionId,
            playbackCycleId: createCorrelationId("playback"),
            providerAttemptId,
            traceId: providerAttemptId,
          };
          const sourceRefreshAction = pendingSourceRefreshAction;
          pendingSourceRefreshAction = null;
          const sourceRefreshDecision = sourceRefreshAction
            ? resolveSourceRefreshDecision(sourceRefreshCooldown, {
                action: sourceRefreshAction,
                scope: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  providerId: currentProvider.metadata.id,
                  sourceId: preferredStreamSelection.sourceId,
                  streamId: preferredStreamSelection.streamId,
                },
                now: new Date(),
                cooldownMs: 30_000,
              })
            : null;

          if (sourceRefreshDecision?.kind === "cooldown") {
            this.updatePlaybackFeedback(context, {
              detail: sourceRefreshDecision.message,
              note: "The current stream can be reused without another provider lookup.",
            });
            diagnosticsStore.record({
              ...playbackCorrelation,
              category: "playback",
              operation: "playback.refresh.cooldown",
              message: sourceRefreshDecision.message,
              providerId: currentProvider.metadata.id,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              context: { remainingMs: sourceRefreshDecision.remainingMs },
            });
          } else if (sourceRefreshDecision) {
            diagnosticsStore.record({
              ...playbackCorrelation,
              category: "playback",
              operation:
                sourceRefreshDecision.kind === "recover"
                  ? "playback.recover.requested"
                  : "playback.refresh.requested",
              message:
                sourceRefreshDecision.kind === "recover"
                  ? "Recovering current provider source"
                  : "Refreshing current provider source",
              providerId: currentProvider.metadata.id,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            });
          }

          // Use a prefetched bundle (resolve + optional subtitle prep during near-EOF)
          // or fall back to a full provider resolve. Explicit refresh/recover bypasses
          // prefetch so it can ask the provider for a fresh source.
          const buildPrefetchTarget = (
            nextEpisodeIntent: EpisodeInfo,
            providerId: string,
          ): EpisodePrefetchTarget => ({
            titleId: title.id,
            episode: nextEpisodeIntent,
            providerId,
            sourceId: preferredStreamSelection.sourceId ?? undefined,
            streamId: preferredStreamSelection.streamId ?? undefined,
            audioPreference:
              stateManager.getState().mode === "anime"
                ? config.animeLanguageProfile.audio
                : config.seriesLanguageProfile.audio,
            qualityPreference:
              stateManager.getState().mode === "anime"
                ? config.animeLanguageProfile.quality
                : config.seriesLanguageProfile.quality,
            subtitlePreference:
              stateManager.getState().mode === "anime"
                ? config.animeLanguageProfile.subtitle
                : config.seriesLanguageProfile.subtitle,
          });
          const consumedBundle = sourceRefreshDecision
            ? null
            : episodePrefetch.takeReadyFor(
                buildPrefetchTarget(currentEpisode, currentProvider.metadata.id),
              );
          const prefetchWasPrepared = consumedBundle?.prepared === true;

          let stream: StreamInfo | null = consumedBundle?.stream ?? null;
          let resolvedProviderId = currentProvider.metadata.id;
          let resolveAttempts: readonly ResolveAttempt<StreamInfo>[] = [];

          const resolveTrace = createResolveTraceStub({
            title,
            episode: currentEpisode,
            providerId: currentProvider.metadata.id,
            mode: stateManager.getState().mode,
          });
          diagnosticsStore.record({
            ...playbackCorrelation,
            category: "provider",
            message: "Resolve trace started",
            context: { trace: resolveTrace },
          });

          if (consumedBundle) {
            logger.info("Using prefetched stream for episode", {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              prepared: prefetchWasPrepared,
            });
            diagnosticsStore.record({
              ...playbackCorrelation,
              category: "provider",
              message: prefetchWasPrepared
                ? "Using prefetched prepared stream"
                : "Using prefetched stream",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                prepared: prefetchWasPrepared,
              },
            });
          }

          // Check in-memory cache for recently played episodes (backward navigation).
          // This lets P-navigation reuse the exact same StreamInfo without any
          // provider resolve, cache lookup, or health check.
          if (!stream && !sourceRefreshDecision) {
            const recentKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
            const recent = recentEpisodeStreams.get(recentKey);
            if (recent) {
              stream = recent;
              resolvedProviderId = currentProvider.metadata.id;
              diagnosticsStore.record({
                ...playbackCorrelation,
                category: "provider",
                message: "Using in-memory recent episode stream (backward navigation)",
                context: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
            }
          }

          if (!stream) {
            if (sourceRefreshDecision?.kind === "recover") {
              const refreshCacheKey = buildApiStreamResolveCacheKey({
                providerId: currentProvider.metadata.id,
                title,
                episode: currentEpisode,
                mode: stateManager.getState().mode,
                audioPreference:
                  stateManager.getState().mode === "anime"
                    ? config.animeLanguageProfile.audio
                    : title.type === "movie"
                      ? config.movieLanguageProfile.audio
                      : config.seriesLanguageProfile.audio,
                subtitlePreference:
                  stateManager.getState().mode === "anime"
                    ? config.animeLanguageProfile.subtitle
                    : title.type === "movie"
                      ? config.movieLanguageProfile.subtitle
                      : config.seriesLanguageProfile.subtitle,
                qualityPreference:
                  stateManager.getState().mode === "anime"
                    ? config.animeLanguageProfile.quality
                    : title.type === "movie"
                      ? config.movieLanguageProfile.quality
                      : config.seriesLanguageProfile.quality,
              });
              try {
                await cacheStore.delete(refreshCacheKey);
              } catch {
                // best-effort; a failed cache delete should not block recovery
              }
            }
            const playbackResolver = new PlaybackResolveCoordinator({
              engine,
              cacheStore,
              providerHealth: container.providerHealth,
              sourceInventory: container.sourceInventory,
              titleProviderHealth: container.titleProviderHealth,
              diagnostics: container.diagnosticsService,
            });
            const resolveResult = await playbackResolver.resolve({
              title,
              episode: currentEpisode,
              mode: stateManager.getState().mode,
              providerId: currentProvider.metadata.id,
              audioPreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.audio
                  : title.type === "movie"
                    ? config.movieLanguageProfile.audio
                    : config.seriesLanguageProfile.audio,
              subtitlePreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.subtitle
                  : title.type === "movie"
                    ? config.movieLanguageProfile.subtitle
                    : config.seriesLanguageProfile.subtitle,
              qualityPreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.quality
                  : title.type === "movie"
                    ? config.movieLanguageProfile.quality
                    : config.seriesLanguageProfile.quality,
              recoveryMode: config.recoveryMode,
              preferFreshStream: sourceRefreshDecision?.kind === "refresh",
              preserveCachedStreamOnFreshFailure: sourceRefreshDecision?.kind === "refresh",
              signal: resolveController.signal,
              correlation: playbackCorrelation,
              onFeedback: (feedback) => this.updatePlaybackFeedback(context, feedback),
              onEvent: (event) => {
                if (event.type === "cache-hit" || event.type === "cache-miss") {
                  const hit = event.type === "cache-hit";
                  if (hit) {
                    logger.info("Provider resolve cache hit", {
                      provider: event.providerId,
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                    });
                  }
                  diagnosticsStore.record({
                    ...playbackCorrelation,
                    category: "cache",
                    message: hit ? "Provider resolve cache hit" : "Provider resolve cache miss",
                    context: {
                      provider: event.providerId,
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                    },
                  });
                  return;
                }

                if (event.type === "fresh-source-failed-using-cache") {
                  this.updatePlaybackFeedback(context, {
                    detail: "No fresher source found. Continuing current stream.",
                    note: "The cached stream stayed available, so playback can resume.",
                  });
                  return;
                }

                if (event.type === "cache-health-check") {
                  diagnosticsStore.record({
                    ...playbackCorrelation,
                    category: "cache",
                    message: event.healthy
                      ? "Cached stream health check passed"
                      : "Cached stream health check failed",
                    context: {
                      provider: event.providerId,
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                      strategy: event.strategy,
                      ageMs: event.ageMs,
                    },
                  });
                  return;
                }

                if (event.type === "attempt") {
                  stateManager.dispatch({
                    type: "SET_RESOLVE_RETRY_COUNT",
                    count: Math.max(0, event.attempt - 1),
                  });
                  this.updatePlaybackFeedback(context, {
                    detail: describeProviderResolveAttemptDetail(event),
                    note: describeProviderResolveAttemptNote(event),
                  });
                  return;
                }

                if (event.type === "failure") {
                  this.updatePlaybackFeedback(context, {
                    detail: event.retryable
                      ? `Recoverable provider issue (${event.attempt}/${event.maxAttempts})`
                      : "Provider returned a non-recoverable issue",
                    note: event.issue,
                  });
                } else if (event.type === "cache-stale") {
                  this.updatePlaybackFeedback(context, {
                    detail: "Cached stream expired, refetching…",
                    note: null,
                  });
                }
              },
            });

            stream = resolveResult.stream;
            resolvedProviderId = resolveResult.providerId;
            resolveAttempts = resolveResult.attempts;

            for (const [attemptIndex, attempt] of resolveAttempts.entries()) {
              diagnosticsStore.record({
                ...playbackCorrelation,
                category: "provider",
                message: attempt.stream
                  ? "Provider resolve attempt succeeded"
                  : "Provider resolve attempt failed",
                context: {
                  stage: "provider-resolve",
                  attempt: attemptIndex + 1,
                  provider: attempt.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  hasTrace: Boolean(attempt.result?.trace),
                  failure: attempt.failure ?? null,
                },
              });
            }

            if (resolvedProviderId !== currentProvider.metadata.id) {
              logger.info("Resolved stream with fallback provider", {
                from: currentProvider.metadata.id,
                fallback: resolvedProviderId,
              });
              sessionSoftProviderId = resolvedProviderId;
            }

            if (stream?.providerResolveResult) {
              diagnosticsStore.record({
                ...playbackCorrelation,
                category: "provider",
                message: "Provider resolve trace completed",
                context: {
                  trace: stream.providerResolveResult.trace,
                  streamCandidates: stream.providerResolveResult.streams.length,
                  subtitleCandidates: stream.providerResolveResult.subtitles.length,
                  cachePolicy: stream.providerResolveResult.cachePolicy,
                },
              });
            }
          }

          // TypeScript cannot narrow `stream` across the conditional mutation above.
          if (!stream) {
            workControl.setActive(null);
            if (resolveController.signal.aborted && !context.signal.aborted) {
              if (resolveAbortIntent === "fallback") {
                const fallback = providerRegistry
                  .getCompatible(title, stateManager.getState().mode)
                  .find((candidate) => candidate.metadata.id !== currentProvider.metadata.id);
                if (fallback) {
                  sessionSoftProviderId = null;
                  stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
                  this.updatePlaybackFeedback(context, {
                    detail: `Trying ${fallback.metadata.name ?? fallback.metadata.id}…`,
                    note: "Fallback provider selected for the rest of this session",
                  });
                  diagnosticsStore.record({
                    category: "provider",
                    message: "Skipping current provider during playback bootstrap",
                    context: {
                      from: currentProvider.metadata.id,
                      fallback: fallback.metadata.id,
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                    },
                  });
                  continue;
                }
              }
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              stateManager.dispatch({ type: "SET_STREAM", stream: null });
              this.updatePlaybackFeedback(context, { detail: null, note: null });
              return { status: "success", value: "back_to_results" };
            }
            const problem = buildProviderResolveProblem({
              attempts: resolveAttempts,
              capabilitySnapshot: container.capabilitySnapshot,
            });
            playbackSession = this.transitionPlaybackSession(
              context,
              playbackSession,
              "failure-shown",
              {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                cause: problem.cause,
              },
            );
            await this.showPlaybackProblem(context, problem);
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
            return { status: "success", value: "back_to_results" };
          }

          stream = applyPreferredStreamSelection(stream, preferredStreamSelection);

          // Await timing — stream resolve takes much longer so this is nearly free.
          // If IntroDB timed out and returned null, schedule a background retry that
          // injects timing into the running player once it arrives.
          const playbackTiming = await timingFetch;
          // effectiveTiming.current tracks the best timing we have — updated in-place
          // if the background retry resolves while the episode is playing, so all
          // post-playback decisions (history, autoNext, result classification) use it.
          const effectiveTiming = { current: playbackTiming };
          if (!playbackTiming) {
            runBackgroundTask({
              task: "playback.retryTiming",
              category: "playback",
              diagnosticsStore: container.diagnosticsStore,
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                providerId: container.stateManager.getState().provider,
              },
              run: () =>
                this.retryTimingInBackground(
                  title,
                  currentEpisode,
                  container,
                  effectiveTiming,
                  playbackTimingByEpisode,
                  stateManager.getState().mode === "anime",
                ),
            });
          }

          const preparedStream = prefetchWasPrepared
            ? stream
            : await this.preparePlaybackStream(stream, title, currentEpisode, context);
          stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });

          const episodeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
          recentEpisodeStreams.set(episodeKey, preparedStream);
          if (recentEpisodeStreams.size > 5) {
            const first = recentEpisodeStreams.keys().next().value;
            if (first !== undefined) recentEpisodeStreams.delete(first);
          }
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
            "stream-ready",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
            },
          );

          // Play in MPV — consume the pending resume position on the first play only.
          // Pass loading handle so playStream can update it in-place (no shell flicker).
          const startIntent = pendingStart;
          pendingStart = startFromBeginning();

          let prefetchedRecommendationItems: readonly SearchResult[] | null = null;
          let nextPrefetchProgress: EpisodePrefetchProgress = {};
          const buildNextPrefetchTarget = (): EpisodePrefetchTarget | null => {
            const nextEp = episodeAvailability.nextEpisode;
            if (!nextEp) return null;
            const prefetchMetadata = providerRegistry.get(
              sessionSoftProviderId ?? stateManager.getState().provider,
            );
            if (!prefetchMetadata) return null;
            return buildPrefetchTarget(nextEp, prefetchMetadata.metadata.id);
          };
          const handoffNextEpisodePrefetch = async (
            target: EpisodePrefetchTarget,
            operation: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
          ) => {
            await adoptEpisodePrefetchBundle({
              handle: episodePrefetch,
              target,
              run: (signal) => runNextEpisodePrefetch(signal, target),
              getProgress: () => nextPrefetchProgress,
              onWaiting: () =>
                this.updatePlaybackFeedback(context, {
                  detail: "Preparing next episode",
                  note: "Still preparing a source in the background",
                }),
              recordWait: (wait) => {
                diagnosticsStore.record({
                  category: "playback",
                  operation,
                  message: wait.bundle
                    ? "Prefetch completed during episode handoff wait"
                    : "Prefetch grace window elapsed during episode handoff",
                  context: {
                    titleId: title.id,
                    nextSeason: target.episode.season,
                    nextEpisode: target.episode.episode,
                    completed: wait.bundle !== null,
                    waitResult: wait.outcome,
                    waitedMs: wait.waitedMs,
                    prepared: wait.bundle?.prepared ?? false,
                  },
                });
              },
            });
          };
          const runNextEpisodePrefetch = (signal: AbortSignal, target: EpisodePrefetchTarget) => {
            const nextEp = target.episode;
            const prefetchMetadata = providerRegistry.get(target.providerId);
            if (!prefetchMetadata) {
              return Promise.resolve(null);
            }
            return this.resolveEpisodePrefetchBundle(context, {
              title,
              nextEpisode: nextEp,
              providerId: prefetchMetadata.metadata.id,
              target,
              onProgress: (progress) => {
                nextPrefetchProgress = { ...nextPrefetchProgress, ...progress };
              },
              signal,
            })
              .then((bundle) => {
                if (bundle) {
                  diagnosticsStore.record({
                    category: "playback",
                    message: "Prefetch resolved successfully",
                    context: {
                      titleId: title.id,
                      nextSeason: nextEp.season,
                      nextEpisode: nextEp.episode,
                      providerId: prefetchMetadata.metadata.id,
                      prepared: bundle.prepared,
                    },
                  });
                }
                return bundle;
              })
              .catch((err) => {
                diagnosticsStore.record({
                  category: "playback",
                  level: "warn",
                  message: "Prefetch resolve failed",
                  context: {
                    titleId: title.id,
                    nextSeason: nextEp.season,
                    nextEpisode: nextEp.episode,
                    providerId: prefetchMetadata.metadata.id,
                    error: err instanceof Error ? err.message : String(err),
                  },
                });
                return null;
              });
          };
          const maybePrefetchNext = () => {
            if (container.config.powerSaverMode) {
              return;
            }
            if (
              !isEpisodePrefetchEligible({
                titleType: title.type,
                hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
                stopAfterCurrent: playbackSession.stopAfterCurrent,
                sessionMode: playbackSession.mode,
                autoplayPaused: playbackSession.autoplayPaused,
              })
            ) {
              return;
            }
            const target = buildNextPrefetchTarget();
            if (!target) return;
            nextPrefetchProgress = {};
            episodePrefetch.schedule(target, (signal) => runNextEpisodePrefetch(signal, target));

            if (
              container.config.recommendationRailEnabled &&
              prefetchedRecommendationItems === null
            ) {
              container.backgroundWorkScheduler.enqueue({
                id: `recommendation-prefetch:${title.type}:${title.id}`,
                lane: "recommendation-warm",
                signal: context.signal,
                run: async () => {
                  const section = await container.recommendationService.getForTitle(
                    title.id,
                    title.type,
                  );
                  prefetchedRecommendationItems = section.items.filter(
                    (item) => item.title.trim().length > 0,
                  );
                },
              });
              void container.backgroundWorkScheduler.drain();
            }
          };

          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
            "playback-started",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
            },
          );

          const result = await this.playStream(
            preparedStream,
            title,
            currentEpisode,
            context,
            startIntent.startAt,
            startIntent.resumePromptAt,
            playbackSession.mode,
            playbackTiming,
            maybePrefetchNext,
            startIntent.suppressResumePrompt,
            playbackCorrelation,
          );
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
            "playback-ended",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
              endReason: result.endReason,
              suspectedDeadStream: result.suspectedDeadStream === true,
            },
          );

          // Save history — use effectiveTiming.current so that a background retry
          // that completed during playback is reflected in completion status.
          const quitThresholdMode = config.quitNearEndThresholdMode;
          if (shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode)) {
            const historyTimestamp = toHistoryTimestamp(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const didComplete = didPlaybackReachCompletionThreshold(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const savedHistoryEntry: HistoryEntry = {
              title: title.name,
              type: title.type,
              mediaKind: stateManager.getState().mode === "anime" ? "anime" : title.type,
              externalIds: title.externalIds,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              timestamp: historyTimestamp,
              duration: result.duration,
              completed: didComplete,
              provider: resolvedProviderId,
              watchedAt: new Date().toISOString(),
            };
            await historyStore.save(title.id, savedHistoryEntry);
            enqueueReleaseReconciliation(
              container,
              [[title.id, savedHistoryEntry]],
              "post-playback",
              context.signal,
            );
            const providerSuggestion = container.titleProviderHealth.getSwitchSuggestion(
              title.id,
              currentProvider.metadata.id,
            );
            if (providerSuggestion) {
              this.updatePlaybackFeedback(context, {
                note: `${providerSuggestion.providerId} struggled with this title. ${providerSuggestion.suggestedProviderId} worked; choose it from providers for this title.`,
              });
              diagnosticsStore.record({
                category: "provider",
                operation: "provider.title-health.suggestion",
                message: "Title-scoped provider switch suggestion available at episode boundary",
                context: {
                  titleId: title.id,
                  providerId: providerSuggestion.providerId,
                  suggestedProviderId: providerSuggestion.suggestedProviderId,
                },
              });
            }
            if (didComplete) {
              const epStr =
                title.type === "series"
                  ? ` S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`
                  : "";
              this.updatePlaybackFeedback(context, {
                note: `✓ ${title.name}${epStr} · episode complete`,
              });
            }
          } else {
            diagnosticsStore.record({
              category: "playback",
              message: "Skipped history save",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                watchedSeconds: result.watchedSeconds,
                duration: result.duration,
                endReason: result.endReason,
              },
            });
          }

          // One-time sync nudge: show on first episode completion if no sync is connected.
          if (
            shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode) &&
            !config.syncNudgeDismissedAt &&
            container.syncService.getConnectedAdapters().length === 0
          ) {
            this.updatePlaybackFeedback(context, {
              note: "Connect AniList or TMDB to sync progress. /sync to set up  ·  [d] dismiss",
            });
          }

          const shouldInvalidateStreamCache =
            result.endReason === "error" || result.suspectedDeadStream === true;
          if (shouldInvalidateStreamCache) {
            const invalidateProviderId = consumedBundle
              ? (consumedBundle.target.providerId ?? resolvedProviderId)
              : resolvedProviderId;
            const staleCacheKey = buildApiStreamResolveCacheKey({
              providerId: invalidateProviderId,
              title,
              episode: currentEpisode,
              mode: stateManager.getState().mode,
              audioPreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.audio
                  : title.type === "movie"
                    ? config.movieLanguageProfile.audio
                    : config.seriesLanguageProfile.audio,
              subtitlePreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.subtitle
                  : title.type === "movie"
                    ? config.movieLanguageProfile.subtitle
                    : config.seriesLanguageProfile.subtitle,
              qualityPreference:
                stateManager.getState().mode === "anime"
                  ? config.animeLanguageProfile.quality
                  : title.type === "movie"
                    ? config.movieLanguageProfile.quality
                    : config.seriesLanguageProfile.quality,
            });
            try {
              await cacheStore.delete(staleCacheKey);
            } catch {
              // best-effort
            }
            const recentKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
            recentEpisodeStreams.delete(recentKey);
            if (result.suspectedDeadStream === true) {
              container.titleProviderHealth.recordFailure(
                title.id,
                invalidateProviderId,
                undefined,
                "dead-stream",
              );
            }
            diagnosticsStore.record({
              category: "playback",
              message: result.suspectedDeadStream
                ? "Stream ended early — cached URL invalidated for next resolve"
                : "Stream died — cache entry invalidated for next resolve",
              context: {
                provider: invalidateProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                exitCode: result.playerExitCode,
                exitSignal: result.playerExitSignal,
                suspectedDeadStream: result.suspectedDeadStream === true,
                wasPrefetched: Boolean(consumedBundle),
              },
            });
          }

          const playbackControlAction = playerControl.consumeLastAction();
          const confirmedStreamSelection =
            playbackControlAction === "pick-source" ||
            playbackControlAction === "pick-stream" ||
            playbackControlAction === "pick-quality"
              ? playerControl.consumePendingStreamSelection()
              : null;
          const confirmedEpisodeSelection =
            playbackControlAction === "pick-episode"
              ? playerControl.consumePendingEpisodeSelection()
              : null;
          playbackSession = syncPlaybackSessionState(playbackSession, {
            autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
            stopAfterCurrent: stateManager.getState().stopAfterCurrent,
          });
          const playbackDecision = resolvePlaybackResultDecision({
            result,
            controlAction: playbackControlAction,
            session: playbackSession,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          });
          playbackSession = playbackDecision.session;
          if (playbackDecision.shouldTreatAsInterrupted) {
            stateManager.dispatch({
              type: "SET_SESSION_AUTOPLAY_PAUSED",
              paused: playbackDecision.session.autoplayPaused,
            });
          }
          if (playbackDecision.shouldRefreshSource) {
            pendingStart = startAtResumePoint(
              toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
              { suppressResumePrompt: true },
            );
            pendingSourceRefreshAction =
              result.suspectedDeadStream === true || playbackControlAction === "recover"
                ? "recover"
                : "refresh";
            diagnosticsStore.record({
              category: "playback",
              message:
                pendingSourceRefreshAction === "recover"
                  ? "Recovery requested for current provider source"
                  : "Refresh requested for current provider source",
              context: {
                provider: resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                resumeSeconds: pendingStart.startAt,
                action: pendingSourceRefreshAction,
              },
            });
            playbackSession = this.transitionPlaybackSession(
              context,
              playbackSession,
              "recovery-started",
              {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                provider: resolvedProviderId,
                action: pendingSourceRefreshAction,
              },
            );
            continue;
          }

          if (playbackDecision.shouldFallbackProvider) {
            pendingStart = startEpisodeNavigation({
              targetResumeSeconds: toHistoryTimestamp(
                result,
                effectiveTiming.current,
                quitThresholdMode,
              ),
            });
            const fallback = providerRegistry
              .getCompatible(title, stateManager.getState().mode)
              .find((candidate) => candidate.metadata.id !== resolvedProviderId);

            if (fallback) {
              sessionSoftProviderId = null;
              stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
              diagnosticsStore.record({
                category: "playback",
                message: "Switching to fallback provider after playback control request",
                context: {
                  from: resolvedProviderId,
                  fallback: fallback.metadata.id,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.resumePromptAt,
                },
              });
              continue;
            }

            diagnosticsStore.record({
              category: "playback",
              message:
                "Fallback playback control requested but no compatible provider was available",
              context: {
                provider: resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
            // Keep the pending start intent for this episode; re-resolve instead of falling
            // through to auto-advance / post-playback with a poisoned resume offset.
            continue;
          }

          if (playbackControlAction === "back-to-search") {
            return { status: "success", value: "back_to_search" };
          }

          if (playbackControlAction === "next" && title.type === "series") {
            if (episodeAvailability.nextEpisode) {
              await applyMpvEpisodeLoadingOverlay(
                playerControl.getActive(),
                episodeAvailability.nextEpisode,
              );
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: episodeAvailability.nextEpisode,
              });
              pendingStart = await startNavigationToEpisode(episodeAvailability.nextEpisode);
              stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
              // Explicit navigation resumes autoplay if it was only interrupted (not user-paused).
              if (playbackSession.autoplayPauseReason === "interrupted") {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
                playbackSession = {
                  ...playbackSession,
                  stopAfterCurrent: false,
                  autoplayPaused: false,
                  autoplayPauseReason: null,
                };
              } else {
                playbackSession = { ...playbackSession, stopAfterCurrent: false };
              }

              const prefetchTarget = buildNextPrefetchTarget();
              if (prefetchTarget) {
                await handoffNextEpisodePrefetch(prefetchTarget, "playback.prefetch-wait");
              }
              continue;
            }
          }

          if (playbackControlAction === "previous" && title.type === "series") {
            if (episodeAvailability.previousEpisode) {
              episodePrefetch.cancel("user-navigation");
              pendingStart = await startNavigationToEpisode(episodeAvailability.previousEpisode);
              await applyMpvEpisodeLoadingOverlay(
                playerControl.getActive(),
                episodeAvailability.previousEpisode,
              );
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: episodeAvailability.previousEpisode,
              });
              stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
              if (playbackSession.autoplayPauseReason === "interrupted") {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
                playbackSession = {
                  ...playbackSession,
                  stopAfterCurrent: false,
                  autoplayPaused: false,
                  autoplayPauseReason: null,
                };
              } else {
                playbackSession = { ...playbackSession, stopAfterCurrent: false };
              }
              continue;
            }
          }

          if (playbackControlAction === "pick-episode" && confirmedEpisodeSelection) {
            episodePrefetch.cancel("user-navigation");
            pendingStart = await startNavigationToEpisode(confirmedEpisodeSelection);
            await applyMpvEpisodeLoadingOverlay(
              playerControl.getActive(),
              confirmedEpisodeSelection,
            );
            stateManager.dispatch({
              type: "SELECT_EPISODE",
              episode: confirmedEpisodeSelection,
            });
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            if (playbackSession.autoplayPauseReason === "interrupted") {
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
              playbackSession = {
                ...playbackSession,
                stopAfterCurrent: false,
                autoplayPaused: false,
                autoplayPauseReason: null,
              };
            } else {
              playbackSession = { ...playbackSession, stopAfterCurrent: false };
            }
            continue;
          }

          if (playbackControlAction === "pick-source") {
            if (confirmedStreamSelection) {
              preferredStreamSelection = confirmedStreamSelection;
              pendingStart = startEpisodeNavigation({
                targetResumeSeconds: toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
              });
              diagnosticsStore.record({
                category: "playback",
                message: "Source override selected",
                context: {
                  sourceId: confirmedStreamSelection.sourceId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.resumePromptAt,
                },
              });
              continue;
            }
            const picked = await openTracksPanel(
              preparedStream,
              { initialSection: "source" },
              container,
            );
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              preferredStreamSelection = selection;
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              pendingStart =
                picked.section === "source"
                  ? startEpisodeNavigation({ targetResumeSeconds: restartResume })
                  : startAtResumePoint(restartResume, { suppressResumePrompt: true });
              diagnosticsStore.record({
                category: "playback",
                message: "Track override selected",
                context: {
                  section: picked.section,
                  sourceId: selection.sourceId ?? undefined,
                  streamId: selection.streamId ?? undefined,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
              continue;
            }
          }

          if (playbackControlAction === "pick-stream") {
            if (confirmedStreamSelection) {
              preferredStreamSelection = confirmedStreamSelection;
              pendingStart = startEpisodeNavigation({
                targetResumeSeconds: toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
              });
              diagnosticsStore.record({
                category: "playback",
                message: "Stream override selected",
                context: {
                  streamId: confirmedStreamSelection.streamId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.resumePromptAt,
                },
              });
              continue;
            }
            const picked = await openTracksPanel(preparedStream, {}, container);
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              preferredStreamSelection = selection;
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              pendingStart =
                picked.section === "source"
                  ? startEpisodeNavigation({ targetResumeSeconds: restartResume })
                  : startAtResumePoint(restartResume, { suppressResumePrompt: true });
              diagnosticsStore.record({
                category: "playback",
                message: "Track override selected",
                context: {
                  section: picked.section,
                  sourceId: selection.sourceId ?? undefined,
                  streamId: selection.streamId ?? undefined,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
              continue;
            }
          }

          if (playbackControlAction === "pick-quality") {
            if (confirmedStreamSelection) {
              preferredStreamSelection = confirmedStreamSelection;
              pendingStart = startAtResumePoint(
                toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
                { suppressResumePrompt: true },
              );
              diagnosticsStore.record({
                category: "playback",
                message: "Quality override selected",
                context: {
                  streamId: confirmedStreamSelection.streamId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.startAt,
                },
              });
              continue;
            }
            const picked = await openTracksPanel(
              preparedStream,
              { initialSection: "quality" },
              container,
            );
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              preferredStreamSelection = selection;
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              pendingStart =
                picked.section === "source"
                  ? startEpisodeNavigation({ targetResumeSeconds: restartResume })
                  : startAtResumePoint(restartResume, { suppressResumePrompt: true });
              diagnosticsStore.record({
                category: "playback",
                message: "Track override selected",
                context: {
                  section: picked.section,
                  sourceId: selection.sourceId ?? undefined,
                  streamId: selection.streamId ?? undefined,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
              continue;
            }
          }

          // Handle post-playback
          diagnosticsStore.record({
            category: "playback",
            message: "Evaluating autoplay advance",
            context: {
              endReason: result.endReason,
              watchedSeconds: result.watchedSeconds,
              duration: result.duration,
              lastNonZeroPos: result.lastNonZeroPositionSeconds,
              lastNonZeroDur: result.lastNonZeroDurationSeconds,
              sessionMode: playbackSession.mode,
              autoplayPaused: playbackSession.autoplayPaused,
              stopAfterCurrent: playbackSession.stopAfterCurrent,
              hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
              upcomingNext: episodeAvailability.upcomingNext,
              animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
            },
          });
          const autoplayAdvanceArgs = {
            result,
            title,
            currentEpisode,
            session: playbackSession,
            availability: episodeAvailability,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          };
          const nextEpisode = await resolveAutoplayAdvanceEpisode(autoplayAdvanceArgs);
          let catalogAutoplayEndBanner: string | undefined;
          if (!nextEpisode) {
            const blockedBy = explainAutoplayBlockReason(autoplayAdvanceArgs);
            catalogAutoplayEndBanner = explainAutoplayNoNextEpisodeCatalogHint({
              ...autoplayAdvanceArgs,
              isAnime: stateManager.getState().mode === "anime",
            });

            // Enrich the anime banner with precise schedule data from cache when available.
            // Overrides the generic "release schedules not shown here" message with a real date.
            if (stateManager.getState().mode === "anime" && title.id.startsWith("anilist:")) {
              const schedule = container.catalogScheduleService.peekNextRelease(
                "anilist",
                title.id,
              );
              if (schedule?.episode && schedule.releaseAt) {
                const nextEp = schedule.episode;
                const releaseMs = Date.parse(schedule.releaseAt);
                const nowMs2 = Date.now();
                if (Number.isFinite(releaseMs) && releaseMs > nowMs2) {
                  const diffMs = releaseMs - nowMs2;
                  const diffH = diffMs / 3_600_000;
                  let timeLabel: string;
                  if (diffH < 24) {
                    const h = Math.floor(diffH);
                    const m = Math.floor((diffH - h) * 60);
                    timeLabel = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
                  } else if (diffH < 168) {
                    timeLabel = `on ${new Date(releaseMs).toLocaleDateString(undefined, { weekday: "long" })}`;
                  } else {
                    timeLabel = new Date(releaseMs).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    });
                  }
                  catalogAutoplayEndBanner = `Caught up · Ep ${nextEp} airs ${timeLabel}`;
                }
              }
            }

            diagnosticsStore.record({
              category: "playback",
              message: "Auto-next blocked",
              context: {
                blockedBy,
                endReason: result.endReason,
                watchedSeconds: result.watchedSeconds,
                duration: result.duration,
                autoplayMode: playbackSession.mode,
                autoplayPaused: playbackSession.autoplayPaused,
                stopAfterCurrent: playbackSession.stopAfterCurrent,
                hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
                upcomingNext: episodeAvailability.upcomingNext,
                animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
                catalogBanner: catalogAutoplayEndBanner ?? null,
              },
            });
          }
          if (nextEpisode) {
            const countdownResult = await this.runAutoNextCountdown(context, nextEpisode);
            if (countdownResult === "cancelled") {
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
              playbackSession = {
                ...playbackSession,
                autoplayPaused: true,
                autoplayPauseReason: "user",
              };
              diagnosticsStore.record({
                category: "playback",
                message: "Auto-next countdown cancelled",
                context: {
                  titleId: title.id,
                  nextSeason: nextEpisode.season,
                  nextEpisode: nextEpisode.episode,
                },
              });
              this.updatePlaybackFeedback(context, {
                detail: "Auto-next paused",
                note: "Press resume when you want to continue.",
              });
            } else {
              logger.info("Auto-next advancing to next episode", {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                nextSeason: nextEpisode.season,
                nextEpisode: nextEpisode.episode,
                hasPrefetch: episodePrefetch.hasReadyFor(
                  buildPrefetchTarget(nextEpisode, resolvedProviderId),
                ),
              });
              diagnosticsStore.record({
                category: "playback",
                message: "Auto-next advancing to next episode",
                context: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  nextSeason: nextEpisode.season,
                  nextEpisode: nextEpisode.episode,
                  hasPrefetch: episodePrefetch.hasReadyFor(
                    buildPrefetchTarget(nextEpisode, resolvedProviderId),
                  ),
                },
              });

              this.updatePlaybackFeedback(context, {
                detail: "Loading next episode",
                note: `S${String(nextEpisode.season).padStart(2, "0")}E${String(nextEpisode.episode).padStart(2, "0")}`,
              });

              await applyMpvEpisodeLoadingOverlay(playerControl.getActive(), nextEpisode);

              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: nextEpisode,
              });
              pendingStart = await startNavigationToEpisode(nextEpisode);
              stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
              playbackSession = {
                ...playbackSession,
                stopAfterCurrent: false,
              };

              const autoplayPrefetchTarget = buildPrefetchTarget(nextEpisode, resolvedProviderId);
              await handoffNextEpisodePrefetch(
                autoplayPrefetchTarget,
                "post-playback.autonext.prefetch-wait",
              );

              continue;
            }
          }

          if (playbackSession.stopAfterCurrent) {
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            playbackSession = {
              ...playbackSession,
              stopAfterCurrent: false,
            };
          }

          await player.releasePersistentSession();
          this.updatePlaybackFeedback(context, { detail: null, note: null });
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
            "post-playback-opened",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              endReason: result.endReason,
            },
          );

          // Playlist auto-advance: if catalog autoplay didn't fire, check the
          // user's playlist queue for a cross-title advance.
          if (
            !nextEpisode &&
            result.endReason === "eof" &&
            !playbackSession.autoplayPaused &&
            !context.signal.aborted
          ) {
            const nextPlaylistItem = container.playlistService.peekNext();
            if (nextPlaylistItem) {
              const episodeLabel =
                nextPlaylistItem.episode !== undefined
                  ? ` S${String(nextPlaylistItem.season ?? 1).padStart(2, "0")}E${String(nextPlaylistItem.episode).padStart(2, "0")}`
                  : "";
              const playlistCountdown = await runAutoplayAdvanceCountdown({
                seconds: 3,
                signal: context.signal,
                sleep: (ms) => Bun.sleep(ms),
                onTick: (remaining) => {
                  this.updatePlaybackFeedback(context, {
                    detail: "Playlist next ready",
                    note: `Next: ${nextPlaylistItem.title}${episodeLabel} in ${remaining}s  ·  a to pause`,
                  });
                },
                isCancelled: () => stateManager.getState().autoplaySessionPaused,
              });
              if (playlistCountdown !== "cancelled") {
                container.playlistService.advance();
                const titleInfo: TitleInfo = {
                  id: nextPlaylistItem.titleId,
                  name: nextPlaylistItem.title,
                  type: nextPlaylistItem.mediaKind === "movie" ? "movie" : "series",
                };
                return {
                  status: "success",
                  value: {
                    type: "playlist-advance",
                    titleInfo,
                    mode: nextPlaylistItem.mediaKind === "anime" ? "anime" : "series",
                    season: nextPlaylistItem.season,
                    episode: nextPlaylistItem.episode,
                  },
                };
              }
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
              playbackSession = {
                ...playbackSession,
                autoplayPaused: true,
                autoplayPauseReason: "user",
              };
              this.updatePlaybackFeedback(context, { detail: null, note: null });
            }
          }

          // Post-playback menu — inner loop so unavailable navigation
          // actions stay in the menu instead of re-resolving the stream.
          const { openPlaybackShell } = await import("../app-shell/ink-shell");
          const shellRuntime = buildShellRuntimeBindings(container);

          // Loaded once per post-play session when the synchronous seed is empty.
          // null = not yet attempted; [] = attempted (within budget) but empty.
          let postPlaybackLoadedRecommendations: readonly PostPlaybackRecommendationItem[] | null =
            null;
          // Bound how long the post-play surface waits for a live recommendation
          // load before painting without it (the seed handles the fast path).
          const POST_PLAYBACK_RECOMMENDATION_BUDGET_MS = 1200;

          postPlayback: while (true) {
            const resumeSeconds = toHistoryTimestamp(
              result,
              effectiveTiming.current,
              config.quitNearEndThresholdMode,
            );
            const autoplaySessionPaused = playbackSession.autoplayPaused;
            const canResumePlayback =
              result.endReason !== "eof" &&
              resumeSeconds > 10 &&
              (result.duration <= 0 || resumeSeconds < Math.max(0, result.duration - 5));
            const mode = stateManager.getState().mode;
            const recommendationRailStartedAtMs = Date.now();
            let recommendationRailItems = seedPostPlaybackRecommendationItems({
              enabled: container.config.recommendationRailEnabled,
              currentTitle: title.name,
              prefetchedItems: prefetchedRecommendationItems,
            });
            diagnosticsStore.record({
              category: "playback",
              operation: "post-playback.recommendations.seed",
              message: "Post-playback recommendations seeded for first paint",
              context: {
                titleId: title.id,
                mode,
                itemCount: recommendationRailItems.length,
                elapsedMs: Date.now() - recommendationRailStartedAtMs,
                prefetched: Boolean(
                  (prefetchedRecommendationItems as readonly SearchResult[] | null)?.length,
                ),
              },
            });
            if (
              recommendationRailItems.length === 0 &&
              container.config.recommendationRailEnabled
            ) {
              // Seed was empty (nothing prefetched). Briefly await a live load so
              // the post-play surface can actually show recommendations instead of
              // warming results into the void with no re-render path (A3). Loaded
              // at most once per session, capped by a budget so the screen paints.
              if (postPlaybackLoadedRecommendations === null) {
                const loadStartedAtMs = Date.now();
                postPlaybackLoadedRecommendations = await Promise.race([
                  loadPostPlaybackRecommendationItems(container, title, mode, null),
                  Bun.sleep(POST_PLAYBACK_RECOMMENDATION_BUDGET_MS).then(
                    () => [] as readonly PostPlaybackRecommendationItem[],
                  ),
                ]).catch(() => [] as readonly PostPlaybackRecommendationItem[]);
                diagnosticsStore.record({
                  category: "playback",
                  operation: "post-playback.recommendations.load",
                  message: "Post-playback recommendations loaded before first paint",
                  context: {
                    titleId: title.id,
                    mode,
                    itemCount: postPlaybackLoadedRecommendations.length,
                    elapsedMs: Date.now() - loadStartedAtMs,
                    timedOut: postPlaybackLoadedRecommendations.length === 0,
                  },
                });
              }
              if (postPlaybackLoadedRecommendations.length > 0) {
                recommendationRailItems = postPlaybackLoadedRecommendations;
              }
            }
            // Playback "started" means mpv reached real content. Exit on load or a
            // quit within the first seconds (no eof, no resumable position, almost
            // nothing watched) is NOT a completion — never claim finished/watched.
            const playbackStarted =
              result.endReason === "eof" || result.watchedSeconds >= 30 || resumeSeconds > 10;
            const postPlayInput = buildPostPlayInputFromPlaybackContext({
              title,
              currentEpisode,
              availability: episodeAvailability,
              isAnime: mode === "anime",
              nextAirDateHint: catalogAutoplayEndBanner?.replace(/^Caught up ·\s*/i, ""),
              playbackStarted,
            });
            const postPlayState = resolvePostPlayState(postPlayInput);
            const upcomingEpisode = episodeAvailability.nextEpisode;
            const nextEpisodePickerOption = upcomingEpisode
              ? shellEpisodePicker.options.find(
                  (option) =>
                    option.value === `${upcomingEpisode.season}:${upcomingEpisode.episode}`,
                )
              : undefined;
            const episodesInCurrentSeason = shellEpisodePicker.options.filter((option) =>
              option.value.startsWith(`${currentEpisode.season}:`),
            ).length;
            const watchedEpisodes = watchedEntries.filter((entry) =>
              title.type === "series" ? entry.season === currentEpisode.season : true,
            ).length;
            const postAction = await openPlaybackShell({
              state: {
                type: title.type,
                title: title.name,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                posterUrl: title.posterUrl,
                provider: resolvedProviderId,
                subtitleStatus: describeSubtitleStatus(
                  preparedStream,
                  stateManager.getState().mode === "anime"
                    ? stateManager.getState().animeLanguageProfile.subtitle
                    : stateManager.getState().seriesLanguageProfile.subtitle,
                ),
                autoplayPaused: autoplaySessionPaused,
                showMemory: false,
                mode,
                resumeLabel: canResumePlayback
                  ? title.type === "series"
                    ? `resume S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}  ·  ${formatTimestamp(resumeSeconds)}`
                    : `resume ${formatTimestamp(resumeSeconds)}`
                  : undefined,
                status: catalogAutoplayEndBanner
                  ? { label: catalogAutoplayEndBanner, tone: "neutral" }
                  : { label: "Ready for next action", tone: "success" },
                footerMode: "minimal",
                postPlayState,
                episodeLabel: buildPostPlayEpisodeLabel(
                  title,
                  currentEpisode,
                  episodesInCurrentSeason || undefined,
                ),
                nextEpisodeLabel: buildPostPlayNextEpisodeLabel(
                  upcomingEpisode,
                  nextEpisodePickerOption?.label,
                ),
                totalEpisodes: title.episodeCount ?? shellEpisodePicker.options.length,
                watchedEpisodes,
                currentSeason: currentEpisode.season,
                recommendationRailItems: recommendationRailItems.slice(0, 4).map((item) => ({
                  id: item.id,
                  title: item.title,
                  type: item.type,
                  ...(item.sourceId ? { sourceId: item.sourceId } : {}),
                  ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
                  ...(item.year ? { year: item.year } : {}),
                  ...(item.overview ? { overview: item.overview } : {}),
                  ...(item.posterPath !== undefined ? { posterPath: item.posterPath } : {}),
                  ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
                })),
                commands: resolveCommandContext(stateManager.getState(), "postPlayback"),
              },
              providerOptions: shellRuntime.providerOptions,
              episodePickerOptions: shellEpisodePicker.options,
              episodePickerSubtitle: shellEpisodePicker.subtitle,
              episodePickerInitialIndex: shellEpisodePicker.initialIndex,
              settings: shellRuntime.settings,
              settingsSeriesProviderOptions: shellRuntime.settingsSeriesProviderOptions,
              settingsAnimeProviderOptions: shellRuntime.settingsAnimeProviderOptions,
              onChangeProvider: shellRuntime.onChangeProvider,
              onSaveSettings: shellRuntime.onSaveSettings,
              loadHelpPanel: shellRuntime.loadHelpPanel,
              loadAboutPanel: shellRuntime.loadAboutPanel,
              loadDiagnosticsPanel: shellRuntime.loadDiagnosticsPanel,
              loadHistoryPanel: shellRuntime.loadHistoryPanel,
            });

            if (typeof postAction === "object") {
              if (postAction.type === "queue-recommendation") {
                enqueuePostPlaybackRecommendation(container, postAction.item);
              } else if (postAction.type === "open-recommendation-actions") {
                await openPostPlaybackRecommendationActionPanel({
                  container,
                  items: postAction.items,
                  mode,
                });
              }
              continue postPlayback;
            }

            const routedAction = await routePlaybackShellAction({
              action: postAction,
              container,
            });

            if (routedAction === "quit") {
              return { status: "quit" };
            } else if (typeof routedAction === "object" && routedAction.type === "history-entry") {
              return {
                status: "success",
                value: {
                  type: "history_entry",
                  title: routedAction.title,
                  episode: routedAction.episode,
                },
              };
            } else if (routedAction === "mode-switch") {
              return { status: "success", value: "back_to_search" };
            } else if (routedAction === "toggle-autoplay") {
              const playbackAction = resolvePostPlaybackSessionAction(
                "toggle-autoplay",
                playbackSession,
              );
              playbackSession = playbackAction.session;
              stateManager.dispatch({
                type: "SET_SESSION_AUTOPLAY_PAUSED",
                paused: playbackAction.session.autoplayPaused,
              });
              continue postPlayback;
            } else if (routedAction === "resume") {
              pendingStart = startAtResumePoint(resumeSeconds, { suppressResumePrompt: true });
              const playbackAction = resolvePostPlaybackSessionAction("resume", playbackSession);
              playbackSession = playbackAction.session;
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "resume-requested",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              );
              if (!playbackAction.session.autoplayPaused) {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
              }
              break postPlayback;
            } else if (routedAction === "replay") {
              pendingStart = startFromBeginning();
              const playbackAction = resolvePostPlaybackSessionAction("replay", playbackSession);
              playbackSession = playbackAction.session;
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "replay-requested",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              );
              if (!playbackAction.session.autoplayPaused) {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
              }
              break postPlayback;
            } else if (routedAction === "fallback") {
              const fallback = providerRegistry
                .getCompatible(title, stateManager.getState().mode)
                .find((candidate) => candidate.metadata.id !== resolvedProviderId);
              if (!fallback) {
                continue postPlayback;
              }
              sessionSoftProviderId = null;
              stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
              pendingStart = startEpisodeNavigation({ targetResumeSeconds: resumeSeconds });
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  fromProvider: resolvedProviderId,
                  provider: fallback.metadata.id,
                },
              );
              diagnosticsStore.record({
                category: "playback",
                message: "Switching to fallback provider after shell command",
                context: {
                  from: resolvedProviderId,
                  fallback: fallback.metadata.id,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              });
              break postPlayback;
            } else if (
              routedAction === "source" ||
              routedAction === "quality" ||
              routedAction === "streams"
            ) {
              // Unified Tracks panel: /source and /quality deep-link a section,
              // /streams opens the whole surface. The user may switch any
              // section from the same panel, so restart semantics follow the
              // picked section, not the command that opened it.
              const initialSection =
                routedAction === "source"
                  ? "source"
                  : routedAction === "quality"
                    ? "quality"
                    : undefined;
              const picked = await openTracksPanel(preparedStream, { initialSection }, container);
              const selection = picked ? streamSelectionFromTrackPick(picked) : null;
              if (!picked || !selection) {
                continue postPlayback;
              }
              preferredStreamSelection = selection;
              pendingStart =
                picked.section === "source"
                  ? startEpisodeNavigation({ targetResumeSeconds: resumeSeconds })
                  : startAtResumePoint(resumeSeconds, { suppressResumePrompt: true });
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  ...(selection.sourceId
                    ? { sourceId: selection.sourceId }
                    : { streamId: selection.streamId }),
                },
              );
              break postPlayback;
            } else if (routedAction === "download") {
              await enqueueCurrentPlaybackDownload({
                container,
                reason: "post-playback-command",
              });
              continue postPlayback;
            } else if (routedAction === "back-to-search") {
              return { status: "success", value: "back_to_search" };
            } else if (routedAction === "back-to-results") {
              return { status: "success", value: "back_to_results" };
            } else if (routedAction === "handled") {
              continue postPlayback;
            } else if (postAction === "clear-cache" || postAction === "clear-history") {
              await handleShellAction({ action: postAction, container });
              continue postPlayback;
            } else if (routedAction === "pick-episode" && title.type === "series") {
              const { chooseEpisodeFromMetadata } = await import("@/session-flow");
              const selection = await chooseEpisodeFromMetadata({
                currentId: title.id,
                isAnime: stateManager.getState().mode === "anime",
                currentSeason: currentEpisode.season,
                currentEpisode: currentEpisode.episode,
                animeEpisodeCount: title.episodeCount,
                animeEpisodes: currentAnimeEpisodes,
                container,
              });
              if (!selection) {
                logger.info("Episode picker cancelled", {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                });
                continue postPlayback;
              }
              const pickedEpisode = episodeInfoFromSelection({
                season: selection.season,
                episode: selection.episode,
                isAnime: stateManager.getState().mode === "anime",
                titleId: title.id,
                animeEpisodes: currentAnimeEpisodes,
              });
              stateManager.dispatch({
                type: "SELECT_EPISODE",
                episode: pickedEpisode,
              });
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                {
                  titleId: title.id,
                  season: selection.season,
                  episode: selection.episode,
                  source: "episode-picker",
                },
              );
              pendingStart = await startNavigationToEpisode(pickedEpisode);
              break postPlayback;
            } else if (postAction === "next" && title.type === "series") {
              if (episodeAvailability.nextEpisode) {
                pendingStart = await startNavigationToEpisode(episodeAvailability.nextEpisode);
                stateManager.dispatch({
                  type: "SELECT_EPISODE",
                  episode: episodeAvailability.nextEpisode,
                });
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  {
                    titleId: title.id,
                    season: episodeAvailability.nextEpisode.season,
                    episode: episodeAvailability.nextEpisode.episode,
                    source: "next",
                  },
                );
                break postPlayback;
              }
              continue postPlayback;
            } else if (postAction === "previous" && title.type === "series") {
              if (episodeAvailability.previousEpisode) {
                pendingStart = await startNavigationToEpisode(episodeAvailability.previousEpisode);
                stateManager.dispatch({
                  type: "SELECT_EPISODE",
                  episode: episodeAvailability.previousEpisode,
                });
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  {
                    titleId: title.id,
                    season: episodeAvailability.previousEpisode.season,
                    episode: episodeAvailability.previousEpisode.episode,
                    source: "previous",
                  },
                );
                break postPlayback;
              }
              continue postPlayback;
            } else if (postAction === "next-season" && title.type === "series") {
              if (episodeAvailability.nextSeasonEpisode) {
                pendingStart = await startNavigationToEpisode(
                  episodeAvailability.nextSeasonEpisode,
                );
                stateManager.dispatch({
                  type: "SELECT_EPISODE",
                  episode: episodeAvailability.nextSeasonEpisode,
                });
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  {
                    titleId: title.id,
                    season: episodeAvailability.nextSeasonEpisode.season,
                    episode: episodeAvailability.nextSeasonEpisode.episode,
                    source: "next-season",
                  },
                );
                break postPlayback;
              }
              continue postPlayback;
            } else {
              return { status: "success", value: "back_to_search" };
            }
          }
        } catch (e) {
          if (resolveController.signal.aborted && !context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
            this.updatePlaybackFeedback(context, { detail: null, note: null });
            diagnosticsStore.record({
              category: "playback",
              message: "Playback resolve cancelled",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
            return { status: "success", value: "back_to_results" };
          }
          throw e;
        } finally {
          workControl.setActive(null);
          context.signal.removeEventListener("abort", abortOnSessionStop);
        }
      }
    } catch (e) {
      if (context.signal.aborted) {
        this.updatePlaybackFeedback(context, { detail: null, note: null });
        return { status: "cancelled" };
      }
      logger.error("Playback phase error", { error: String(e) });
      return {
        status: "error",
        error: {
          code: "PLAYER_FAILED",
          message: String(e),
          retryable: false,
        },
      };
    } finally {
      this.updatePlaybackFeedback(context, { detail: null, note: null });
      await player.releasePersistentSession();
    }

    // Fallback return (should not reach here)
    return { status: "success", value: "back_to_search" };
  }

  private retryTimingInBackground(
    title: TitleInfo,
    episode: EpisodeInfo,
    container: PhaseContext["container"],
    timingRef?: { current: PlaybackTimingMetadata | null },
    cache?: Map<string, PlaybackTimingMetadata | null>,
    isAnime?: boolean,
  ): Promise<void> {
    return (async () => {
      const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
      const providerId = container.stateManager.getState().provider;
      const timing = await timingAggregator.resolve(
        title,
        episode,
        mode,
        AbortSignal.timeout(10_000),
        { providerId },
      );
      if (timing) {
        if (timingRef) timingRef.current = timing;
        if (cache) {
          const cacheKey =
            title.type === "movie"
              ? `movie:${title.id}`
              : `series:${title.id}:${episode.season}:${episode.episode}`;
          cache.set(cacheKey, timing);
        }
        container.playerControl.updateCurrentPlaybackTiming(timing, "background-retry");
      }
    })();
  }

  private async getPlaybackTimingMetadata(
    title: TitleInfo,
    episode: EpisodeInfo,
    cache: Map<string, PlaybackTimingMetadata | null>,
    signal?: AbortSignal,
    isAnime?: boolean,
    providerId?: string,
  ) {
    const cacheKey =
      title.type === "movie"
        ? `movie:${title.id}`
        : `series:${title.id}:${episode.season}:${episode.episode}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
    const timing = await timingAggregator.resolve(title, episode, mode, signal, { providerId });
    cache.set(cacheKey, timing);
    return timing;
  }

  private async resolveEpisodePrefetchBundle(
    context: PhaseContext,
    input: {
      readonly title: TitleInfo;
      readonly nextEpisode: EpisodeInfo;
      readonly providerId: string;
      readonly target?: EpisodePrefetchTarget;
      readonly onProgress?: (progress: EpisodePrefetchProgress) => void;
      readonly signal: AbortSignal;
    },
  ): Promise<EpisodePrefetchBundle | null> {
    const {
      engine,
      cacheStore,
      config,
      stateManager,
      providerHealth,
      sourceInventory,
      titleProviderHealth,
    } = context.container;
    const mode = stateManager.getState().mode;
    const subLang =
      mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    const isInteractiveSubtitle = subLang === "interactive" || subLang === "fzf";

    const coordinator = new PlaybackResolveCoordinator({
      engine,
      cacheStore,
      providerHealth,
      sourceInventory,
      titleProviderHealth,
    });

    const stream = await coordinator.prefetch({
      title: input.title,
      episode: input.nextEpisode,
      mode,
      providerId: input.providerId,
      audioPreference:
        mode === "anime" ? config.animeLanguageProfile.audio : config.seriesLanguageProfile.audio,
      subtitlePreference:
        mode === "anime"
          ? config.animeLanguageProfile.subtitle
          : config.seriesLanguageProfile.subtitle,
      qualityPreference:
        mode === "anime"
          ? config.animeLanguageProfile.quality
          : config.seriesLanguageProfile.quality,
      recoveryMode: config.recoveryMode,
      signal: input.signal,
      onEvent: (event) => {
        if (event.type === "cache-hit" || event.type === "cache-hit-validated") {
          input.onProgress?.({ exactStreamCacheHit: true });
        } else if (event.type === "source-inventory-hit") {
          input.onProgress?.({ sourceInventoryHit: true, streamValidationActive: true });
        } else if (event.type === "attempt" && event.attempt > 1) {
          input.onProgress?.({ fallbackAttemptStarted: true });
        }
      },
    });

    if (!stream) return null;
    input.onProgress?.({ videoReady: true, candidateStreamsReturned: true });

    const target: EpisodePrefetchTarget = input.target ?? {
      titleId: input.title.id,
      episode: input.nextEpisode,
      providerId: input.providerId,
      audioPreference:
        mode === "anime" ? config.animeLanguageProfile.audio : config.seriesLanguageProfile.audio,
      qualityPreference:
        mode === "anime"
          ? config.animeLanguageProfile.quality
          : config.seriesLanguageProfile.quality,
      subtitlePreference:
        mode === "anime"
          ? config.animeLanguageProfile.subtitle
          : config.seriesLanguageProfile.subtitle,
    };

    if (isInteractiveSubtitle) {
      return { target, stream, prepared: false };
    }

    const preparedStream = await this.preparePlaybackStream(
      stream,
      input.title,
      input.nextEpisode,
      context,
    );

    return { target, stream: preparedStream, prepared: true };
  }

  private async preparePlaybackStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
  ): Promise<StreamInfo> {
    const { stateManager, logger } = context.container;
    const subLang =
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    const subtitleDecision = await choosePlaybackSubtitle({
      stream,
      subLang,
      pickSubtitle: (tracks) =>
        openSubtitlePicker(
          tracks,
          buildPickerActionContext({
            container: context.container,
            taskLabel: "Choose subtitles",
          }),
          context.container,
        ),
    });

    logger.info("Subtitle resolution", {
      provider: stateManager.getState().provider,
      titleId: title.id,
      type: title.type,
      season: episode.season,
      episode: episode.episode,
      requestedSubLang: subLang,
      subtitleReason: subtitleDecision.reason,
      availableTracks: subtitleDecision.availableTracks,
      subtitleSelected: subtitleDecision.subtitle ?? null,
      providerSubtitleSource: stream.subtitleSource ?? "none",
      providerSubtitleEvidence: stream.subtitleEvidence ?? null,
    });
    context.container.diagnosticsStore.record({
      category: "subtitle",
      message: "Subtitle resolution",
      context: {
        provider: stateManager.getState().provider,
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang: subLang,
        subtitleReason: subtitleDecision.reason,
        availableTracks: subtitleDecision.availableTracks,
        subtitleSelected: subtitleDecision.subtitle ?? null,
        providerSubtitleSource: stream.subtitleSource ?? "none",
        providerSubtitleEvidence: stream.subtitleEvidence ?? null,
      },
    });

    return {
      ...stream,
      subtitle: subtitleDecision.subtitle ?? undefined,
    };
  }

  private async playStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
    startAt = 0,
    resumePromptAt = 0,
    playbackMode: "manual" | "autoplay-chain" = "manual",
    timing: PlaybackTimingMetadata | null = null,
    onNearEof?: () => void,
    suppressResumePrompt = false,
    correlation?: DiagnosticCorrelation,
  ): Promise<PlaybackResult> {
    const { player, stateManager, config } = context.container;

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;
    const subtitleStatus = describeSubtitleStatus(
      stream,
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle,
    );

    try {
      this.updatePlaybackFeedback(context, {
        detail: "Launching player",
        note: subtitleStatus,
      });
      const initialSubtitleCount = stream.subtitleList?.length
        ? stream.subtitleList.length
        : stream.subtitle
          ? 1
          : undefined;
      let latestPresencePositionSeconds = startAt > 0 ? startAt : 0;
      let latestPresenceDurationSeconds = 0;
      this.updatePresenceInBackground(
        context,
        "presence.updatePlaybackLaunch",
        {
          mode: stateManager.getState().mode,
          title,
          episode,
          providerId: stateManager.getState().provider,
          stream,
          startedAtMs: Date.now(),
          positionSeconds: latestPresencePositionSeconds,
          subtitleCount: initialSubtitleCount,
        },
        correlation,
      );
      this.startLateSubtitleResolver({
        stream,
        title,
        episode,
        context,
      });
      const result = await player.play(stream, {
        url: stream.url,
        headers: stream.headers,
        subtitle: stream.subtitle,
        subtitleStatus,
        correlation,
        audioPreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.audio
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.audio
              : stateManager.getState().seriesLanguageProfile.audio,
        subtitlePreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.subtitle
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.subtitle
              : stateManager.getState().seriesLanguageProfile.subtitle,
        qualityPreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.quality
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.quality
              : stateManager.getState().seriesLanguageProfile.quality,
        displayTitle,
        startAt,
        resumePromptAt,
        attach: false,
        playbackMode,
        timing,
        resumeStartChoicePrompt: suppressResumePrompt ? false : config.resumeStartChoicePrompt,
        autoSkipEnabled: !stateManager.getState().autoskipSessionPaused,
        skipRecap: config.skipRecap,
        skipIntro: config.skipIntro,
        skipPreview: config.skipPreview,
        skipCredits: config.skipCredits,
        onNearEof,
        onPlaybackEvent: (event) => {
          if (event.type !== "network-sample") {
            this.updatePlaybackFeedback(context, this.describePlayerEvent(event));
          }
          if (event.type === "network-buffering") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "buffering" });
          } else if (event.type === "stream-stalled" || event.type === "ipc-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "stalled" });
          } else if (event.type === "seek-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "seeking" });
          } else if (event.type === "playback-started") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });
            // Update presence with accurate start time (after buffering)
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackStarted",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                subtitleCount: undefined,
              },
              correlation,
            );
          } else if (event.type === "playback-progress") {
            latestPresencePositionSeconds = event.positionSeconds;
            latestPresenceDurationSeconds = event.durationSeconds;
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackProgress",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
              },
              correlation,
            );
          } else if (event.type === "late-subtitles-attached") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackSubtitles",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                subtitleCount: event.trackCount,
              },
              correlation,
            );
          } else if (event.type === "playback-paused") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackPaused",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                paused: true,
              },
              correlation,
            );
          } else if (event.type === "playback-resumed") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackResumed",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
              },
              correlation,
            );
          } else if (event.type === "track-changed") {
            // Keep session state aligned when users switch tracks directly in mpv.
            const currentStream = stateManager.getState().stream;
            if (currentStream && event.trackType === "sub" && event.id === 0) {
              stateManager.dispatch({
                type: "SET_STREAM",
                stream: { ...currentStream, subtitle: undefined },
              });
            }
            context.container.diagnosticsStore.record({
              category: "playback",
              message: "Track changed from mpv",
              context: {
                trackType: event.trackType,
                id: event.id,
              },
            });
          }
        },
        onPlayerReady: () => {
          this.updatePlaybackFeedback(context, {
            detail: "Player controls ready",
          });
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
        },
      });

      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });
      return result;
    } finally {
      // Don't clear presence here — between autoplay-chain episodes we want
      // continuous "watching" presence like Netflix/Crunchyroll. The
      // updatePlayback at the start of the next episode will seamlessly
      // transition the activity. Presence is cleared only when the user
      // explicitly navigates away from playback (back_to_search or
      // back_to_results outcomes above).
    }
  }

  private startLateSubtitleResolver({
    stream,
    title,
    episode,
    context,
  }: {
    stream: StreamInfo;
    title: TitleInfo;
    episode: EpisodeInfo;
    context: PhaseContext;
  }): void {
    const { stateManager, diagnosticsStore, logger } = context.container;
    const requestedSubLang =
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    if (
      requestedSubLang === "none" ||
      stream.subtitle ||
      stream.subtitleList?.length ||
      hardSubSatisfiesSubtitlePreference(stream, requestedSubLang) ||
      !title.id
    ) {
      return;
    }

    const inflightKey = `${title.id}:${episode.season}:${episode.episode}:${requestedSubLang}`;
    if (PlaybackPhase.lateSubtitleInflight.has(inflightKey)) {
      diagnosticsStore.record({
        category: "subtitle",
        message: "Late subtitle lookup skipped (already in flight)",
        context: { inflightKey },
      });
      return;
    }
    PlaybackPhase.lateSubtitleInflight.add(inflightKey);

    diagnosticsStore.record({
      category: "subtitle",
      message: "Late subtitle lookup started",
      context: {
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang,
      },
    });

    void (async () => {
      try {
        const result = await resolveSubtitlesByTmdbId({
          tmdbId: title.id,
          type: title.type,
          season: title.type === "series" ? episode.season : undefined,
          episode: title.type === "series" ? episode.episode : undefined,
          preferredLang: requestedSubLang,
        });

        if (context.signal.aborted) return;
        if (result.list.length === 0) {
          diagnosticsStore.record({
            category: "subtitle",
            message: result.failed ? "Late subtitle lookup failed" : "Late subtitle lookup empty",
            context: {
              titleId: title.id,
              requestedSubLang,
              failed: result.failed,
            },
          });
          return;
        }

        const mergedSubtitleList = mergeSubtitleTracks(
          stream.subtitleList,
          result.list as unknown as SubtitleTrack[],
        );
        const selected = selectSubtitle(mergedSubtitleList as never, requestedSubLang);
        const selectedUrl = selected?.url ?? result.selected ?? null;
        if (!selectedUrl) {
          diagnosticsStore.record({
            category: "subtitle",
            message: "Late subtitle lookup found tracks but no selectable URL",
            context: { titleId: title.id, trackCount: mergedSubtitleList.length },
          });
          return;
        }

        const attached = await this.attachLateSubtitlesWhenPlayerReady(context, {
          primarySubtitle: selectedUrl,
          subtitleTracks: mergedSubtitleList,
        });
        if (!attached) return;

        const currentState = stateManager.getState();
        if (
          currentState.currentTitle?.id === title.id &&
          currentState.currentEpisode?.season === episode.season &&
          currentState.currentEpisode?.episode === episode.episode
        ) {
          stateManager.dispatch({
            type: "SET_STREAM",
            stream: {
              ...stream,
              subtitle: selectedUrl,
              subtitleList: mergedSubtitleList,
              subtitleSource: "wyzie",
              subtitleEvidence: {
                directSubtitleObserved: Boolean(stream.subtitleList?.length),
                wyzieSearchObserved: true,
                reason: "wyzie-selected",
              },
            },
          });
        }

        diagnosticsStore.record({
          category: "subtitle",
          message: "Late subtitle lookup attached tracks",
          context: {
            titleId: title.id,
            selected: selectedUrl,
            trackCount: mergedSubtitleList.length,
          },
        });
      } catch (error) {
        if (context.signal.aborted) return;
        logger.warn("Late subtitle lookup failed", { error: String(error) });
        diagnosticsStore.record({
          category: "subtitle",
          message: "Late subtitle lookup failed",
          context: { titleId: title.id, error: String(error) },
        });
      } finally {
        PlaybackPhase.lateSubtitleInflight.delete(inflightKey);
      }
    })();
  }

  private async attachLateSubtitlesWhenPlayerReady(
    context: PhaseContext,
    attachment: {
      primarySubtitle: string;
      subtitleTracks: readonly SubtitleTrack[];
    },
  ): Promise<boolean> {
    const player = context.container.playerControl;
    const deadline = Date.now() + 30_000;

    while (!context.signal.aborted && Date.now() < deadline) {
      let active = player.getActive();
      if (!active) {
        active = await player.waitForActivePlayer({
          signal: context.signal,
          timeoutMs: Math.max(0, deadline - Date.now()),
        });
        if (!active) return false;
      }

      const attached = await player.attachLateSubtitles(attachment, "late-subtitle-resolver");
      if (attached) return true;

      await Bun.sleep(250);
    }
    return false;
  }

  private async getAnimeEpisodeOptions({
    title,
    mode,
    provider,
    cache,
    signal,
  }: {
    title: TitleInfo;
    mode: "series" | "anime";
    provider: import("../services/providers/Provider").Provider | undefined;
    cache: Map<string, readonly EpisodePickerOption[] | undefined>;
    signal?: AbortSignal;
  }): Promise<readonly EpisodePickerOption[] | undefined> {
    const cacheKey =
      provider && title ? `${provider.metadata.id}:${title.id}` : provider?.metadata.id;
    if (cacheKey && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = await this.loadAnimeEpisodeOptions(title, mode, provider, signal);
    if (cacheKey) {
      cache.set(cacheKey, result);
    }
    return result;
  }

  private async loadAnimeEpisodeOptions(
    title: TitleInfo,
    mode: "series" | "anime",
    provider: import("../services/providers/Provider").Provider | undefined,
    signal?: AbortSignal,
  ): Promise<readonly EpisodePickerOption[] | undefined> {
    if (mode !== "anime" || title.type !== "series" || !provider?.listEpisodes) {
      return undefined;
    }

    try {
      return (await provider.listEpisodes({ title }, signal)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function describeSubtitleStatus(stream: StreamInfo, subLang: string): string {
  return describePlaybackSubtitleStatus(stream, subLang);
}
