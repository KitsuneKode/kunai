import type { PlaybackIteration } from "@/app/playback/playback-iteration";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import { startEpisodeNavigation } from "@/app/playback/playback-start-intent";
import type { EpisodeInfo } from "@/domain/types";

/** Stage provider-switch restart state after an in-menu provider change (B7). */
export function alignPostPlayProviderRestart(input: {
  readonly run: PlaybackRunState;
  readonly iteration: PlaybackIteration;
  readonly currentEpisode: EpisodeInfo;
  readonly nextProviderId: string;
  readonly resumeSeconds: number;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
}): void {
  input.run.sessionSoftProviderId = null;
  input.iteration.resolvedProviderId = input.nextProviderId;
  input.iteration.postPlayProviderId = input.nextProviderId;
  input.invalidateRecentEpisodeStream(input.currentEpisode);
  input.run.pendingSourceRefreshAction = "recover";
  input.run.pendingRecomputeSources = false;
  input.run.pendingStart = startEpisodeNavigation({
    targetResumeSeconds: input.resumeSeconds,
  });
}
