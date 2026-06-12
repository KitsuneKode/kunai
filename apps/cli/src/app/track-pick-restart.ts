import {
  startAtResumePoint,
  startEpisodeNavigation,
  type PlaybackStartIntent,
} from "@/app/playback-start-intent";
import type { StreamSelectionIntent } from "@/app/source-quality";
import type { TracksPanelPickResult } from "@/app/tracks-panel-pick";
import type { EpisodeInfo } from "@/domain/types";

export type TrackPickRestartEffects = {
  readonly applyManualSourcePick: (
    providerId: string,
    episode: EpisodeInfo,
    sourceId: string,
  ) => Promise<void>;
  readonly applyEpisodeSelection: (
    providerId: string,
    episode: EpisodeInfo,
    selection: StreamSelectionIntent,
  ) => Promise<void>;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
  readonly prepareStreamSwitchRestart: (episode: EpisodeInfo) => Promise<void>;
};

export type TrackPickRestartOutcome = {
  readonly startIntent: PlaybackStartIntent;
  readonly resolvedProviderId: string;
  readonly requiresFreshResolve: boolean;
};

export async function applyTrackPickRestart(input: {
  readonly resolved: TracksPanelPickResult;
  readonly currentProviderId: string;
  readonly episode: EpisodeInfo;
  readonly resumeSeconds: number;
  readonly effects: TrackPickRestartEffects;
}): Promise<TrackPickRestartOutcome> {
  const { resolved, currentProviderId, episode, resumeSeconds, effects } = input;

  if (resolved.kind === "noop") {
    return {
      startIntent: startAtResumePoint(resumeSeconds, { suppressResumePrompt: true }),
      resolvedProviderId: currentProviderId,
      requiresFreshResolve: false,
    };
  }

  if (resolved.kind === "provider-switch") {
    effects.invalidateRecentEpisodeStream(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      resolvedProviderId: resolved.providerId,
      requiresFreshResolve: true,
    };
  }

  if (resolved.kind === "audio-mode-switch") {
    effects.invalidateRecentEpisodeStream(episode);
    await effects.prepareStreamSwitchRestart(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      resolvedProviderId: currentProviderId,
      requiresFreshResolve: true,
    };
  }

  if (resolved.kind === "cross-provider-source") {
    await effects.applyManualSourcePick(resolved.providerId, episode, resolved.sourceId);
    effects.invalidateRecentEpisodeStream(episode);
    await effects.prepareStreamSwitchRestart(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      resolvedProviderId: resolved.providerId,
      requiresFreshResolve: true,
    };
  }

  const { section, selection } = resolved;
  if (section === "source" && selection.sourceId) {
    await effects.applyManualSourcePick(currentProviderId, episode, selection.sourceId);
    await effects.prepareStreamSwitchRestart(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      resolvedProviderId: currentProviderId,
      requiresFreshResolve: true,
    };
  }

  await effects.applyEpisodeSelection(currentProviderId, episode, selection);
  return {
    startIntent: startAtResumePoint(resumeSeconds, { suppressResumePrompt: true }),
    resolvedProviderId: currentProviderId,
    requiresFreshResolve: false,
  };
}
