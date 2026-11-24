// =============================================================================
// Playback stream readiness
//
// Takes an acquired stream to "ready": the HDR advisory, which provider the
// next episode should use, the episode timing (awaited, merged with provider
// timing, retried in the background when missing), subtitle preparation, the
// recent-stream memory used by backward navigation, and — once per session —
// the pre-play Tracks confirm.
// =============================================================================

import { openTracksPanel } from "@/app-shell/workflows";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import { type PlaybackLoopState, NEXT_ITERATION } from "@/app/playback/playback-phase-session";
import {
  resolvePlaybackProviderHandoff,
  type PlaybackProviderHandoff,
} from "@/app/playback/playback-provider-handoff";
import type { AcquiredEpisodeStream } from "@/app/playback/playback-stream-acquire";
import { preparePlaybackStream } from "@/app/playback/playback-stream-prepare";
import { shouldFetchPlaybackTiming } from "@/app/playback/playback-timing-fetch-policy";
import {
  playbackTimingCacheKey,
  retryTimingInBackground,
  getPlaybackTimingMetadata,
} from "@/app/playback/playback-timing-lookup";
import { recentPlaybackStreamKey } from "@/app/playback/recent-playback-stream";
import {
  buildPlaybackControlSummary,
  shouldOfferPrePlayConfirm,
  streamSelectionFromTrackPick,
} from "@/app/playback/source-quality";
import type { PlaybackTimingMetadata, StreamInfo } from "@/domain/types";
import { extractProviderNativeTiming, mergeTimingMetadata } from "@/infra/timing";
import { runBackgroundTask } from "@/services/diagnostics/background-task";

export type AcquiredStream = Extract<AcquiredEpisodeStream, { readonly kind: "stream" }>;

export type ReadyEpisodeStream = {
  /** Which provider served this episode and which one the next episode should use. */
  readonly providerHandoff: Pick<
    PlaybackProviderHandoff,
    "successfulProviderId" | "nextEpisodeProviderId"
  >;
  readonly playbackTiming: PlaybackTimingMetadata | null;
  /**
   * The best timing known so far — updated in place if the background retry
   * lands while the episode plays, so every post-playback decision uses it.
   */
  readonly effectiveTiming: { current: PlaybackTimingMetadata | null };
  readonly preparedStream: StreamInfo;
};

