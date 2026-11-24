// =============================================================================
// Player control actions after playback
//
// Acts on the control the user pressed in (or about) the player once the file
// has stopped: back to search, next/previous/picked episode (next adopts the
// prefetched stream), cycling source or audio, and the source / stream /
// quality picks — confirmed in mpv or chosen in the Tracks sheet. Each one
// restarts the loop with a new start intent; anything else falls through to
// auto-advance and post-play.
// =============================================================================

import { openTracksPanel } from "@/app-shell/workflows";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import type { NextEpisodePrefetch } from "@/app/playback/playback-next-episode-prefetch";
import {
  NEXT_ITERATION,
  type PlaybackIterationStep,
  type PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import type { PlaybackControlIntent } from "@/app/playback/playback-recovery";
import { startAtResumePoint } from "@/app/playback/playback-start-intent";
import type { ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import {
  streamSelectionFromTrackPick,
  type StreamSelectionIntent,
} from "@/app/playback/source-quality";
import { toHistoryTimestamp } from "@/domain/playback/playback-history";
import type { PlaybackResult } from "@/domain/types";
import type { ProviderResolveResult } from "@kunai/types";

/** Returns the step for a handled control action, or null to continue to auto-advance. */
export async function applyPlaybackControlAction(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  ready: ReadyEpisodeStream,
  prefetch: NextEpisodePrefetch,
  result: PlaybackResult,
  intent: PlaybackControlIntent,
): Promise<PlaybackIterationStep | null> {
  const { context, title, run, navigatePlaybackEpisode } = loop;
  const { container } = context;
  const { config } = container;
  const {
    currentEpisode,
    completeSourceTrackPick,
    applyConfirmedPlaybackTrackSelection,
    recordTrackOverrideSelected,
  } = attempt;
  const { episodeAvailability } = episodeContext;
  const { effectiveTiming, preparedStream } = ready;
  const { buildNextPrefetchTarget, handoffNextEpisodePrefetch } = prefetch;
  const { playbackControlAction, confirmedStreamSelection, confirmedEpisodeSelection } = intent;
  if (playbackControlAction === "back-to-search") {
    return { status: "success", value: "back_to_search" };
  }

  if (playbackControlAction === "next" && title.type === "series") {
    if (episodeAvailability.nextEpisode) {
      run.pendingStart = await navigatePlaybackEpisode(episodeAvailability.nextEpisode, {
        loadingOrder: "before-start",
        resetStopAfterCurrent: true,
        resumeInterruptedAutoplay: true,
      });
      const nextPrefetchTarget = buildNextPrefetchTarget();
      if (nextPrefetchTarget) {
        await handoffNextEpisodePrefetch(nextPrefetchTarget, "playback.prefetch-wait");
      }
      return NEXT_ITERATION;
    }
  }

  if (playbackControlAction === "previous" && title.type === "series") {
    if (episodeAvailability.previousEpisode) {
      run.pendingStart = await navigatePlaybackEpisode(episodeAvailability.previousEpisode, {
        cancelPrefetchReason: "user-navigation",
        loadingOrder: "after-start",
        resetStopAfterCurrent: true,
        resumeInterruptedAutoplay: true,
      });
      return NEXT_ITERATION;
    }
  }

  if (playbackControlAction === "pick-episode" && confirmedEpisodeSelection) {
    run.pendingStart = await navigatePlaybackEpisode(confirmedEpisodeSelection, {
      cancelPrefetchReason: "user-navigation",
      loadingOrder: "after-start",
      resetStopAfterCurrent: true,
      resumeInterruptedAutoplay: true,
    });
    return NEXT_ITERATION;
  }

  if (playbackControlAction === "cycle-source") {
    const resumePos = toHistoryTimestamp(
      result,
      effectiveTiming.current,
      config.quitNearEndThresholdMode,
    );
    const cycle = planSourceCycle(preparedStream.providerResolveResult);
    if (cycle.kind === "select") {
      run.pendingStart = await applyConfirmedPlaybackTrackSelection(
        "pick-source",
        cycle.selection,
        resumePos,
      );
      return NEXT_ITERATION;
    }
    if (cycle.kind === "refresh") {
      run.pendingSourceRefreshAction = "recover";
      run.pendingRecomputeSources = true;
      run.pendingStart = startAtResumePoint(resumePos, { suppressResumePrompt: true });
      return NEXT_ITERATION;
    }
  }

  if (playbackControlAction === "cycle-audio") {
    const resumePos = toHistoryTimestamp(
      result,
      effectiveTiming.current,
      config.quitNearEndThresholdMode,
    );
    const nextSelection = planAudioCycle(preparedStream.providerResolveResult);
    if (nextSelection) {
      run.pendingStart = await applyConfirmedPlaybackTrackSelection(
        "pick-stream",
        nextSelection,
        resumePos,
      );
      return NEXT_ITERATION;
    } else {
      run.pendingSourceRefreshAction = "recover";
      run.pendingStart = startAtResumePoint(resumePos, { suppressResumePrompt: true });
      return NEXT_ITERATION;
    }
  }

  if (playbackControlAction === "pick-source") {
    if (confirmedStreamSelection) {
      run.pendingStart = await applyConfirmedPlaybackTrackSelection(
        playbackControlAction,
        confirmedStreamSelection,
        toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
      );
      return NEXT_ITERATION;
    }
    const picked = await openTracksPanel(preparedStream, { initialSection: "source" }, container);
    const selection = picked ? streamSelectionFromTrackPick(picked) : null;
    if (picked && (selection || picked.section === "subtitle")) {
      const restartResume = toHistoryTimestamp(
        result,
        effectiveTiming.current,
        config.quitNearEndThresholdMode,
      );
      const trackStart = await completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        restartResume,
        "playback-control-track-override",
      );
      if (trackStart) {
        run.pendingStart = trackStart;
        if (selection) recordTrackOverrideSelected(picked, selection);
        return NEXT_ITERATION;
      }
    }
  }

  if (playbackControlAction === "pick-stream") {
    if (confirmedStreamSelection) {
      run.pendingStart = await applyConfirmedPlaybackTrackSelection(
        playbackControlAction,
        confirmedStreamSelection,
        toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
      );
      return NEXT_ITERATION;
    }
    const picked = await openTracksPanel(preparedStream, {}, container);
    const selection = picked ? streamSelectionFromTrackPick(picked) : null;
    if (picked && (selection || picked.section === "subtitle")) {
      const restartResume = toHistoryTimestamp(
        result,
        effectiveTiming.current,
        config.quitNearEndThresholdMode,
      );
      const trackStart = await completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        restartResume,
        "playback-control-track-override",
      );
      if (trackStart) {
        run.pendingStart = trackStart;
        if (selection) recordTrackOverrideSelected(picked, selection);
        return NEXT_ITERATION;
      }
    }
  }

  if (playbackControlAction === "pick-quality") {
    if (confirmedStreamSelection) {
      run.pendingStart = await applyConfirmedPlaybackTrackSelection(
        playbackControlAction,
        confirmedStreamSelection,
        toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
      );
      return NEXT_ITERATION;
    }
    const picked = await openTracksPanel(preparedStream, { initialSection: "quality" }, container);
    const selection = picked ? streamSelectionFromTrackPick(picked) : null;
    if (picked && (selection || picked.section === "subtitle")) {
      const restartResume = toHistoryTimestamp(
        result,
        effectiveTiming.current,
        config.quitNearEndThresholdMode,
      );
      const trackStart = await completeSourceTrackPick(
        currentEpisode,
        picked,
        selection,
        restartResume,
        "playback-control-track-override",
      );
      if (trackStart) {
        run.pendingStart = trackStart;
        if (selection) recordTrackOverrideSelected(picked, selection);
        return NEXT_ITERATION;
      }
    }
  }
  return null;
}

