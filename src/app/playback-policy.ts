import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";

export function getAutoAdvanceEpisode(
  result: PlaybackResult,
  title: TitleInfo,
  currentEpisode: EpisodeInfo,
  autoNextEnabled: boolean,
): EpisodeInfo | null {
  if (!autoNextEnabled || result.endReason !== "eof" || title.type !== "series") {
    return null;
  }

  return {
    season: currentEpisode.season,
    episode: currentEpisode.episode + 1,
  };
}
