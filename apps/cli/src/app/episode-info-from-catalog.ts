import type { EpisodeInfo, EpisodePickerOption } from "@/domain/types";
import { lookupCachedEpisode } from "@/tmdb";

export function episodeInfoFromSelection(args: {
  season: number;
  episode: number;
  isAnime: boolean;
  titleId: string;
  animeEpisodes?: readonly EpisodePickerOption[];
}): EpisodeInfo {
  const { season, episode, isAnime, titleId, animeEpisodes } = args;

  if (isAnime) {
    const match = animeEpisodes?.find((row) => row.index === episode);
    return {
      season,
      episode,
      name: match?.name ?? match?.label,
    };
  }

  const cached = lookupCachedEpisode(titleId, season, episode);
  return {
    season,
    episode,
    name: cached?.name,
    airDate: cached?.airDate,
    overview: cached?.overview,
  };
}

export function episodeInfoFromAnimePickerOption(
  option: EpisodePickerOption,
  season = 1,
): EpisodeInfo {
  return {
    season,
    episode: option.index,
    name: option.name ?? option.label,
  };
}