export type SourceCycle =
  | { readonly kind: "select"; readonly selection: StreamSelectionIntent }
  /** One stream or none: nothing to cycle to, so re-resolve fresh sources instead. */
  | { readonly kind: "refresh" }
  /** Several streams but no next one could be named; the action falls through. */
  | { readonly kind: "unavailable" };

/**
 * What "cycle source" moves to: the next distinct source id (wrapping), or —
 * when every stream shares one source — the next stream.
 */
export function planSourceCycle(resolveResult: ProviderResolveResult | undefined): SourceCycle {
  const streams = resolveResult?.streams ?? [];
  if (streams.length <= 1) return { kind: "refresh" };
  const currentStreamId = resolveResult?.selectedStreamId;
  const currentStream = streams.find((s) => s.id === currentStreamId);
  const currentSourceId = currentStream?.sourceId ?? currentStreamId;
  const availableSourceIds = Array.from(
    new Set(
      streams
        .map((s) => s.sourceId)
        .filter((id): id is string => id !== null && id !== undefined && id.length > 0),
    ),
  );

  if (availableSourceIds.length > 1) {
    const currentIndex = availableSourceIds.indexOf(currentSourceId ?? "");
    const nextIndex = (currentIndex + 1) % availableSourceIds.length;
    const nextSourceId = availableSourceIds[nextIndex];
    return nextSourceId
      ? { kind: "select", selection: { sourceId: nextSourceId, streamId: null } }
      : { kind: "unavailable" };
  }
  const currentIndex = streams.findIndex((s) => s.id === currentStreamId);
  const nextIndex = (currentIndex + 1) % streams.length;
  const nextStream = streams[nextIndex];
  return nextStream
    ? {
        kind: "select",
        selection: { sourceId: nextStream.sourceId ?? null, streamId: nextStream.id },
      }
    : { kind: "unavailable" };
}

/**
 * What "cycle audio" moves to: a stream with the other presentation (dub ↔
 * sub), judged by declared presentation or, failing that, audio languages.
 * Null when no stream offers the other one.
 */
export function planAudioCycle(
  resolveResult: ProviderResolveResult | undefined,
): StreamSelectionIntent | null {
  const streams = resolveResult?.streams ?? [];
  const currentStream = streams.find((s) => s.id === resolveResult?.selectedStreamId);
  const currentPresentation =
    currentStream?.presentation ?? (currentStream?.audioLanguages?.includes("en") ? "dub" : "sub");
  const targetPresentation = currentPresentation === "dub" ? "sub" : "dub";

  const matchingStream = streams.find((s) => {
    if (s.presentation) {
      return s.presentation === targetPresentation;
    }
    if (targetPresentation === "dub") {
      return s.audioLanguages?.includes("en");
    }
    return s.audioLanguages?.includes("ja") || !s.audioLanguages?.includes("en");
  });
  return matchingStream
    ? { sourceId: matchingStream.sourceId ?? null, streamId: matchingStream.id }
    : null;
}
