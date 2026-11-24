// =============================================================================
// Auto-advance after an episode
//
// Two decisions, in order. First the catalog: autoplay into the next episode
// after the auto-next countdown (adopting its prefetch), unless a guard such
// as stop-after-current, a paused session or a queued play-next blocks it.
// Then, with the post-play surface prepared, Up Next: the queue's next entry
// or the top recommendation after their own countdowns. Both read one queue
// head so a reordered row cannot slip between the decisions.
// =============================================================================

import { planCatalogAutoAdvance } from "@/app/playback/playback-catalog-autoadvance";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import type { NextEpisodePrefetch } from "@/app/playback/playback-next-episode-prefetch";
import { resolvePlaylistAutoNextCountdown } from "@/app/playback/playback-outcome";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import {
  NEXT_ITERATION,
  type PlaybackIterationStep,
  type PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import { planPlaylistAutoAdvance } from "@/app/playback/playback-playlist-autoadvance";
import { preparePostPlaybackSurface } from "@/app/playback/playback-post-play-lifecycle";
import {
  canAutoContinueIntoRecommendation,
  canAdvanceIntoRecommendation,
} from "@/app/playback/playback-postplay-policy";
import { clearPresenceInBackground } from "@/app/playback/playback-presence-writer";
import type { ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import type { AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import type { PlaybackResult } from "@/domain/types";

export type CatalogAdvancePlan = {
  readonly nextEpisode: Awaited<ReturnType<typeof planCatalogAutoAdvance>>["nextEpisode"];
  readonly catalogAutoplayEndBanner: Awaited<
    ReturnType<typeof planCatalogAutoAdvance>
  >["catalogAutoplayEndBanner"];
  /** The one queue head every auto-advance decision of this episode end reads. */
  readonly autoAdvanceQueueHead: ReturnType<
    PlaybackLoopState["context"]["container"]["queueService"]["peekNext"]
  >;
  readonly readAutoAdvanceGuards: () => AutoAdvanceGuards;
};

export type CatalogAdvanceOutcome =
  | { readonly kind: "exit"; readonly step: PlaybackIterationStep }
  | ({ readonly kind: "proceed" } & CatalogAdvancePlan);

/** Catalog auto-next: NEXT_ITERATION when it advanced, otherwise the plan Up Next and post-play read. */
export async function advanceToNextEpisode(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  ready: ReadyEpisodeStream,
  prefetch: NextEpisodePrefetch,
  result: PlaybackResult,
): Promise<CatalogAdvanceOutcome> {
  const { context, host, title, run, episodePrefetch, navigatePlaybackEpisode } = loop;
  const { container } = context;
  const { stateManager, logger, config, diagnosticsService } = container;
  const { currentEpisode } = attempt;
  const { episodeAvailability, buildPrefetchTarget } = episodeContext;
  const { effectiveTiming } = ready;
  const { handoffNextEpisodePrefetch } = prefetch;
  diagnosticsService.record({
    category: "playback",
    message: "Evaluating autoplay advance",
    context: {
      endReason: result.endReason,
      watchedSeconds: result.watchedSeconds,
      duration: result.duration,
      lastNonZeroPos: result.lastNonZeroPositionSeconds,
      lastNonZeroDur: result.lastNonZeroDurationSeconds,
      sessionMode: run.playbackSession.mode,
      autoplayPaused: run.playbackSession.autoplayPaused,
      stopAfterCurrent: run.playbackSession.stopAfterCurrent,
      hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
      upcomingNext: episodeAvailability.upcomingNext,
      animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
    },
  });
  const autoplayAdvanceArgs = {
    result,
    title,
    currentEpisode,
    session: run.playbackSession,
    availability: episodeAvailability,
    timing: effectiveTiming.current,
    endPolicy: {
      quitNearEndBehavior: config.quitNearEndBehavior,
      quitNearEndThresholdMode: config.quitNearEndThresholdMode,
    },
  };
  const readAutoAdvanceGuards = (): AutoAdvanceGuards => ({
    endReason: result.endReason,
    autoplayPaused: run.playbackSession.autoplayPaused,
    autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
    signalAborted: context.signal.aborted,
  });
  // One decision owns one exact queue head. Re-reading after the
  // catalog path would let a reordered row bypass or replace the
  // interrupting play-next intent that prevented episode countdown.
  const autoAdvanceQueueHead = container.queueService.peekNext();
  const { nextEpisode, catalogAutoNext, catalogAutoplayEndBanner, blockedBy } =
    await planCatalogAutoAdvance({
      autoplayAdvanceArgs,
      guards: readAutoAdvanceGuards(),
      queueHead: autoAdvanceQueueHead,
      seriesDone: !episodeAvailability.nextEpisode,
      autoplayRecommendations: container.config.autoplayRecommendations,
      isAnime: stateManager.getState().mode === "anime",
      anilistTitleId: title.id,
      catalogScheduleService: container.catalogScheduleService,
    });
  if (blockedBy) {
    diagnosticsService.record({
      category: "playback",
      message: "Auto-next blocked",
      context: {
        blockedBy,
        endReason: result.endReason,
        watchedSeconds: result.watchedSeconds,
        duration: result.duration,
        autoplayMode: run.playbackSession.mode,
        autoplayPaused: run.playbackSession.autoplayPaused,
        stopAfterCurrent: run.playbackSession.stopAfterCurrent,
        hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
        upcomingNext: episodeAvailability.upcomingNext,
        animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
        catalogBanner: catalogAutoplayEndBanner ?? null,
      },
    });
  }
  if (catalogAutoNext?.kind === "episode") {
    const nextEpisodeAdvance = catalogAutoNext.episode;
    const countdownResult = await host.runAutoNextCountdown(nextEpisodeAdvance);
    if (countdownResult === "cancelled") {
      // Stop/back/previous cancels this advance only; the session
      // autoplay preference reflects what the user set with `a`.
      const autoplayPaused = stateManager.getState().autoplaySessionPaused;
      run.playbackSession = {
        ...run.playbackSession,
        autoplayPaused,
        autoplayPauseReason: autoplayPaused ? "user" : null,
      };
      diagnosticsService.record({
        category: "playback",
        message: "Auto-next countdown cancelled",
        context: {
          titleId: title.id,
          nextSeason: nextEpisodeAdvance.season,
          nextEpisode: nextEpisodeAdvance.episode,
        },
      });
      updatePlaybackFeedback(context, {
        detail: "Auto-next paused",
        note: "Press resume when you want to continue.",
      });
    } else {
      logger.info("Auto-next advancing to next episode", {
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        nextSeason: nextEpisodeAdvance.season,
        nextEpisode: nextEpisodeAdvance.episode,
        hasPrefetch: episodePrefetch.hasReadyFor(
          buildPrefetchTarget(nextEpisodeAdvance, attempt.resolvedProviderId),
        ),
      });
      diagnosticsService.record({
        category: "playback",
        message: "Auto-next advancing to next episode",
        context: {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          nextSeason: nextEpisodeAdvance.season,
          nextEpisode: nextEpisodeAdvance.episode,
          hasPrefetch: episodePrefetch.hasReadyFor(
            buildPrefetchTarget(nextEpisodeAdvance, attempt.resolvedProviderId),
          ),
        },
      });

      updatePlaybackFeedback(context, {
        detail: "Loading next episode",
        note: `S${String(nextEpisodeAdvance.season).padStart(2, "0")}E${String(nextEpisodeAdvance.episode).padStart(2, "0")}`,
      });

      run.pendingStart = await navigatePlaybackEpisode(nextEpisodeAdvance, {
        loadingOrder: "before-start",
        resetStopAfterCurrent: true,
      });

      const autoplayPrefetchTarget = buildPrefetchTarget(
        nextEpisodeAdvance,
        attempt.resolvedProviderId,
      );
      await handoffNextEpisodePrefetch(
        autoplayPrefetchTarget,
        "post-playback.autonext.prefetch-wait",
      );

      return { kind: "exit", step: NEXT_ITERATION };
    }
  }
  return {
    kind: "proceed",
    nextEpisode,
    catalogAutoplayEndBanner,
    autoAdvanceQueueHead,
    readAutoAdvanceGuards,
  };
}

export type UpNextOutcome =
  | { readonly kind: "exit"; readonly step: PlaybackIterationStep }
  | {
      readonly kind: "proceed";
      /** stop-after-current as it was when the menu opened (it is consumed here). */
      readonly stopAfterCurrentAtMenuEntry: boolean;
      readonly recommendationRail: PostPlaybackRecommendationRail;
    };

/**
 * Prepares the post-play surface (consuming stop-after-current, releasing mpv,
 * clearing presence) and runs Up Next: the queue's next entry or the top
 * recommendation after a countdown. Returns the exit step when it advanced,
 * otherwise what the post-play menu needs.
 */
export async function openPostPlayAndRunUpNext(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  prefetch: NextEpisodePrefetch,
  result: PlaybackResult,
  plan: CatalogAdvancePlan,
): Promise<UpNextOutcome> {
  const { context, title, run, episodePrefetch } = loop;
  const { container } = context;
  const { stateManager, player } = container;
  const { currentEpisode, playbackIterationAbort } = attempt;
  const { episodeAvailability } = episodeContext;
  const { nextEpisode, autoAdvanceQueueHead, readAutoAdvanceGuards } = plan;
  const stopAfterCurrentAtMenuEntry = run.playbackSession.stopAfterCurrent;
  if (run.playbackSession.stopAfterCurrent) {
    stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
    run.playbackSession = {
      ...run.playbackSession,
      stopAfterCurrent: false,
    };
  }

  await player.releasePersistentSession();
  clearPresenceInBackground(context, "presence.clearPlaybackIdle", "playback-idle");
  preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
  updatePlaybackFeedback(context, { detail: null, note: null });
  run.playbackSession = transitionPlaybackSession(
    context,
    run.playbackSession,
    "post-playback-opened",
    {
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      endReason: result.endReason,
    },
  );

  const recommendationRail = new PostPlaybackRecommendationRail({
    container,
    title,
    budgetMs: stateManager.getState().mode === "youtube" ? 2_500 : 250,
  });
  const autoContinueIntoRecommendationPossible = canAutoContinueIntoRecommendation({
    sessionMode: run.playbackSession.mode,
    hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
    endReason: result.endReason,
    autoplayPaused: run.playbackSession.autoplayPaused,
    autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
    aborted: context.signal.aborted,
    hasQueuedNext: Boolean(autoAdvanceQueueHead),
    autoplayRecommendationsEnabled: container.config.autoplayRecommendations,
  });
  const recommendationRailItems = await recommendationRail.resolveRailItems({
    mode: stateManager.getState().mode,
    prefetchedItems: prefetch.prefetchedRecommendationItems,
    autoContinueIntoRecommendationPossible,
  });
  const topRec = recommendationRailItems[0];
  const topRecommendation: MediaItemIdentity | null = topRec
    ? {
        mediaKind: topRec.type === "movie" ? "movie" : "series",
        titleId: topRec.id,
        title: topRec.title,
        sourceId: topRec.sourceId,
      }
    : null;

  const playlistAutoNext = planPlaylistAutoAdvance({
    catalogNextEpisode: nextEpisode,
    guards: readAutoAdvanceGuards(),
    queueHead: autoAdvanceQueueHead,
    seriesHasNextEpisode: Boolean(episodeAvailability.nextEpisode),
    autoplayRecommendations: container.config.autoplayRecommendations,
    topRecommendation,
  });
  if (playlistAutoNext?.kind === "queue") {
    const nextPlaylistItem = playlistAutoNext.entry;
    const selectedQueueId = nextPlaylistItem.id;
    const autoNextIntent = container.queueService.beginPlayback(selectedQueueId);
    if (autoNextIntent) {
      const nextPlaylistLabel = formatQueueEntryLabel(nextPlaylistItem) ?? nextPlaylistItem.title;
      const playlistCountdown = await runAutoplayAdvanceCountdown({
        seconds: 3,
        signal: context.signal,
        sleep: (ms) => Bun.sleep(ms),
        onTick: (remaining) => {
          updatePlaybackFeedback(context, {
            detail: "Playlist next ready",
            note: `Next: ${nextPlaylistLabel} in ${remaining}s  ·  a to pause`,
          });
        },
        isCancelled: () => stateManager.getState().autoplaySessionPaused,
      });
      const autoNextDecision = resolvePlaylistAutoNextCountdown({
        intent: autoNextIntent,
        title: nextPlaylistItem.title,
        season: nextPlaylistItem.season,
        episode: nextPlaylistItem.episode,
        countdown: playlistCountdown === "cancelled" ? "cancelled" : "advanced",
      });
      if (autoNextDecision.kind === "advance") {
        return {
          kind: "exit",
          step: {
            status: "success",
            value: autoNextDecision.outcome,
          },
        };
      }
      container.queueService.rollbackBeforeStart(autoNextDecision.intent, autoNextDecision.failure);
    }
    {
      const autoplayPaused = stateManager.getState().autoplaySessionPaused;
      run.playbackSession = {
        ...run.playbackSession,
        autoplayPaused,
        autoplayPauseReason: autoplayPaused ? "user" : null,
      };
    }
    updatePlaybackFeedback(context, { detail: null, note: null });
  } else if (
    playlistAutoNext?.kind === "recommendation" &&
    canAdvanceIntoRecommendation({
      shellMode: stateManager.getState().mode,
      recommendationId: playlistAutoNext.item.titleId,
    })
  ) {
    const topRecAdvance = playlistAutoNext.item;
    const recCountdown = await runAutoplayAdvanceCountdown({
      seconds: 5,
      signal: context.signal,
      sleep: (ms) => Bun.sleep(ms),
      onTick: (remaining) => {
        updatePlaybackFeedback(context, {
          detail: "Up next ready",
          note: `Up next: ${topRecAdvance.title} in ${remaining}s  ·  a to pause`,
        });
      },
      isCancelled: () => stateManager.getState().autoplaySessionPaused,
    });
    if (recCountdown !== "cancelled") {
      return {
        kind: "exit",
        step: {
          status: "success",
          value: {
            type: "playlist-advance",
            titleInfo: {
              id: topRecAdvance.titleId,
              name: topRecAdvance.title,
              type: topRec?.type === "movie" ? "movie" : "series",
              posterUrl: topRec?.posterPath ?? undefined,
              externalIds: topRec?.externalIds,
            },
            mode: stateManager.getState().mode,
          },
        },
      };
    }
    {
      const autoplayPaused = stateManager.getState().autoplaySessionPaused;
      run.playbackSession = {
        ...run.playbackSession,
        autoplayPaused,
        autoplayPauseReason: autoplayPaused ? "user" : null,
      };
    }
    updatePlaybackFeedback(context, { detail: null, note: null });
  }
  return { kind: "proceed", stopAfterCurrentAtMenuEntry, recommendationRail };
}