export async function readyEpisodeStream(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  acquired: AcquiredStream,
): Promise<ReadyEpisodeStream> {
  const { context, title, run, playbackTimingByEpisode, recentEpisodeStreams } = loop;
  const { container } = context;
  const { stateManager, config } = container;
  const { currentEpisode, sourceAuthority, sourceProviderId, recordStartupMark } = attempt;
  const { controller: resolveController } = attempt.resolve;
  const { playbackNetworkAllowed, configuredTimingProviderId, timingFetch } = episodeContext;
  const { stream, streamProvenance, prefetchWasPrepared } = acquired;
  if (container.player.capabilities.observation === "managed") {
    // Fire-and-forget: a capability gap is advice, never a startup gate.
    const noticeStream = stream;
    void import("./hdr-capability-notice")
      .then(({ resolveHdrCapabilityNotice }) =>
        resolveHdrCapabilityNotice(noticeStream, config.hdrMode),
      )
      .then((note) => (note ? updatePlaybackFeedback(context, { note }) : undefined))
      .catch(() => undefined);
  }
  const providerHandoff =
    sourceAuthority.kind === "provider"
      ? resolvePlaybackProviderHandoff({
          configuredProviderId: sourceProviderId,
          successfulProviderId: attempt.resolvedProviderId,
        })
      : { successfulProviderId: sourceProviderId, nextEpisodeProviderId: sourceProviderId };

  // Await timing — stream resolve takes much longer so this is nearly free.
  // If IntroDB timed out and returned null, schedule a background retry that
  // injects timing into the running player once it arrives.
  recordStartupMark("timing-wait-started", stream);
  const successfulTimingProviderId = providerHandoff.successfulProviderId;
  const fetchedPlaybackTiming =
    run.localEpisodeTiming ??
    (successfulTimingProviderId === configuredTimingProviderId
      ? await timingFetch
      : shouldFetchPlaybackTiming({
            networkAllowed: playbackNetworkAllowed,
            hasTiming: false,
          })
        ? await getPlaybackTimingMetadata(
            title,
            currentEpisode,
            playbackTimingByEpisode,
            resolveController.signal,
            stateManager.getState().mode === "anime",
            successfulTimingProviderId,
            container.diagnosticsService,
          )
        : null);
  run.localEpisodeTiming = null;
  recordStartupMark("timing-ready", stream);
  const playbackTiming = mergeTimingMetadata(
    fetchedPlaybackTiming,
    extractProviderNativeTiming(stream, title),
  );
  if (playbackTiming) {
    const timingCacheKey = playbackTimingCacheKey(
      title,
      currentEpisode,
      successfulTimingProviderId,
    );
    playbackTimingByEpisode.set(timingCacheKey, playbackTiming);
  }
  // effectiveTiming.current tracks the best timing we have — updated in-place
  // if the background retry resolves while the episode is playing, so all
  // post-playback decisions (history, autoNext, result classification) use it.
  const effectiveTiming = { current: playbackTiming };
  if (
    shouldFetchPlaybackTiming({
      networkAllowed: playbackNetworkAllowed,
      hasTiming: playbackTiming !== null,
    })
  ) {
    runBackgroundTask({
      task: "playback.retryTiming",
      category: "playback",
      diagnostics: container.diagnosticsService,
      context: {
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        providerId: successfulTimingProviderId,
      },
      run: () =>
        retryTimingInBackground(
          title,
          currentEpisode,
          container,
          effectiveTiming,
          playbackTimingByEpisode,
          stateManager.getState().mode === "anime",
          successfulTimingProviderId,
        ),
    });
  }

  const preparedStream =
    prefetchWasPrepared || streamProvenance === "local"
      ? stream
      : await preparePlaybackStream(stream, title, currentEpisode, context);
  recordStartupMark("stream-prepared", preparedStream);
  stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });

  const episodeKey = recentPlaybackStreamKey(title.id, currentEpisode);
  if (streamProvenance === "local") {
    if (run.localPlaybackSource) {
      recentEpisodeStreams.set(episodeKey, {
        stream: preparedStream,
        episode: currentEpisode,
        selectedProviderId: sourceProviderId,
        resolvedProviderId: attempt.resolvedProviderId,
        provenance: "local",
        localPlaybackSource: run.localPlaybackSource,
      });
    }
  } else {
    recentEpisodeStreams.set(episodeKey, {
      stream: preparedStream,
      episode: currentEpisode,
      selectedProviderId: sourceProviderId,
      resolvedProviderId: attempt.resolvedProviderId,
      provenance: streamProvenance,
    });
  }
  if (recentEpisodeStreams.size > 5) {
    const first = recentEpisodeStreams.keys().next().value;
    if (first !== undefined) recentEpisodeStreams.delete(first);
  }
  stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
  run.playbackSession = transitionPlaybackSession(context, run.playbackSession, "stream-ready", {
    titleId: title.id,
    season: currentEpisode.season,
    episode: currentEpisode.episode,
    provider: attempt.resolvedProviderId,
  });
  return { providerHandoff, playbackTiming, effectiveTiming, preparedStream };
}

/**
 * Pre-play confirm: with `prePlayConfirm` armed, the resolved inventory opens
 * in the Tracks sheet before mpv launches so the source/quality/track pick is
 * deliberate, not auto-taken. The pick becomes a restart intent through the
 * same machinery the post-play pick commands use; Esc falls through to the
 * resolved default. Returns NEXT_ITERATION when the pick restarts the episode.
 */
export async function offerPrePlayConfirm(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  preparedStream: StreamInfo,
): Promise<typeof NEXT_ITERATION | null> {
  const { context, run } = loop;
  const { container } = context;
  const { config } = container;
  const { currentEpisode, completeSourceTrackPick } = attempt;
  if (
    !loop.prePlayConfirmOffered &&
    shouldOfferPrePlayConfirm(config.prePlayConfirm, buildPlaybackControlSummary(preparedStream))
  ) {
    loop.prePlayConfirmOffered = true;
    const picked = await openTracksPanel(preparedStream, {}, container);
    const selection = picked ? streamSelectionFromTrackPick(picked) : null;
    if (picked && (selection || picked.section === "subtitle")) {
      const resumeSeconds = run.pendingStart.startAt || run.pendingStart.resumePromptAt;
      const trackStart = await completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        resumeSeconds,
        "pre-play-confirm",
      );
      if (trackStart) {
        run.pendingStart = trackStart;
        return NEXT_ITERATION;
      }
    }
  }
  return null;
}
