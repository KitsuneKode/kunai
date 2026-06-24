import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import type { EpisodeInfo } from "@/domain/types";

export type PlaybackControlSourceSelectionDeps = {
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
};

export async function applyPlaybackControlSourceSelection(input: {
  readonly providerId: string;
  readonly episode: EpisodeInfo;
  readonly selection: StreamSelectionIntent;
  readonly deps: PlaybackControlSourceSelectionDeps;
}): Promise<void> {
  if (input.selection.sourceId) {
    await input.deps.applyManualSourcePick(
      input.providerId,
      input.episode,
      input.selection.sourceId,
    );
    return;
  }
  await input.deps.applyEpisodeSelection(input.providerId, input.episode, input.selection);
}
