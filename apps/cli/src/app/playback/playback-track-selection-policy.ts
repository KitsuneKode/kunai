import { applyPlaybackControlSourceSelection } from "@/app/playback/playback-control-source-selection";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  type PlaybackStartIntent,
} from "@/app/playback/playback-start-intent";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import type { EpisodeInfo } from "@/domain/types";
import type { PlaybackPickerAction } from "@/infra/player/PlayerControlService";

export type PlaybackTrackSelectionEffects = {
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
  readonly prepareStreamSwitchRestart: (episode: EpisodeInfo) => Promise<void>;
};

export type PlaybackTrackSelectionDiagnostic = {
  readonly message: string;
  readonly context: {
    readonly sourceId?: string;
    readonly streamId?: string;
    readonly resumeSeconds: number;
  };
};

export type PlaybackTrackSelectionOutcome = {
  readonly startIntent: PlaybackStartIntent;
  readonly diagnostic: PlaybackTrackSelectionDiagnostic;
};

export async function applyPlaybackControlTrackSelection(input: {
  readonly action: PlaybackPickerAction;
  readonly providerId: string;
  readonly episode: EpisodeInfo;
  readonly selection: StreamSelectionIntent;
  readonly resumeSeconds: number;
  readonly effects: PlaybackTrackSelectionEffects;
}): Promise<PlaybackTrackSelectionOutcome> {
  const { action, providerId, episode, selection, resumeSeconds, effects } = input;

  if (action === "pick-source") {
    await applyPlaybackControlSourceSelection({
      providerId,
      episode,
      selection,
      deps: {
        applyManualSourcePick: effects.applyManualSourcePick,
        applyEpisodeSelection: effects.applyEpisodeSelection,
      },
    });
    await effects.prepareStreamSwitchRestart(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      diagnostic: {
        message: "Source override selected",
        context: { sourceId: selection.sourceId ?? undefined, resumeSeconds },
      },
    };
  }

  if (action === "pick-stream") {
    await effects.applyEpisodeSelection(providerId, episode, selection);
    await effects.prepareStreamSwitchRestart(episode);
    return {
      startIntent: startEpisodeNavigation({ targetResumeSeconds: resumeSeconds }),
      diagnostic: {
        message: "Stream override selected",
        context: { streamId: selection.streamId ?? undefined, resumeSeconds },
      },
    };
  }

  await effects.applyEpisodeSelection(providerId, episode, selection);
  return {
    startIntent: startAtResumePoint(resumeSeconds, { suppressResumePrompt: true }),
    diagnostic: {
      message: "Quality override selected",
      context: { streamId: selection.streamId ?? undefined, resumeSeconds },
    },
  };
}

export function buildTrackOverrideDiagnosticContext(input: {
  readonly section: string;
  readonly selection: StreamSelectionIntent;
}): {
  readonly section: string;
  readonly sourceId?: string;
  readonly streamId?: string;
} {
  return {
    section: input.section,
    sourceId: input.selection.sourceId ?? undefined,
    streamId: input.selection.streamId ?? undefined,
  };
}
