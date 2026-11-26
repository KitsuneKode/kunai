// =============================================================================
// One playback loop iteration
//
// Resolves the current episode (local file or provider), plays it, records
// history, then decides what happens next: recover/fail over, act on the
// player's control action, auto-advance, Up Next, or the post-play menu.
// Returns NEXT_ITERATION to run the loop again, or the phase result.
// =============================================================================

import {
  openPostPlayAndRunUpNext,
  advanceToNextEpisode,
} from "@/app/playback/playback-auto-advance";
import { applyPlaybackControlAction } from "@/app/playback/playback-control-actions";
import {
  armEpisodeResolve,
  createEpisodeAttempt,
  resolveEpisodeSourceAuthority,
} from "@/app/playback/playback-episode-attempt";
import { loadEpisodeContext } from "@/app/playback/playback-episode-context";
import { persistEpisodeHistory } from "@/app/playback/playback-history-persist";
import { createNextEpisodePrefetch } from "@/app/playback/playback-next-episode-prefetch";
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
import { runPostPlayMenu } from "@/app/playback/playback-post-play-entry";
import { recoverAfterPlayback } from "@/app/playback/playback-recovery";
import { acquireEpisodeStream } from "@/app/playback/playback-stream-acquire";
import { offerPrePlayConfirm, readyEpisodeStream } from "@/app/playback/playback-stream-ready";

export async function runEpisodeIteration(loop: PlaybackLoopState): Promise<PlaybackIterationStep> {
  const { context, host, title, run, queueAttempt, invalidateRecentEpisodeStream } = loop;
  const { container } = context;
  const { stateManager, config, diagnosticsService, playerControl, workControl } = container;

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
    run.recoveryQualityCeiling = null;
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

  // From here until the iteration ends, Esc / provider skip / recover cancel
  // this episode's resolve (with intent) and a session stop aborts it.
  const resolve = armEpisodeResolve(loop, currentEpisode);
  const { controller: resolveController, abortOnSessionStop } = resolve;

  try {
    // 1. Who owns this episode: a verified local file or a provider adapter.
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
    const { recordStartupMark } = attempt;
    recordStartupMark("episode-bootstrap-started");

    // 2. Episode metadata, then a playable stream, then ready for the player.
    const episodeContext = await loadEpisodeContext(loop, attempt);
    const acquired = await acquireEpisodeStream(loop, attempt, episodeContext);
    if (acquired.kind === "exit") return acquired.step;
    const ready = await readyEpisodeStream(loop, attempt, episodeContext, acquired);
    const { preparedStream } = ready;
    if ((await offerPrePlayConfirm(loop, attempt, preparedStream)) === NEXT_ITERATION) {
      return NEXT_ITERATION;
    }

    // 3. Play it; the next episode prefetches near EOF.
    const nextEpisodePrefetch = createNextEpisodePrefetch(loop, attempt, episodeContext, ready);
    const played = await playEpisode(loop, attempt, ready, nextEpisodePrefetch);
    if (played.kind === "exit") return played.step;
    const { result } = played;

    // 4. Record what the episode achieved, then recover a failed stream.
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

    // 5. Act on the control the user pressed, else auto-advance, Up Next and
    //    finally the post-play menu.
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
    const catalogAdvance = await advanceToNextEpisode(
      loop,
      attempt,
      episodeContext,
      ready,
      nextEpisodePrefetch,
      result,
    );
    if (catalogAdvance.kind === "exit") return catalogAdvance.step;
    const upNext = await openPostPlayAndRunUpNext(
      loop,
      attempt,
      episodeContext,
      nextEpisodePrefetch,
      result,
      catalogAdvance,
    );
    if (upNext.kind === "exit") return upNext.step;
    const postPlayStep = await runPostPlayMenu(
      loop,
      attempt,
      episodeContext,
      ready,
      nextEpisodePrefetch,
      result,
      catalogAdvance,
      upNext,
    );
    if (postPlayStep) return postPlayStep;
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
