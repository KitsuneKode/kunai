import type { EpisodeNavigationState } from "@/domain/session/SessionState";
import type {
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackResult,
  PlaybackTimingMetadata,
  TitleInfo,
} from "@/domain/types";

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

export function getCompletionThresholdSeconds(
  duration: number,
  timing?: PlaybackTimingMetadata | null,
): number {
  if (duration <= 0) return 0;

  const creditsStartSeconds = getCreditsStartSeconds(duration, timing);
  if (creditsStartSeconds !== null) {
    return creditsStartSeconds;
  }

  return Math.max(0, duration - 5);
}

export function didPlaybackReachCompletionThreshold(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
): boolean {
  return (
    result.duration > 0 &&
    result.watchedSeconds > 0 &&
    result.watchedSeconds >= getCompletionThresholdSeconds(result.duration, timing)
  );
}

export function didPlaybackEndNearNaturalEnd(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
): boolean {
  if (didPlaybackReachCompletionThreshold(result, timing)) return true;

  // Fallback for sources where mpv never reports a reliable duration (HLS/m3u8).
  // If the last known non-zero position is ≥ 95% of the last known non-zero duration,
  // treat playback as having ended near the natural end.
  const pos = result.lastNonZeroPositionSeconds ?? 0;
  const dur = result.lastNonZeroDurationSeconds ?? 0;
  if (dur > 30 && pos / dur >= 0.95) return true;

  return false;
}

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
    // If we have no episode list AND no count, be optimistic — assume there's
    // at least one more episode. Provider will naturally fail if the episode
    // doesn't exist, which is a better outcome than silently blocking autoplay.
    const fallbackMax =
      animeEpisodeCount ??
      orderedEpisodes[orderedEpisodes.length - 1]?.index ??
      currentEpisode.episode + 1;
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

  const lastPreviousEp = previousSeasonEpisodes[previousSeasonEpisodes.length - 1];
  const previousEpisode = previousInSeason
    ? toEpisodeInfo(previousInSeason, currentEpisode.season)
    : previousSeasonNumber && lastPreviousEp
      ? toEpisodeInfo(lastPreviousEp, previousSeasonNumber)
      : null;

  const firstNextSeasonEp = nextSeasonEpisodes[0];
  const nextSeasonEpisode =
    nextSeasonNumber && firstNextSeasonEp
      ? toEpisodeInfo(firstNextSeasonEp, nextSeasonNumber)
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
  timing?: PlaybackTimingMetadata | null,
): Promise<EpisodeInfo | null> {
  const nearNaturalEnd = didPlaybackEndNearNaturalEnd(result, timing);

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

function getCreditsStartSeconds(
  duration: number,
  timing?: PlaybackTimingMetadata | null,
): number | null {
  const candidates = (timing?.credits ?? [])
    .map((segment) => segment.startMs)
    .filter((startMs): startMs is number => typeof startMs === "number" && Number.isFinite(startMs))
    .map((startMs) => startMs / 1000)
    .filter((startSeconds) => startSeconds > 0 && startSeconds < duration)
    .sort((left, right) => right - left);

  return (
    candidates.find((startSeconds) => startSeconds >= Math.max(duration * 0.5, duration - 600)) ??
    null
  );
}
