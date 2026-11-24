// =============================================================================
// Playback presence writers
//
// Background presence updates for an active playback. Each write re-reads the
// authoritative playback status right before the external call, so a queued
// update from a superseded generation is dropped instead of overwriting newer
// state.
// =============================================================================
import { isPlaybackPresenceUpdateCurrent } from "@/app/playback/playback-presence-freshness";
import { type PlaybackStatusSnapshot } from "@/app/playback/playback-status-policy";
import type { PhaseContext } from "@/app/session/Phase";
import { peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import { type DiagnosticCorrelation } from "@/services/diagnostics/correlation";

export function updatePresenceInBackground(
  context: PhaseContext,
  task: string,
  activity: Parameters<PhaseContext["container"]["presence"]["updatePlayback"]>[0],
  expected: PlaybackStatusSnapshot | null,
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
    run: () => {
      const state = context.container.stateManager.getState();
      // Read authoritative state immediately before the external mutation:
      // this task was queued, and the session may have moved on since.
      if (
        expected &&
        !isPlaybackPresenceUpdateCurrent(
          { status: state.playbackStatus, generation: state.playbackGeneration },
          expected,
        )
      ) {
        return Promise.resolve();
      }
      const shellTitle = state.currentTitle;
      const detailPoster = peekTitleDetail(activity.title.id, activity.title.type)?.artwork?.poster;
      const enrichedTitle =
        shellTitle && shellTitle.id === activity.title.id
          ? {
              ...activity.title,
              posterUrl:
                activity.title.posterUrl ?? shellTitle.posterUrl ?? detailPoster ?? undefined,
              artwork: activity.title.artwork ?? shellTitle.artwork,
            }
          : detailPoster
            ? {
                ...activity.title,
                posterUrl: activity.title.posterUrl ?? detailPoster,
              }
            : activity.title;
      return context.container.presence.updatePlayback({
        ...activity,
        title: enrichedTitle,
      });
    },
  });
}

export function clearPresenceInBackground(
  context: PhaseContext,
  task: string,
  reason: string,
  correlation?: DiagnosticCorrelation,
): void {
  runBackgroundTask({
    task,
    category: "presence",
    diagnostics: context.container.diagnosticsService,
    context: { ...correlation, reason },
    run: () => context.container.presence.clearPlayback(reason),
  });
}
