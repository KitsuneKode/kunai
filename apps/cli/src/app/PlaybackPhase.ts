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
import {
  createDeadStreamUrlLedger,
  playbackDeadStreamScopeKey,
} from "@/app/playback-dead-stream-ledger";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import { shouldPersistHistory, toHistoryTimestamp } from "@/app/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";
import {
  resolveStreamProviderId,
  resolveTitleProviderPreference,
} from "@/app/playback-provider-switch";
import { resumeSecondsFromHistoryForEpisode } from "@/app/playback-resume-from-history";
import {
  createPlaybackSessionState,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  didPlaybackFailToStart,
  resolvePlaybackResultDecision,
  resolvePostPlaybackSessionAction,
  syncPlaybackSessionState,
  transitionPlaybackSessionPhase,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback-session-controller";
import { invalidateEpisodePlaybackCaches } from "@/app/playback-source-cache-invalidation";
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
import { choosePlaybackSubtitle, shouldAttemptLateSubtitleLookup } from "@/app/subtitle-selection";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import { titleInfoFromSearchResult } from "@/app/title-info";
import type { Container } from "@/container";
import { episodeThumbKey } from "@/domain/catalog/title-detail";
import {
  buildProviderResolveProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import { resolvePostPlayState } from "@/domain/playback/post-play-state";
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
import {
  AniSkipTimingSource,
  extractProviderNativeTiming,
  IntroDbTimingSource,
  mergeTimingMetadata,
  PlaybackTimingAggregator,
} from "@/infra/timing";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { formatTimestamp } from "@/services/persistence/HistoryStore";
import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
  formatStartupPhaseBreakdown,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import type { ResolveAttempt } from "@kunai/core";
import { VIDKING_PROVIDER_ID } from "@kunai/providers";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

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

/** Stop background playback work before/after the post-play menu (no new mpv). */
function preparePostPlaybackSurface(
  container: PhaseContext["container"],
  episodePrefetch: EpisodePrefetchHandle,
  playbackIterationAbort: AbortController,
): void {
  playbackIterationAbort.abort();
  episodePrefetch.cancel("post-playback-menu");
  container.playerControl.consumeLastAction();
  container.playerControl.consumePendingStreamSelection();
  container.playerControl.consumePendingEpisodeSelection();
  container.stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
}

async function teardownPlaybackForPostPlayExit(
  container: PhaseContext["container"],
  episodePrefetch: EpisodePrefetchHandle,
  playbackIterationAbort: AbortController,
): Promise<void> {
  preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
  await container.player.releasePersistentSession();
}

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

export function playbackStartupStageForPlayerEvent(
  event: PlayerPlaybackEvent,
): PlaybackStartupStage | null {
  switch (event.type) {
    case "media-materialized":
      return "media-materialized";
    case "launching-player":
      return "player-launch";
    case "mpv-process-started":
      return "mpv-process-started";
    case "ipc-connected":
      return "ipc-connected";
    case "player-ready":
      return "player-ready";
    case "subtitle-attached":
      return "subtitle-attached";
    case "playback-progress":
      return "first-progress";
    default:
      return null;
  }
}

function summarizeStartupStreamSource(stream: StreamInfo | null | undefined) {
  if (!stream?.providerResolveResult) return null;
  const result = stream.providerResolveResult;
  const selected =
    result.streams.find((candidate) => candidate.id === result.selectedStreamId) ??
    result.streams[0];
  const selectedSource = result.sources?.find((candidate) => candidate.id === selected?.sourceId);
  return {
    providerId: result.providerId,
    sourceId: selected?.sourceId ?? null,
    streamId: selected?.id ?? null,
    host: (selected?.url ? safeHostname(selected.url) : null) ?? selectedSource?.host ?? null,
    subtitleCount: result.subtitles.length,
    sourceCount: result.sources?.length ?? 0,
    streamCount: result.streams.length,
    hasTiming: hasProviderTimingMetadata(selected?.metadata),
  };
}

function hasProviderTimingMetadata(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return (
    Boolean(metadata.intro) ||
    Boolean(metadata.outro) ||
    Boolean(metadata.introStart) ||
    Boolean(metadata.introEnd) ||
    Boolean(metadata.outroStart) ||
    Boolean(metadata.outroEnd)
  );
}

function scheduleVidkingLazySourceProbes(input: {
  readonly container: Container;
  readonly stream: StreamInfo;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: string;
  readonly signal?: AbortSignal;
  readonly onStreamUpdated: (stream: StreamInfo) => void;
}): void {
  const result = input.stream.providerResolveResult;
  if (!result || result.providerId !== VIDKING_PROVIDER_ID) return;

  const resolveInput: ProviderResolveInput = streamRequestToResolveInput(
    {
      title: input.title,
      episode: input.episode,
      audioPreference: input.audioPreference,
      subtitlePreference: input.subtitlePreference,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority as ProviderResolveInput["startupPriority"],
    },
    input.mode,
  );

  const context: ProviderRuntimeContext = {
    now: () => new Date().toISOString(),
    signal: input.signal,
    retryPolicy: { maxAttempts: 1, backoff: "none", delayMs: 0 },
  };

  const inventoryKey = {
    providerId: input.providerId,
    mediaKind: resolveInput.mediaKind,
    titleId: input.title.id,
    season: input.episode.season,
    episode: input.episode.episode,
    audioMode: input.audioPreference,
    subtitleLanguage: input.subtitlePreference,
    startupPriority: input.startupPriority as ProviderResolveInput["startupPriority"],
  };

  input.container.vidkingLazySourceProbe.schedulePhaseB({
    resolveInput,
    context,
    baseResult: result,
    inventoryKey,
    preferredAudioLanguage: input.audioPreference === "original" ? "en" : input.audioPreference,
    onInventoryUpdated: (inventory) => {
      input.onStreamUpdated({
        ...input.stream,
        providerResolveResult: inventory,
      });
    },
  });
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function formatPlaybackStreamRoute(stream: StreamInfo): string | null {
  const source = summarizeStartupStreamSource(stream);
  if (!source) return null;
  return [source.providerId, source.host ?? source.sourceId].filter(Boolean).join(" / ");
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
      context.container.diagnosticsService.record({
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
      diagnostics: context.container.diagnosticsService,
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
    const { diagnosticsService, stateManager } = context.container;
    stateManager.dispatch({
      type: "SET_PLAYBACK_PROBLEM",
      problem,
    });
    diagnosticsService.record({
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
      case "media-materialized":
        return { detail: event.kind === "dash-mpd" ? "Preparing DASH media" : "Preparing media" };
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
      case "stream-slow":
        return {
          detail:
            event.state === "slow-network-suspected"
              ? "Slow source (network read)"
              : "Building playback buffer",
          note: `${event.secondsBuffering}s buffering`,
        };
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
      stateManager,
      logger,
      historyStore,
      config,
      cacheStore,
      diagnosticsService,
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
    let pendingRecomputeSources = false;

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
      diagnosticsService.record({
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

      let providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;

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

        const { applyTitleProviderPreferenceToSession } =
          await import("@/app/playback-provider-switch");
        applyTitleProviderPreferenceToSession(container, title.id);
        providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;

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
      const recentEpisodeStreams = new Map<
        string,
        {
          readonly stream: StreamInfo;
          readonly selectedProviderId: string;
          readonly resolvedProviderId: string;
          readonly provenance: "fresh" | "cache" | "prefetch" | "fallback";
        }
      >();
      const deadStreamUrls = createDeadStreamUrlLedger();
      let autoSourceRecoverAttempts = 0;
      let autoRecoverEpisodeKey: string | null = null;
      let consumedProviderSwitchSeq = providerSwitchSeqBeforeEpisodePicker;

      // Inner playback loop
      while (true) {
        const playbackIterationAbort = new AbortController();
        const currentEpisode = stateManager.getState().currentEpisode;
        if (!currentEpisode) break;
        const episodeScopeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
        if (autoRecoverEpisodeKey !== episodeScopeKey) {
          autoRecoverEpisodeKey = episodeScopeKey;
          autoSourceRecoverAttempts = 0;
        }
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
          const configuredProviderId = stateManager.getState().provider;
          if (sessionSoftProviderId && sessionSoftProviderId !== configuredProviderId) {
            sessionSoftProviderId = null;
          }
          const currentProvider = providerRegistry.get(
            sessionSoftProviderId ?? configuredProviderId,
          );

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

          const deadStreamScope = playbackDeadStreamScopeKey({
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            providerId: currentProvider.metadata.id,
          });
          const providerAttemptId = createCorrelationId("provider");
          const playbackCorrelation: DiagnosticCorrelation = {
            sessionId: container.sessionId,
            playbackCycleId: createCorrelationId("playback"),
            providerAttemptId,
            traceId: providerAttemptId,
          };
          const startupTimeline = createPlaybackStartupTimeline({
            source: { providerId: currentProvider.metadata.id },
          });
          let resolvedProviderId = currentProvider.metadata.id;
          const recordStartupMark = (stage: PlaybackStartupStage, activeStream?: StreamInfo) => {
            if (!startupTimeline.mark(stage)) return;
            const snapshot = startupTimeline.snapshot();
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "playback",
              operation: "playback.startup.timeline",
              message: `Playback startup ${stage}`,
              providerId: activeStream?.providerResolveResult?.providerId ?? resolvedProviderId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              context: {
                stage,
                summary: formatPlaybackStartupTimeline(snapshot),
                timeline: snapshot,
                source: summarizeStartupStreamSource(activeStream),
              },
            });
            // Once the first frame lands, emit a single phase-bucketed breakdown
            // (resolve vs prepare vs spawn vs first-frame) naming the dominant
            // cost — this is the autonext "stall" instrument. `autoNext` flags
            // whether this startup was an auto-advance vs a manual start.
            if (stage === "first-progress") {
              const phases = summarizeStartupPhases(snapshot);
              if (phases) {
                diagnosticsService.record({
                  ...playbackCorrelation,
                  category: "playback",
                  operation: "playback.startup.phases",
                  message: `Playback startup phases (${phases.dominant} dominant)`,
                  providerId: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  context: {
                    autoNext: config.autoNext,
                    breakdown: formatStartupPhaseBreakdown(phases),
                    ...phases,
                  },
                });
              }
            }
          };
          recordStartupMark("episode-bootstrap-started");

          // Warm the catalog-detail cache early (fire-and-forget) so the post-play
          // rail can read it synchronously instead of racing a cold fetch. Errors
          // are swallowed; post-play falls back to honest placeholders if it never
          // resolves, and the next open reads it warm.
          void fetchTitleDetail(title.id, title.type).catch(() => undefined);

          // Kick off timing fetch in parallel with everything else — IntroDB is a
          // lightweight API call and should resolve well before stream resolution.
          recordStartupMark("timing-fetch-started");
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
          recordStartupMark("episode-context-ready");

          const navigationState = toEpisodeNavigationState(title.type, episodeAvailability, {
            isAnime: stateManager.getState().mode === "anime",
          });
          stateManager.dispatch({
            type: "SET_EPISODE_NAVIGATION",
            navigation: navigationState,
          });
          playerControl.setEpisodeNavigationAvailability(navigationState);

          if (episodeAvailability.tmdbUnavailable) {
            diagnosticsService.record({
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
          stateManager.dispatch({
            type: "SET_PLAYBACK_STATUS",
            status: "loading",
          });
          stateManager.dispatch({ type: "SET_RESOLVE_RETRY_COUNT", count: 0 });
          this.updatePlaybackFeedback(context, {
            detail: "Resolving provider stream",
            note: "Esc cancels this resolve and returns to results",
          });

          const sourceRefreshAction = pendingSourceRefreshAction;
          pendingSourceRefreshAction = null;
          const recomputeSources = pendingRecomputeSources;
          pendingRecomputeSources = false;
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
            diagnosticsService.record({
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
            diagnosticsService.record({
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
            startupPriority: config.startupPriority,
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
          let streamProvenance: "fresh" | "cache" | "prefetch" | "fallback" = consumedBundle
            ? "prefetch"
            : "fresh";
          let resolveAttempts: readonly ResolveAttempt<StreamInfo>[] = [];
          if (stream) recordStartupMark("resolve-complete", stream);

          const resolveTrace = createResolveTraceStub({
            title,
            episode: currentEpisode,
            providerId: currentProvider.metadata.id,
            mode: stateManager.getState().mode,
          });
          diagnosticsService.record({
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
            diagnosticsService.record({
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

          const providerSwitchSeq = stateManager.getState().providerSwitchSeq;
          const pendingUserProviderSwitch = providerSwitchSeq !== consumedProviderSwitchSeq;
          if (pendingUserProviderSwitch) {
            consumedProviderSwitchSeq = providerSwitchSeq;
            sessionSoftProviderId = null;
            stream = null;
          }

          // Check in-memory cache for recently played episodes (backward navigation).
          // This lets P-navigation reuse the exact same StreamInfo without any
          // provider resolve, cache lookup, or health check.
          if (!stream && !sourceRefreshDecision) {
            const recentKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
            const recent = recentEpisodeStreams.get(recentKey);
            const recentMatchesProvider =
              recent?.selectedProviderId === configuredProviderId &&
              recent.resolvedProviderId === configuredProviderId;
            if (recent && recentMatchesProvider) {
              stream = recent.stream;
              resolvedProviderId = recent.resolvedProviderId;
              streamProvenance = recent.provenance;
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "cache",
                operation: "playback.stream.reused",
                message: "Using in-memory recent episode stream (backward navigation)",
                providerId: recent.resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                context: {
                  provenance: "recent-memory",
                  originalProvenance: recent.provenance,
                  selectedProviderId: recent.selectedProviderId,
                  resolvedProviderId: recent.resolvedProviderId,
                },
              });
            }
          }

          if (!stream) {
            recordStartupMark("resolve-started");
            if (sourceRefreshDecision?.kind === "recover") {
              await invalidateEpisodePlaybackCaches({
                cacheStore,
                sourceInventory: container.sourceInventory,
                providerId: currentProvider.metadata.id,
                title,
                episode: currentEpisode,
                mode: stateManager.getState().mode,
                config,
              });
            }
            const sourceRefreshIsRecover = sourceRefreshDecision?.kind === "recover";
            const sourceRefreshIsRefresh = sourceRefreshDecision?.kind === "refresh";
            const titlePreferredProviderId = resolveTitleProviderPreference(
              config.getRaw(),
              title.id,
            );
            // Per-title preference picks the default provider and invalidates caches on
            // switch, but must not force recoveryMode "manual" — that blocks automatic
            // fallback when the preferred provider has no stream (e.g. VidKing down).
            const honorExplicitProviderOnly = pendingUserProviderSwitch || recomputeSources;
            const resolveResult = await container.playbackResolveWork.resolve(
              {
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
                startupPriority: config.startupPriority,
                recoveryMode: honorExplicitProviderOnly ? "manual" : config.recoveryMode,
                preferFreshStream:
                  honorExplicitProviderOnly || sourceRefreshIsRefresh || sourceRefreshIsRecover,
                forceHealthCheck: sourceRefreshIsRecover,
                preserveCachedStreamOnFreshFailure:
                  sourceRefreshIsRefresh && !honorExplicitProviderOnly,
                ignoreTitleHealthSuggestion: honorExplicitProviderOnly,
                ignoreProviderHealth: honorExplicitProviderOnly,
                resolveIntent: recomputeSources ? "refresh" : "play",
                blockedStreamUrls: deadStreamUrls.list(deadStreamScope),
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
                    diagnosticsService.record({
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

                  if (event.type === "title-provider-suggestion") {
                    const suggestedName =
                      providerRegistry.get(event.suggestedProviderId)?.metadata.name ??
                      event.suggestedProviderId;
                    this.updatePlaybackFeedback(context, {
                      note: `VidKing struggled on this title before. ${suggestedName} worked — switch providers or retry VidKing.`,
                    });
                    return;
                  }

                  if (event.type === "cache-health-check") {
                    diagnosticsService.record({
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
              },
              {
                intentKind: sourceRefreshDecision?.kind === "recover" ? "recovery" : "playback",
                budgetLane: "user-blocking",
              },
            );

            stream = resolveResult.stream;
            resolvedProviderId = resolveResult.providerId;
            if (
              stream &&
              pendingUserProviderSwitch &&
              titlePreferredProviderId &&
              resolvedProviderId !== titlePreferredProviderId
            ) {
              const preferredName =
                providerRegistry.get(titlePreferredProviderId)?.metadata.name ??
                titlePreferredProviderId;
              const actualName =
                providerRegistry.get(resolvedProviderId)?.metadata.name ?? resolvedProviderId;
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "provider",
                level: "warn",
                message: "Rejected provider fallback because a per-title preference is set",
                context: {
                  titleId: title.id,
                  preferredProviderId: titlePreferredProviderId,
                  resolvedProviderId,
                },
              });
              this.updatePlaybackFeedback(context, {
                detail: `${preferredName} did not resolve for this episode`,
                note: `Got ${actualName} instead. Use /recompute or switch provider.`,
              });
              stream = null;
            }
            streamProvenance =
              resolveResult.provenance === "prefetched"
                ? "prefetch"
                : resolveResult.provenance.startsWith("cache")
                  ? "cache"
                  : resolveResult.providerId !== currentProvider.metadata.id
                    ? "fallback"
                    : "fresh";
            resolveAttempts = resolveResult.attempts;
            if (stream) recordStartupMark("resolve-complete", stream);

            for (const [attemptIndex, attempt] of resolveAttempts.entries()) {
              diagnosticsService.record({
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
              const fallbackName =
                providerRegistry.get(resolvedProviderId)?.metadata.name ?? resolvedProviderId;
              this.updatePlaybackFeedback(context, {
                note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
              });
            } else if (pendingUserProviderSwitch) {
              const streamProviderId = resolveStreamProviderId(stream);
              if (streamProviderId && streamProviderId === configuredProviderId) {
                this.updatePlaybackFeedback(context, {
                  note: `Resolving via ${providerRegistry.get(configuredProviderId)?.metadata.name ?? configuredProviderId}.`,
                });
              }
            }

            if (stream?.providerResolveResult) {
              diagnosticsService.record({
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

              if (stream) {
                const probeAudioPreference =
                  stateManager.getState().mode === "anime"
                    ? config.animeLanguageProfile.audio
                    : title.type === "movie"
                      ? config.movieLanguageProfile.audio
                      : config.seriesLanguageProfile.audio;
                scheduleVidkingLazySourceProbes({
                  container,
                  stream,
                  title,
                  episode: currentEpisode,
                  mode: stateManager.getState().mode,
                  providerId: resolvedProviderId,
                  audioPreference: probeAudioPreference,
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
                  startupPriority: config.startupPriority,
                  signal: resolveController.signal,
                  onStreamUpdated: (nextStream) => {
                    stream = nextStream;
                    stateManager.dispatch({ type: "SET_STREAM", stream: nextStream });
                  },
                });
              }
            }
          }

          if (stream) recordStartupMark("resolve-complete", stream);

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
                  diagnosticsService.record({
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
          recordStartupMark("timing-wait-started", stream);
          const fetchedPlaybackTiming = await timingFetch;
          recordStartupMark("timing-ready", stream);
          const playbackTiming = mergeTimingMetadata(
            fetchedPlaybackTiming,
            extractProviderNativeTiming(stream, title),
          );
          if (playbackTiming) {
            const timingCacheKey =
              title.type === "movie"
                ? `movie:${title.id}`
                : `series:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
            playbackTimingByEpisode.set(timingCacheKey, playbackTiming);
          }
          // effectiveTiming.current tracks the best timing we have — updated in-place
          // if the background retry resolves while the episode is playing, so all
          // post-playback decisions (history, autoNext, result classification) use it.
          const effectiveTiming = { current: playbackTiming };
          if (!playbackTiming) {
            runBackgroundTask({
              task: "playback.retryTiming",
              category: "playback",
              diagnostics: container.diagnosticsService,
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
          recordStartupMark("stream-prepared", preparedStream);
          stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });

          const episodeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
          recentEpisodeStreams.set(episodeKey, {
            stream: preparedStream,
            selectedProviderId: currentProvider.metadata.id,
            resolvedProviderId,
            provenance: streamProvenance,
          });
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
                diagnosticsService.record({
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
                  diagnosticsService.record({
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
                diagnosticsService.record({
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
            (stage) => recordStartupMark(stage, preparedStream),
            playbackIterationAbort.signal,
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
              diagnosticsService.record({
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
            diagnosticsService.record({
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
            result.endReason === "error" ||
            result.suspectedDeadStream === true ||
            didPlaybackFailToStart(result);
          if (shouldInvalidateStreamCache) {
            const invalidateProviderId = consumedBundle
              ? (consumedBundle.target.providerId ?? resolvedProviderId)
              : resolvedProviderId;
            deadStreamUrls.record(
              playbackDeadStreamScopeKey({
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                providerId: invalidateProviderId,
              }),
              preparedStream.url,
            );
            await invalidateEpisodePlaybackCaches({
              cacheStore,
              sourceInventory: container.sourceInventory,
              providerId: invalidateProviderId,
              title,
              episode: currentEpisode,
              mode: stateManager.getState().mode,
              config,
            });
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
            diagnosticsService.record({
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
            const isExplicitSourceRefresh =
              playbackControlAction === "refresh" || playbackControlAction === "recover";
            const isAutoSourceRecover =
              !isExplicitSourceRefresh &&
              (result.suspectedDeadStream === true || didPlaybackFailToStart(result));

            if (isAutoSourceRecover && autoSourceRecoverAttempts >= 1) {
              diagnosticsService.record({
                category: "playback",
                level: "warn",
                message:
                  "Auto-recover already attempted for this episode; opening post-play instead of looping",
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  endReason: result.endReason,
                  watchedSeconds: result.watchedSeconds,
                },
              });
              this.updatePlaybackFeedback(context, {
                detail: "Could not start playback",
                note: "Press r to try again or switch provider with /provider",
              });
            } else {
              pendingRecomputeSources = playbackControlAction === "recompute";
              pendingStart = startAtResumePoint(
                toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
                { suppressResumePrompt: true },
              );
              pendingSourceRefreshAction =
                playbackControlAction === "recompute"
                  ? "recover"
                  : result.suspectedDeadStream === true ||
                      didPlaybackFailToStart(result) ||
                      playbackControlAction === "recover"
                    ? "recover"
                    : "refresh";
              if (isAutoSourceRecover) {
                autoSourceRecoverAttempts += 1;
              }
              diagnosticsService.record({
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
                  recomputeSources: pendingRecomputeSources,
                  autoRecover: isAutoSourceRecover,
                  autoRecoverAttempts: autoSourceRecoverAttempts,
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
              diagnosticsService.record({
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

            diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
          diagnosticsService.record({
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

            diagnosticsService.record({
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
              diagnosticsService.record({
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
              diagnosticsService.record({
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
          preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
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
            diagnosticsService.record({
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
                diagnosticsService.record({
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
            // Catalog detail for the post-play rail. Read synchronously from the
            // cache the episode-start prefetch warmed — never blocks the surface.
            // Undefined falls back to honest placeholders; the next open is warm.
            const postPlayTitleDetail = peekTitleDetail(title.id, title.type);
            // Next-episode still for the post-play rail, when the merged artwork
            // carries one for that exact season/episode.
            const nextEpisodeThumbUrl =
              upcomingEpisode && postPlayTitleDetail?.artwork?.episodeThumbnails
                ? postPlayTitleDetail.artwork.episodeThumbnails[
                    episodeThumbKey(upcomingEpisode.season, upcomingEpisode.episode)
                  ]
                : undefined;
            const postAction = await openPlaybackShell({
              state: {
                type: title.type,
                title: title.name,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                posterUrl: title.posterUrl,
                titleDetail: postPlayTitleDetail,
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
                nextEpisodeThumbUrl,
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
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
              return { status: "quit" };
            } else if (typeof routedAction === "object" && routedAction.type === "history-entry") {
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
              return {
                status: "success",
                value: {
                  type: "history_entry",
                  title: routedAction.title,
                  episode: routedAction.episode,
                },
              };
            } else if (routedAction === "mode-switch") {
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
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
              if (postPlayState.kind === "did-not-start") {
                pendingSourceRefreshAction = "recover";
                autoSourceRecoverAttempts = 0;
                recentEpisodeStreams.delete(
                  `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
                );
              }
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
            } else if (routedAction === "recompute") {
              pendingStart = startEpisodeNavigation({ targetResumeSeconds: resumeSeconds });
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = true;
              autoSourceRecoverAttempts = 0;
              recentEpisodeStreams.delete(
                `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
              );
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "recovery-started",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  provider: resolvedProviderId,
                  action: "recompute",
                },
              );
              diagnosticsService.record({
                category: "playback",
                message: "Recomputing provider sources after shell command",
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              });
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
              diagnosticsService.record({
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
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
              return { status: "success", value: "back_to_search" };
            } else if (routedAction === "back-to-results") {
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
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
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
              return { status: "success", value: "back_to_search" };
            }
          }
        } catch (e) {
          if (resolveController.signal.aborted && !context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
            this.updatePlaybackFeedback(context, { detail: null, note: null });
            diagnosticsService.record({
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
    const { config, stateManager, playbackResolveWork } = context.container;
    const mode = stateManager.getState().mode;
    const subLang =
      mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    const isInteractiveSubtitle = subLang === "interactive" || subLang === "fzf";

    const stream = await playbackResolveWork.prefetch(
      {
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
        startupPriority: config.startupPriority,
        recoveryMode: config.recoveryMode,
        signal: input.signal,
        onEvent: (event) => {
          if (event.type === "cache-hit" || event.type === "cache-hit-validated") {
            input.onProgress?.({ exactStreamCacheHit: true });
          } else if (event.type === "source-inventory-hit") {
            input.onProgress?.({ sourceInventoryHit: true, streamValidationActive: true });
          } else if (event.type === "provider-resolve-started") {
            input.onProgress?.({ providerResolveActive: true });
          } else if (event.type === "attempt" && event.attempt > 1) {
            input.onProgress?.({ fallbackAttemptStarted: true });
          }
        },
      },
      { intentKind: "prefetch", budgetLane: "near-need" },
    );

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
      startupPriority: config.startupPriority,
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
    context.container.diagnosticsService.record({
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
    onStartupMark?: (stage: PlaybackStartupStage) => void,
    playbackIterationSignal?: AbortSignal,
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
        playbackIterationSignal,
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
          const startupStage = playbackStartupStageForPlayerEvent(event);
          if (startupStage) onStartupMark?.(startupStage);
          if (event.type !== "network-sample") {
            const feedback = this.describePlayerEvent(event);
            this.updatePlaybackFeedback(
              context,
              event.type === "stream-slow" || event.type === "stream-stalled"
                ? {
                    ...feedback,
                    note: [feedback.note, formatPlaybackStreamRoute(stream)]
                      .filter(Boolean)
                      .join(" · "),
                  }
                : feedback,
            );
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
            context.container.diagnosticsService.record({
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
    playbackIterationSignal,
  }: {
    stream: StreamInfo;
    title: TitleInfo;
    episode: EpisodeInfo;
    context: PhaseContext;
    playbackIterationSignal?: AbortSignal;
  }): void {
    const iterationSignal = playbackIterationSignal ?? context.signal;
    const { stateManager, diagnosticsService, logger } = context.container;
    const requestedSubLang =
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    const lookupDecision = shouldAttemptLateSubtitleLookup({
      stream,
      requestedSubLang,
      hasTitleId: Boolean(title.id),
    });
    if (!lookupDecision.attempt) {
      if (
        lookupDecision.reason !== "disabled" &&
        lookupDecision.reason !== "attached" &&
        lookupDecision.reason !== "hardsub-satisfied"
      ) {
        diagnosticsService.record({
          category: "subtitle",
          message: "Late subtitle lookup skipped",
          context: {
            titleId: title.id,
            requestedSubLang,
            reason: lookupDecision.reason,
            availableTracks: lookupDecision.availableTracks,
          },
        });
      }
      return;
    }

    const inflightKey = `${title.id}:${episode.season}:${episode.episode}:${requestedSubLang}`;
    if (PlaybackPhase.lateSubtitleInflight.has(inflightKey)) {
      diagnosticsService.record({
        category: "subtitle",
        message: "Late subtitle lookup skipped (already in flight)",
        context: { inflightKey },
      });
      return;
    }
    PlaybackPhase.lateSubtitleInflight.add(inflightKey);

    diagnosticsService.record({
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

        if (iterationSignal.aborted) return;
        if (result.list.length === 0) {
          diagnosticsService.record({
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
          diagnosticsService.record({
            category: "subtitle",
            message: "Late subtitle lookup found tracks but no selectable URL",
            context: { titleId: title.id, trackCount: mergedSubtitleList.length },
          });
          return;
        }

        const attached = await this.attachLateSubtitlesWhenPlayerReady(context, {
          primarySubtitle: selectedUrl,
          subtitleTracks: mergedSubtitleList,
          playbackIterationSignal,
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

        diagnosticsService.record({
          category: "subtitle",
          operation: "subtitle.attach.outcome",
          message: "Late subtitle lookup attached tracks",
          context: {
            titleId: title.id,
            outcome: "attached",
            delivery: "late",
            trackCount: mergedSubtitleList.length,
          },
        });
      } catch (error) {
        if (iterationSignal.aborted) return;
        logger.warn("Late subtitle lookup failed", { error: String(error) });
        diagnosticsService.record({
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
      playbackIterationSignal?: AbortSignal;
    },
  ): Promise<boolean> {
    const player = context.container.playerControl;
    const iterationSignal = attachment.playbackIterationSignal ?? context.signal;
    const deadline = Date.now() + 30_000;

    while (!iterationSignal.aborted && Date.now() < deadline) {
      let active = player.getActive();
      if (!active) {
        active = await player.waitForActivePlayer({
          signal: iterationSignal,
          timeoutMs: Math.max(0, deadline - Date.now()),
        });
        if (!active) return false;
      }

      const attached = await player.attachLateSubtitles(attachment, "late-subtitle-resolver");
      if (attached) return true;

      await Bun.sleep(250);
    }
    context.container.diagnosticsService.record({
      category: "subtitle",
      operation: "subtitle.attach.outcome",
      message: "Late subtitle attachment timed out waiting for player",
      context: {
        outcome: "player-ready-timeout",
        delivery: "late",
        trackCount: attachment.subtitleTracks.length,
      },
    });
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
