// =============================================================================
// Playback phase session state
//
// The per-execute scope of a PlaybackPhase run (`PlaybackPhaseSession`) and the
// per-loop scope once an episode has been chosen (`PlaybackLoopState`). Every
// slice of the phase reads its inputs from these instead of closing over
// `execute`'s locals, so the slices can live in their own modules.
// =============================================================================

import { EpisodePrefetchHandle, type EpisodePrefetchTiming } from "@/app/playback/episode-prefetch";
import { createDeadStreamUrlLedger } from "@/app/playback/playback-dead-stream-ledger";
import { applyPlaybackEpisodeNavigation } from "@/app/playback/playback-episode-navigation";
import type { PlaybackLedgerSlot } from "@/app/playback/playback-ledger-slot";
import { type PlaybackOutcome } from "@/app/playback/playback-outcome";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import { createPlaybackRunState } from "@/app/playback/playback-run-state";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import { PlaybackSelectionCoordinator } from "@/app/playback/playback-selection-coordinator";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import { startEpisodeNavigation, startFromBeginning } from "@/app/playback/playback-start-intent";
import {
  applyMpvEpisodeLoadingOverlay,
  applyMpvStreamSwitchOverlay,
} from "@/app/playback/policies/mpv-transition-overlay-policy";
import { createQueuePlaybackAttempt } from "@/app/playback/queue-playback-attempt";
import {
  recentPlaybackStreamKey,
  type RecentPlaybackStreamRecord,
} from "@/app/playback/recent-playback-stream";
import { type StreamSelectionIntent } from "@/app/playback/source-quality";
import { createSourceRefreshCooldownState } from "@/app/playback/source-refresh-policy";
import type { PhaseResult, PhaseContext } from "@/app/session/Phase";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackTimingMetadata,
  StreamInfo,
} from "@/domain/types";
import { endpointCandidatesForPinnedSource } from "@/services/playback/PlaybackResolveService";
import type { ProviderId } from "@kunai/types";

export type PlaybackPhaseHost = {
  /** The phase's history-ledger slot (one per PlaybackPhase instance). */
  readonly ledger: PlaybackLedgerSlot;
  readonly prefetchTiming?: EpisodePrefetchTiming;
  /** The episode auto-next countdown, owned by the phase. */
  readonly runAutoNextCountdown: (
    episode: EpisodeInfo,
  ) => Promise<"continue" | "cancelled" | "skipped">;
};

export type PlaybackPhaseSession = {
  readonly context: PhaseContext;
  readonly host: PlaybackPhaseHost;
  readonly run: PlaybackRunState;
  readonly isOfflineLaunch: boolean;
  readonly animeEpisodeCatalogByProvider: Map<string, readonly EpisodePickerOption[] | undefined>;
  readonly playbackTimingByEpisode: Map<string, PlaybackTimingMetadata | null>;
  readonly selectionCoordinator: PlaybackSelectionCoordinator;
  readonly sourceRefreshCooldown: ReturnType<typeof createSourceRefreshCooldownState>;
  readonly queueAttempt: ReturnType<typeof createQueuePlaybackAttempt> | null;
  readonly getPreferredStreamSelection: (
    providerId: string,
    target: EpisodeInfo,
  ) => StreamSelectionIntent;
  readonly setPreferredStreamSelection: (
    providerId: string,
    target: EpisodeInfo,
    selection: StreamSelectionIntent,
  ) => Promise<void>;
};

