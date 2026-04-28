import type { EpisodeNavigationState } from "@/domain/session/SessionState";
import type { EpisodeInfo, EpisodePickerOption, PlaybackResult, TitleInfo } from "@/domain/types";

type CatalogEpisode = {
  number: number;
  name: string;
  airDate: string;
  overview: string;
};

export type EpisodeCatalogLoaders = {
  loadSeasons: (titleId: string) => Promise<readonly number[]>;
  loadEpisodes: (titleId: string, season: number) => Promise<readonly CatalogEpisode[]>;
};

function isReleased(episode: CatalogEpisode): boolean {
  if (!episode.airDate) return true;
  // If airDate is just a year "2024", new Date("2024") parses to Jan 1, 2024 UTC.
  const airTime = new Date(episode.airDate).getTime();
  if (isNaN(airTime)) return true;
  return airTime <= Date.now();
}

export type EpisodeAvailability = {
  previousEpisode: EpisodeInfo | null;
  nextEpisode: EpisodeInfo | null;
  nextSeasonEpisode: EpisodeInfo | null;
};

type AvailabilityArgs = {
  title: TitleInfo;
  currentEpisode: EpisodeInfo;
  isAnime: boolean;
  animeEpisodeCount?: number;
  animeEpisodes?: readonly EpisodePickerOption[];
  loaders: EpisodeCatalogLoaders;
};

function toEpisodeInfo(episode: CatalogEpisode, season: number): EpisodeInfo {
  return {
    season,
    episode: episode.number,
    name: episode.name,
    airDate: episode.airDate,
    overview: episode.overview,
  };
}

function formatEpisodeLabel(episode: EpisodeInfo): string {
  return `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`;
}

export async function resolveEpisodeAvailability({
  title,
  currentEpisode,
  isAnime,
  animeEpisodeCount,
  animeEpisodes,
  loaders,
}: AvailabilityArgs): Promise<EpisodeAvailability> {
  if (title.type !== "series") {
    return {
      previousEpisode: null,
      nextEpisode: null,
      nextSeasonEpisode: null,
    };
  }

  if (isAnime) {
    const orderedEpisodes = [...(animeEpisodes ?? [])].sort((a, b) => a.index - b.index);
    const previousOption = [...orderedEpisodes]
      .reverse()
      .find((option) => option.index < currentEpisode.episode);
    const nextOption = orderedEpisodes.find((option) => option.index > currentEpisode.episode);
    const fallbackMax =
      animeEpisodeCount ?? orderedEpisodes[orderedEpisodes.length - 1]?.index ?? 0;
    const nextFallbackEpisode =
      !nextOption && currentEpisode.episode < fallbackMax
        ? { season: 1, episode: currentEpisode.episode + 1 }
        : null;
    const previousFallbackEpisode =
      !previousOption && currentEpisode.episode > 1
        ? { season: 1, episode: currentEpisode.episode - 1 }
        : null;

    return {
      previousEpisode: previousOption
        ? { season: 1, episode: previousOption.index }
        : previousFallbackEpisode,
      nextEpisode: nextOption ? { season: 1, episode: nextOption.index } : nextFallbackEpisode,
      nextSeasonEpisode: null,
    };
  }

  const currentSeasonEpisodes = [...(await loaders.loadEpisodes(title.id, currentEpisode.season))]
    .filter(isReleased)
    .sort((a, b) => a.number - b.number);
  const seasons = [...(await loaders.loadSeasons(title.id))].sort((a, b) => a - b);

  const previousInSeason = [...currentSeasonEpisodes]
    .reverse()
    .find((episode) => episode.number < currentEpisode.episode);
  const nextInSeason = currentSeasonEpisodes.find(
    (episode) => episode.number > currentEpisode.episode,
  );

  const previousSeasonNumber = [...seasons]
    .reverse()
    .find((season) => season < currentEpisode.season);
  const nextSeasonNumber = seasons.find((season) => season > currentEpisode.season);

  const previousSeasonEpisodes = previousSeasonNumber
    ? [...(await loaders.loadEpisodes(title.id, previousSeasonNumber))]
        .filter(isReleased)
        .sort((a, b) => a.number - b.number)
    : [];
  const nextSeasonEpisodes = nextSeasonNumber
    ? [...(await loaders.loadEpisodes(title.id, nextSeasonNumber))]
        .filter(isReleased)
        .sort((a, b) => a.number - b.number)
    : [];

  const previousEpisode = previousInSeason
    ? toEpisodeInfo(previousInSeason, currentEpisode.season)
    : previousSeasonNumber && previousSeasonEpisodes.length > 0
      ? toEpisodeInfo(
          previousSeasonEpisodes[previousSeasonEpisodes.length - 1]!,
          previousSeasonNumber,
        )
      : null;

  const nextSeasonEpisode =
    nextSeasonNumber && nextSeasonEpisodes.length > 0
      ? toEpisodeInfo(nextSeasonEpisodes[0]!, nextSeasonNumber)
      : null;

  const nextEpisode = nextInSeason
    ? toEpisodeInfo(nextInSeason, currentEpisode.season)
    : nextSeasonEpisode;

  return {
    previousEpisode,
    nextEpisode,
    nextSeasonEpisode,
  };
}

export function toEpisodeNavigationState(
  type: TitleInfo["type"],
  availability: EpisodeAvailability,
): EpisodeNavigationState {
  if (type !== "series") {
    return {
      hasPrevious: false,
      hasNext: false,
      hasNextSeason: false,
      previousUnavailableReason: "Previous episode is only available for episodic playback.",
      nextUnavailableReason: "Next episode is only available for episodic playback.",
      nextSeasonUnavailableReason: "Season jump is only available for episodic playback.",
    };
  }

  return {
    hasPrevious: availability.previousEpisode !== null,
    hasNext: availability.nextEpisode !== null,
    hasNextSeason: availability.nextSeasonEpisode !== null,
    previousLabel: availability.previousEpisode
      ? formatEpisodeLabel(availability.previousEpisode)
      : undefined,
    nextLabel: availability.nextEpisode ? formatEpisodeLabel(availability.nextEpisode) : undefined,
    nextSeasonLabel: availability.nextSeasonEpisode
      ? formatEpisodeLabel(availability.nextSeasonEpisode)
      : undefined,
    previousUnavailableReason:
      availability.previousEpisode === null ? "Already at the first released episode." : undefined,
    nextUnavailableReason:
      availability.nextEpisode === null ? "Already at the latest released episode." : undefined,
    nextSeasonUnavailableReason:
      availability.nextSeasonEpisode === null
        ? "No later released season is available."
        : undefined,
  };
}

export async function getAutoAdvanceEpisode(
  result: PlaybackResult,
  title: TitleInfo,
  currentEpisode: EpisodeInfo,
  autoNextEnabled: boolean,
  availability: EpisodeAvailability,
): Promise<EpisodeInfo | null> {
  const nearNaturalEnd =
    result.duration > 0 &&
    result.watchedSeconds > 0 &&
    result.watchedSeconds >= Math.max(result.duration - 8, Math.floor(result.duration * 0.97));

  if (
    !autoNextEnabled ||
    title.type !== "series" ||
    (result.endReason !== "eof" && !nearNaturalEnd)
  ) {
    return null;
  }

  if (
    availability.nextEpisode &&
    availability.nextEpisode.season === currentEpisode.season &&
    availability.nextEpisode.episode === currentEpisode.episode
  ) {
    return null;
  }

  return availability.nextEpisode;
}
