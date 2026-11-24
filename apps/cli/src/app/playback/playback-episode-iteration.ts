// =============================================================================
// One playback loop iteration
//
// Resolves the current episode (local file or provider), plays it, records
// history, then decides what happens next: recover/fail over, act on the
// player's control action, auto-advance, Up Next, or the post-play menu.
// Returns NEXT_ITERATION to run the loop again, or the phase result.
// =============================================================================

import { openPlaybackEpisodePicker } from "@/app-shell/workflows";
import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import { planCatalogAutoAdvance } from "@/app/playback/playback-catalog-autoadvance";
import { applyPlaybackControlAction } from "@/app/playback/playback-control-actions";
import {
  armEpisodeResolve,
  createEpisodeAttempt,
  resolveEpisodeSourceAuthority,
} from "@/app/playback/playback-episode-attempt";
import { loadEpisodeContext } from "@/app/playback/playback-episode-context";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { persistEpisodeHistory } from "@/app/playback/playback-history-persist";
import { createPlaybackIteration } from "@/app/playback/playback-iteration";
import { createNextEpisodePrefetch } from "@/app/playback/playback-next-episode-prefetch";
import { resolvePlaylistAutoNextCountdown } from "@/app/playback/playback-outcome";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import {
  type PlaybackLoopState,
  NEXT_ITERATION,
  type PlaybackIterationStep,
} from "@/app/playback/playback-phase-session";
import { playEpisode } from "@/app/playback/playback-player-launch";
import { planPlaylistAutoAdvance } from "@/app/playback/playback-playlist-autoadvance";
import {
  createPostPlaybackMenuDeps,
  runPostPlaybackMenuAfterEpisode,
} from "@/app/playback/playback-post-play-entry";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback/playback-post-play-lifecycle";
import {
  canAutoContinueIntoRecommendation,
  canAdvanceIntoRecommendation,
} from "@/app/playback/playback-postplay-policy";
import { clearPresenceInBackground } from "@/app/playback/playback-presence-writer";
import { recoverAfterPlayback } from "@/app/playback/playback-recovery";
import { didPlaybackFailToStart } from "@/app/playback/playback-session-controller";
import { acquireEpisodeStream } from "@/app/playback/playback-stream-acquire";
import { offerPrePlayConfirm, readyEpisodeStream } from "@/app/playback/playback-stream-ready";
import type { AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { decodeEpisodeSelectionValue } from "@/domain/playback/episode-selection";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import { listReadyEpisodes } from "@/services/offline/offline-episode-index";

export async function runEpisodeIteration(loop: PlaybackLoopState): Promise<PlaybackIterationStep> {
  const {
    context,
    host,
    title,
    run,
    queueAttempt,
    historyTitleLookup,
    episodePrefetch,
    navigatePlaybackEpisode,
    invalidateRecentEpisodeStream,
  } = loop;
  const { container } = context;
  const {
    providerRegistry,
    stateManager,
    logger,
    historyRepository,
    config,
    diagnosticsService,
    playerControl,
    player,
    workControl,
  } = container;

  if (context.signal.aborted) {
    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
    host.ledger.discard();
    await container.player.releasePersistentSession();
    return { status: "cancelled" };
  }

  loop.previousIterationAbort?.abort();
  const playbackIterationAbort = new AbortController();
  loop.previousIterationAbort = playbackIterationAbort;
  run.localEpisodeTiming = null;
  run.localPlaybackJobId = null;
  run.localPlaybackSource = null;
  const currentEpisode = stateManager.getState().currentEpisode;
  // No episode left to play: the loop ends and the phase returns to search.
  if (!currentEpisode) return { status: "success", value: "back_to_search" };
  const episodeScopeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
  if (run.autoRecoverEpisodeKey !== episodeScopeKey) {
    run.autoRecoverEpisodeKey = episodeScopeKey;
    run.autoSourceRecoverAttempts = 0;
    run.triedFailoverSourceIds = [];
    run.startupProviderHopUsed = false;
  }
  const queuedSourceOverride = playerControl.consumePendingEpisodeSourceOverride();
  if (queuedSourceOverride) {
    run.episodePlaybackSourceOverride = queuedSourceOverride;
    invalidateRecentEpisodeStream(currentEpisode);
  }
  queueAttempt?.setStage("provider-resolution");
  run.playbackSession = transitionPlaybackSession(context, run.playbackSession, "resolve-started", {
    titleId: title.id,
    season: currentEpisode.season,
    episode: currentEpisode.episode,
    provider: stateManager.getState().provider,
  });

  const resolve = armEpisodeResolve(loop, currentEpisode);
  const { controller: resolveController, abortOnSessionStop } = resolve;

  try {
    const authority = await resolveEpisodeSourceAuthority(loop, currentEpisode);
    if (authority.kind === "exit") return authority.step;
    const { sourceAuthority, configuredProviderId } = authority;
    const attempt = createEpisodeAttempt(loop, {
      currentEpisode,
      playbackIterationAbort,
      resolve,
      sourceAuthority,
      configuredProviderId,
    });
    const { completeSourceTrackPick, recordStartupMark } = attempt;
    recordStartupMark("episode-bootstrap-started");
    const episodeContext = await loadEpisodeContext(loop, attempt);
    const {
      watchedEntries,
      isAnimePlayback,
      offlineTitleId,
      currentAnimeEpisodes,
      shellEpisodePicker,
      episodeAvailability,
      buildPrefetchTarget,
    } = episodeContext;
    const acquired = await acquireEpisodeStream(loop, attempt, episodeContext);
    if (acquired.kind === "exit") return acquired.step;
    const ready = await readyEpisodeStream(loop, attempt, episodeContext, acquired);
    const { effectiveTiming, preparedStream } = ready;
    if ((await offerPrePlayConfirm(loop, attempt, preparedStream)) === NEXT_ITERATION) {
      return NEXT_ITERATION;
    }
    const nextEpisodePrefetch = createNextEpisodePrefetch(loop, attempt, episodeContext, ready);
    const { handoffNextEpisodePrefetch } = nextEpisodePrefetch;
    const played = await playEpisode(loop, attempt, ready, nextEpisodePrefetch);
    if (played.kind === "exit") return played.step;
    const { result } = played;
    const quitThresholdMode = config.quitNearEndThresholdMode;
    await persistEpisodeHistory(loop, attempt, episodeContext, acquired, ready, result);
    const recovery = await recoverAfterPlayback(
      loop,
      attempt,
      acquired,
      ready,
      result,
      quitThresholdMode,
    );
    if (recovery.kind === "exit") return recovery.step;
    const controlStep = await applyPlaybackControlAction(
      loop,
      attempt,
      episodeContext,
      ready,
      nextEpisodePrefetch,
      result,
      recovery,
    );
    if (controlStep) return controlStep;
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

        return NEXT_ITERATION;
      }
    }

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
      prefetchedItems: nextEpisodePrefetch.prefetchedRecommendationItems,
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
            status: "success",
            value: autoNextDecision.outcome,
          };
        }
        container.queueService.rollbackBeforeStart(
          autoNextDecision.intent,
          autoNextDecision.failure,
        );
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

    // Post-playback menu — inner loop so unavailable navigation
    // actions stay in the menu instead of re-resolving the stream.
    const { openPlaybackShell } = await import("../../app-shell/ink-shell");

    const iteration = createPlaybackIteration({
      title,
      currentEpisode,
      episodeAvailability,
      result,
      effectiveTimingCurrent: effectiveTiming.current,
      nextEpisode,
      catalogAutoplayEndBanner,
      shellEpisodePicker,
      watchedEntries,
      prefetchedRecommendationItems: nextEpisodePrefetch.prefetchedRecommendationItems,
      currentAnimeEpisodes,
      preparedStream,
      resolvedProviderId: attempt.resolvedProviderId,
      openRecoverySourcePanelOnPostPlay:
        (result.suspectedDeadStream === true &&
          Boolean(preparedStream.providerResolveResult?.streams.length)) ||
        didPlaybackFailToStart(result),
      stopAfterCurrentAtMenuEntry,
    });

    const postPlaybackMenuDeps = createPostPlaybackMenuDeps({
      container,
      signal: context.signal,
      quitNearEndBehavior: config.quitNearEndBehavior,
      quitNearEndThresholdMode: config.quitNearEndThresholdMode,
      recommendationRail,
      historyRepository,
      diagnosticsService,
      readWatchedEntries: () => historyRepository.listByTitleIdentity(historyTitleLookup),
      getMode: () => stateManager.getState().mode,
      getAutoplaySessionPaused: () => stateManager.getState().autoplaySessionPaused,
      getAutoskipSessionPaused: () => stateManager.getState().autoskipSessionPaused,
      getProvider: () => stateManager.getState().provider,
      getAnimeSubtitlePreference: () => stateManager.getState().animeLanguageProfile.subtitle,
      getSeriesSubtitlePreference: () => stateManager.getState().seriesLanguageProfile.subtitle,
      dispatchAutoplayPaused: (paused) =>
        stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused }),
      dispatchAutoskipPaused: (paused) =>
        stateManager.dispatch({ type: "SET_SESSION_AUTOSKIP_PAUSED", paused }),
      dispatchStopAfterCurrent: (enabled) =>
        stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled }),
      dispatchWatchTimeSummary: (summary) =>
        stateManager.dispatch({ type: "SET_WATCH_TIME_SUMMARY", summary }),
      updatePlaybackFeedback: (feedback) => updatePlaybackFeedback(context, feedback),
      transitionPlaybackSession: (session, event, meta) =>
        transitionPlaybackSession(context, session, event, meta ?? {}),
      runAutoNextCountdown: (nextEpisodeTarget) => host.runAutoNextCountdown(nextEpisodeTarget),
      navigatePlaybackEpisode,
      completeSourceTrackPick,
      handoffNextEpisodePrefetch,
      buildPrefetchTarget,
      invalidateRecentEpisodeStream,
      openPlaybackShell,
      chooseEpisodeFromMetadata: async (input) => {
        if (sourceAuthority.kind === "local") {
          const picker = await buildPlaybackEpisodePickerOptions({
            title,
            currentEpisode,
            isAnime: isAnimePlayback,
            networkAllowed: false,
            localEpisodes: listReadyEpisodes(container.offlineAssetService, offlineTitleId),
            watchedEntries: historyRepository.listByTitleIdentity(historyTitleLookup),
          });
          const picked = await openPlaybackEpisodePicker(container, currentEpisode.season, picker);
          return picked && picker.options.some((row) => row.value === picked)
            ? decodeEpisodeSelectionValue(picked)
            : null;
        }
        const { chooseEpisodeFromMetadata } = await import("@/session-flow");
        const outcome = await chooseEpisodeFromMetadata(input);
        // The post-play menu branches on success only, so report the
        // reason here rather than letting a catalog failure read to the
        // user as though they had dismissed the picker themselves.
        if (outcome.kind === "unavailable") {
          stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: outcome.reason,
          });
        }
        return outcome.kind === "selected" ? outcome.selection : null;
      },
      episodeInfoFromSelection,
      readAutoAdvanceGuards,
      getCompatibleProviders: () =>
        sourceAuthority.kind === "provider"
          ? providerRegistry.getCompatible(title, stateManager.getState().mode)
          : [],
      teardownPlaybackForPostPlayExit: () =>
        teardownPlaybackForPostPlayExit(container, episodePrefetch, playbackIterationAbort),
    });

    const postPlaybackResult = await runPostPlaybackMenuAfterEpisode({
      run,
      iteration,
      deps: postPlaybackMenuDeps,
    });
    attempt.resolvedProviderId = iteration.resolvedProviderId;
    if (postPlaybackResult.kind === "exit") {
      return postPlaybackResult.result;
    }
    if (postPlaybackResult.kind === "playlist-advance") {
      return { status: "success", value: postPlaybackResult.value };
    }
  } catch (e) {
    if (resolveController.signal.aborted && !context.signal.aborted) {
      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
      stateManager.dispatch({ type: "SET_STREAM", stream: null });
      updatePlaybackFeedback(context, { detail: null, note: null });
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
  // The iteration finished without leaving the phase: run the loop again.
  return NEXT_ITERATION;
}