export function createPlaybackPhaseSession(
  title: TitleInfo,
  context: PhaseContext,
  host: PlaybackPhaseHost,
): PlaybackPhaseSession {
  const { container } = context;
  const { config } = container;
  const animeEpisodeCatalogByProvider = new Map<
    string,
    readonly EpisodePickerOption[] | undefined
  >();
  const playbackTimingByEpisode = new Map<string, PlaybackTimingMetadata | null>();
  const run = createPlaybackRunState({
    playbackSession: createPlaybackSessionState({ autoNextEnabled: config.autoNext }),
    pendingStart: startFromBeginning(),
  });
  const isOfflineLaunch = title.launchSource === "offline-library";
  const selectionCoordinator = new PlaybackSelectionCoordinator({
    titleId: title.id,
    episodePlaybackSelection: container.episodePlaybackSelection,
    titlePlaybackSource: container.titlePlaybackSource,
    isSourceQuarantined: (providerId, sourceId) =>
      endpointCandidatesForPinnedSource(providerId, sourceId).some((endpoint) =>
        // SAFETY: this coordinator receives IDs from the production registry.
        container.endpointHealth.isQuarantined(providerId as ProviderId, endpoint),
      ),
  });
  const getPreferredStreamSelection = (
    providerId: string,
    target: EpisodeInfo,
  ): StreamSelectionIntent => selectionCoordinator.getEffective(providerId, target);
  const setPreferredStreamSelection = async (
    providerId: string,
    target: EpisodeInfo,
    selection: StreamSelectionIntent,
  ): Promise<void> => {
    await selectionCoordinator.applyEpisodeSelection(providerId, target, selection);
  };
  const sourceRefreshCooldown = createSourceRefreshCooldownState();
  const queueAttempt = title.queuePlaybackIntent
    ? createQueuePlaybackAttempt(container.queueService, title.queuePlaybackIntent)
    : null;

  return {
    context,
    host,
    run,
    isOfflineLaunch,
    animeEpisodeCatalogByProvider,
    playbackTimingByEpisode,
    selectionCoordinator,
    sourceRefreshCooldown,
    queueAttempt,
    getPreferredStreamSelection,
    setPreferredStreamSelection,
  };
}

/** Everything the episode bootstrap hands to the playback loop. */
export type PlaybackEpisodeBootstrap = {
  /** The title upgraded with catalog detail; every later write reads this one. */
  readonly title: TitleInfo;
  readonly historyTitleLookup: PlaybackHistoryTitleLookup;
  readonly startNavigationToEpisode: (
    target: EpisodeInfo,
  ) => Promise<ReturnType<typeof startEpisodeNavigation>>;
  readonly providerSwitchSeqBeforeEpisodePicker: number;
};

export type PlaybackHistoryTitleLookup = {
  readonly id: string;
  readonly kind: ReturnType<typeof classifyPersistedKind>;
  readonly title: string;
  readonly externalIds: ReturnType<typeof enrichExternalIdsWithVideoMeta>;
};

export type PlaybackLoopState = PlaybackPhaseSession &
  PlaybackEpisodeBootstrap & {
    readonly episodePrefetch: EpisodePrefetchHandle;
    readonly recentEpisodeStreams: Map<string, RecentPlaybackStreamRecord>;
    readonly deadStreamUrls: ReturnType<typeof createDeadStreamUrlLedger>;
    /** The last user provider switch a resolve has answered. */
    consumedProviderSwitchSeq: number;
    /**
     * The previous iteration's abort controller, so fire-and-forget
     * per-iteration work (late subtitle resolve/attach) is cancelled when the
     * loop advances to the next episode/retry/fallback, instead of leaking into
     * the new iteration and attaching to the wrong mpv session.
     */
    previousIterationAbort: AbortController | null;
    /**
     * The pre-play Tracks sheet is offered once per launched session: the pick
     * itself comes back as a restart intent through this same loop, and
     * autoplay/episode-navigation restarts must never re-prompt.
     */
    prePlayConfirmOffered: boolean;
    readonly navigatePlaybackEpisode: (
      target: EpisodeInfo,
      options?: {
        readonly cancelPrefetchReason?: string;
        readonly loadingOrder?: "before-start" | "after-start" | "none";
        readonly resetStopAfterCurrent?: boolean;
        readonly resumeInterruptedAutoplay?: boolean;
      },
    ) => Promise<ReturnType<typeof startEpisodeNavigation>>;
    readonly invalidateRecentEpisodeStream: (targetEpisode: EpisodeInfo) => void;
    readonly recentStreamMatchesPreferred: (
      recent: { readonly stream: StreamInfo },
      providerId: string,
      targetEpisode: EpisodeInfo,
    ) => boolean;
    readonly prepareStreamSwitchRestart: (targetEpisode: EpisodeInfo) => Promise<void>;
  };

export function createPlaybackLoopState(
  session: PlaybackPhaseSession,
  bootstrap: PlaybackEpisodeBootstrap,
): PlaybackLoopState {
  const { context, run, getPreferredStreamSelection } = session;
  const {
    title,
    historyTitleLookup,
    startNavigationToEpisode,
    providerSwitchSeqBeforeEpisodePicker,
  } = bootstrap;
  const { stateManager, playerControl } = context.container;
  const episodePrefetch = new EpisodePrefetchHandle(session.host.prefetchTiming);

  // In-memory cache of recently played episode streams so backward navigation
  // (P key) reuses the exact same StreamInfo without provider resolve or cache lookup.
  const recentEpisodeStreams = new Map<string, RecentPlaybackStreamRecord>();
  const deadStreamUrls = createDeadStreamUrlLedger();
  const invalidateRecentEpisodeStream = (targetEpisode: EpisodeInfo): void => {
    recentEpisodeStreams.delete(recentPlaybackStreamKey(title.id, targetEpisode));
  };
  const recentStreamMatchesPreferred = (
    recent: { readonly stream: StreamInfo },
    providerId: string,
    targetEpisode: EpisodeInfo,
  ): boolean => {
    const preferred = getPreferredStreamSelection(providerId, targetEpisode);
    if (!preferred.sourceId && !preferred.streamId) return true;
    const result = recent.stream.providerResolveResult;
    if (!result) return false;
    if (preferred.streamId) return result.selectedStreamId === preferred.streamId;
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    return selected?.sourceId === preferred.sourceId;
  };
  const prepareStreamSwitchRestart = async (targetEpisode: EpisodeInfo): Promise<void> => {
    run.pendingSourceRefreshAction = "recover";
    invalidateRecentEpisodeStream(targetEpisode);
    updatePlaybackFeedback(context, {
      detail: "Switching stream…",
      note: "Re-resolving with your selection",
    });
    await applyMpvStreamSwitchOverlay(playerControl.getActive());
  };
  const navigatePlaybackEpisode = async (
    target: EpisodeInfo,
    options: {
      readonly cancelPrefetchReason?: string;
      readonly loadingOrder?: "before-start" | "after-start" | "none";
      readonly resetStopAfterCurrent?: boolean;
      readonly resumeInterruptedAutoplay?: boolean;
    } = {},
  ) => {
    const result = await applyPlaybackEpisodeNavigation({
      episode: target,
      session: run.playbackSession,
      cancelPrefetchReason: options.cancelPrefetchReason,
      loadingOrder: options.loadingOrder,
      resetStopAfterCurrent: options.resetStopAfterCurrent,
      resumeInterruptedAutoplay: options.resumeInterruptedAutoplay,
      effects: {
        cancelPrefetch: (reason) => episodePrefetch.cancel(reason),
        showLoadingOverlay: (targetEpisode) =>
          applyMpvEpisodeLoadingOverlay(playerControl.getActive(), targetEpisode),
        startNavigationToEpisode,
        selectEpisode: (targetEpisode) =>
          stateManager.dispatch({ type: "SELECT_EPISODE", episode: targetEpisode }),
        setStopAfterCurrent: (enabled) =>
          stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled }),
        setAutoplayPaused: (paused) =>
          stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused }),
      },
    });
    run.playbackSession = result.session;
    return result.startIntent;
  };

  return {
    ...session,
    title,
    historyTitleLookup,
    startNavigationToEpisode,
    providerSwitchSeqBeforeEpisodePicker,
    episodePrefetch,
    recentEpisodeStreams,
    deadStreamUrls,
    consumedProviderSwitchSeq: providerSwitchSeqBeforeEpisodePicker,
    previousIterationAbort: null,
    prePlayConfirmOffered: false,
    navigatePlaybackEpisode,
    invalidateRecentEpisodeStream,
    recentStreamMatchesPreferred,
    prepareStreamSwitchRestart,
  };
}

/** A loop iteration that ends by starting the loop again (the old `continue`). */
export const NEXT_ITERATION: unique symbol = Symbol("playback-next-iteration");

/** How one loop iteration ends: run the loop again, or leave the phase with a result. */
export type PlaybackIterationStep = PhaseResult<PlaybackOutcome> | typeof NEXT_ITERATION;
