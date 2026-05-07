import type { EpisodeNavigationState } from "@/domain/session/SessionState";
import type {
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackResult,
  PlaybackTimingMetadata,
  TitleInfo,
} from "@/domain/types";

export type QuitNearEndBehavior = "continue" | "pause";

export type QuitNearEndThresholdMode = "credits-or-90-percent" | "percent-only" | "seconds-only";

export interface PlaybackEndPolicy {
  readonly quitNearEndBehavior: QuitNearEndBehavior;
  readonly quitNearEndThresholdMode: QuitNearEndThresholdMode;
}

export const DEFAULT_PLAYBACK_END_POLICY: PlaybackEndPolicy = {
  quitNearEndBehavior: "continue",
  quitNearEndThresholdMode: "credits-or-90-percent",
};

type CatalogEpisode = {
  number: number;
  name: string;
  airDate: string;
  overview: string;
};

export type EpisodeCatalogLoaders = {
  loadSeasons: (titleId: string) => Promise<readonly number[] | null>;
  loadEpisodes: (titleId: string, season: number) => Promise<readonly CatalogEpisode[] | null>;
};

function isReleased(episode: CatalogEpisode): boolean {
  if (!episode.airDate) return true;
  // If airDate is just a year "2024", new Date("2024") parses to Jan 1, 2024 UTC.
  const airTime = new Date(episode.airDate).getTime();
  if (isNaN(airTime)) return true;
  return airTime <= Date.now();
}

/** First strictly-after-current catalog slot that is not released (TMDB series path only; otherwise null). */
export type CatalogUpcomingEpisode = {
  readonly season: number;
  readonly episode: number;
  /** ISO-ish TMDB string when present; null when metadata has no usable date. */
  readonly airDate: string | null;
  readonly name?: string;
};

export type EpisodeAvailability = {
  previousEpisode: EpisodeInfo | null;
  nextEpisode: EpisodeInfo | null;
  nextSeasonEpisode: EpisodeInfo | null;
  upcomingNext: CatalogUpcomingEpisode | null;
  /**
   * Anime: no explicit next list index after current while the title is not provably
   * at the catalog end (episode count and/or max listed index). Autoplay stays off.
   */
  animeNextReleaseUnknown: boolean;
  /** True when TMDB returned null for seasons or episodes — network unreachable. */
  tmdbUnavailable: boolean;
};

export function getCompletionThresholdSeconds(
  duration: number,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): number {
  if (duration <= 0) return 0;

  if (thresholdMode === "seconds-only") {
    return Math.max(0, duration - 5);
  }
  if (thresholdMode === "percent-only") {
    return Math.max(0, duration * 0.95);
  }

  const creditsStartSeconds = getCreditsStartSeconds(duration, timing);
  if (creditsStartSeconds !== null) {
    return creditsStartSeconds;
  }

  return Math.max(0, duration - 5);
}

export function didPlaybackReachCompletionThreshold(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean {
  if (result.endReason !== "eof" && result.endReason !== "quit") return false;

  const trusted = result.lastTrustedProgressSeconds;
  const watchedSeconds =
    typeof trusted === "number" && Number.isFinite(trusted) && trusted > 0
      ? Math.min(result.watchedSeconds, trusted)
      : result.watchedSeconds;

  return (
    result.duration > 0 &&
    watchedSeconds > 0 &&
    watchedSeconds >= getCompletionThresholdSeconds(result.duration, timing, thresholdMode)
  );
}

export function didPlaybackEndNearNaturalEnd(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean {
  if (didPlaybackReachCompletionThreshold(result, timing, thresholdMode)) return true;

  // Fallback for sources where mpv never reports a reliable duration (HLS/m3u8).
  // If the last known non-zero position is ≥ 95% of the last known non-zero duration,
  // treat playback as having ended near the natural end.
  const pos = result.lastTrustedProgressSeconds ?? result.lastNonZeroPositionSeconds ?? 0;
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

function seasonEpisodeTag(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function normalizedCatalogAirDate(airDate: string | undefined): string | null {
  const trimmed = airDate?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function formatCatalogAirDateLabel(airDate: string): string {
  const t = new Date(airDate).getTime();
  if (Number.isNaN(t)) return airDate;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(t);
}

async function resolveCatalogUpcomingNext(
  titleId: string,
  currentEpisode: EpisodeInfo,
  seasons: readonly number[],
  loaders: EpisodeCatalogLoaders,
): Promise<CatalogUpcomingEpisode | null> {
  const seasonsAsc = [...seasons].sort((a, b) => a - b);
  for (const season of seasonsAsc) {
    if (season < currentEpisode.season) continue;
    const episodes = [...((await loaders.loadEpisodes(titleId, season)) ?? [])].sort(
      (a, b) => a.number - b.number,
    );
    for (const ep of episodes) {
      if (season === currentEpisode.season && ep.number <= currentEpisode.episode) continue;
      if (!isReleased(ep)) {
        return {
          season,
          episode: ep.number,
          airDate: normalizedCatalogAirDate(ep.airDate),
          name: ep.name || undefined,
        };
      }
    }
  }
  return null;
}

/** Short banner when autoplay stops because there is no released `nextEpisode`. */
export function describeAutoplayCatalogCaughtUpBanner(
  availability: EpisodeAvailability,
  isAnime: boolean,
): string | null {
  if (availability.nextEpisode !== null) return null;
  if (isAnime) {
    if (availability.animeNextReleaseUnknown) {
      return "Autoplay paused: next episode is not confirmed in the catalog yet (release timing unknown).";
    }
    return "Autoplay paused: last playable episode in this catalog. Anime release schedules are not shown ahead of streams here.";
  }
  const upcoming = availability.upcomingNext;
  if (upcoming?.airDate) {
    const tag = seasonEpisodeTag(upcoming.season, upcoming.episode);
    return `Autoplay paused: caught up through released episodes. ${tag} airs ${formatCatalogAirDateLabel(upcoming.airDate)}.`;
  }
  if (upcoming) {
    const tag = seasonEpisodeTag(upcoming.season, upcoming.episode);
    return `Autoplay paused: caught up through released episodes. Next listed ${tag} — air date unknown in metadata.`;
  }
  return "Autoplay paused: no further released episodes; catalog does not list a future instalment.";
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
      upcomingNext: null,
      animeNextReleaseUnknown: false,
      tmdbUnavailable: false,
    };
  }

  if (isAnime) {
    const orderedEpisodes = [...(animeEpisodes ?? [])].sort((a, b) => a.index - b.index);
    const previousOption = [...orderedEpisodes]
      .reverse()
      .find((option) => option.index < currentEpisode.episode);
    const nextOption = orderedEpisodes.find((option) => option.index > currentEpisode.episode);
    const maxListedIndex =
      orderedEpisodes.length > 0 ? Math.max(...orderedEpisodes.map((o) => o.index)) : null;
    const impliedCountCap = animeEpisodeCount ?? maxListedIndex;
    const atKnownCatalogEnd =
      typeof impliedCountCap === "number" && currentEpisode.episode >= impliedCountCap;
    const animeNextReleaseUnknown = nextOption === undefined && !atKnownCatalogEnd;

    const previousFallbackEpisode =
      !previousOption && currentEpisode.episode > 1
        ? { season: 1, episode: currentEpisode.episode - 1 }
        : null;

    return {
      previousEpisode: previousOption
        ? { season: 1, episode: previousOption.index }
        : previousFallbackEpisode,
      nextEpisode: nextOption ? { season: 1, episode: nextOption.index } : null,
      nextSeasonEpisode: null,
      upcomingNext: null,
      animeNextReleaseUnknown,
      tmdbUnavailable: false,
    };
  }

  const rawEpisodes = await loaders.loadEpisodes(title.id, currentEpisode.season);
  const rawSeasons = await loaders.loadSeasons(title.id);
  const tmdbUnavailable = rawEpisodes === null || rawSeasons === null;

  const currentSeasonEpisodes = [...(rawEpisodes ?? [])]
    .filter(isReleased)
    .sort((a, b) => a.number - b.number);
  const seasons = [...(rawSeasons ?? [])].sort((a, b) => a - b);

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
    ? [...((await loaders.loadEpisodes(title.id, previousSeasonNumber)) ?? [])]
        .filter(isReleased)
        .sort((a, b) => a.number - b.number)
    : [];
  const nextSeasonEpisodes = nextSeasonNumber
    ? [...((await loaders.loadEpisodes(title.id, nextSeasonNumber)) ?? [])]
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

  const upcomingNext =
    !tmdbUnavailable && nextEpisode === null
      ? await resolveCatalogUpcomingNext(title.id, currentEpisode, seasons, loaders)
      : null;

  return {
    previousEpisode,
    nextEpisode,
    nextSeasonEpisode,
    upcomingNext,
    animeNextReleaseUnknown: false,
    tmdbUnavailable,
  };
}

function describeSeriesNextUnavailableReason(
  availability: EpisodeAvailability,
  isAnime?: boolean,
): string {
  if (!isAnime) {
    const upcoming = availability.upcomingNext;
    if (upcoming) {
      const tag = seasonEpisodeTag(upcoming.season, upcoming.episode);
      const titleSuffix = upcoming.name ? ` "${upcoming.name}"` : "";
      if (upcoming.airDate) {
        return `Caught up through released episodes. ${tag}${titleSuffix} is not out yet (${formatCatalogAirDateLabel(upcoming.airDate)}).`;
      }
      return `Caught up through released episodes. ${tag}${titleSuffix} is listed but has no air date in metadata.`;
    }
    return "Already at the latest released episode.";
  }
  if (availability.animeNextReleaseUnknown) {
    return "Next episode is not listed in the catalog yet (release timing is unknown). Try Refresh after the provider updates.";
  }
  return "You're at the last episode in this provider catalog. Anime release timing is rarely listed ahead of playable sources.";
}

export function toEpisodeNavigationState(
  type: TitleInfo["type"],
  availability: EpisodeAvailability,
  options?: { isAnime?: boolean },
): EpisodeNavigationState {
  if (type !== "series") {
    return {
      hasPrevious: false,
      hasNext: false,
      hasNextSeason: false,
      hasUpcomingNext: false,
      previousUnavailableReason: "Previous episode is only available for episodic playback.",
      nextUnavailableReason: "Next episode is only available for episodic playback.",
      nextSeasonUnavailableReason: "Season jump is only available for episodic playback.",
    };
  }

  const hasUpcomingNext = availability.upcomingNext !== null;

  return {
    hasPrevious: availability.previousEpisode !== null,
    hasNext: availability.nextEpisode !== null,
    hasNextSeason: availability.nextSeasonEpisode !== null,
    hasUpcomingNext,
    previousLabel: availability.previousEpisode
      ? formatEpisodeLabel(availability.previousEpisode)
      : undefined,
    nextLabel: availability.nextEpisode ? formatEpisodeLabel(availability.nextEpisode) : undefined,
    nextSeasonLabel: availability.nextSeasonEpisode
      ? formatEpisodeLabel(availability.nextSeasonEpisode)
      : undefined,
    upcomingNextLabel: availability.upcomingNext
      ? seasonEpisodeTag(availability.upcomingNext.season, availability.upcomingNext.episode)
      : undefined,
    previousUnavailableReason:
      availability.previousEpisode === null ? "Already at the first released episode." : undefined,
    nextUnavailableReason:
      availability.nextEpisode === null
        ? describeSeriesNextUnavailableReason(availability, options?.isAnime)
        : undefined,
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
  endPolicy: PlaybackEndPolicy = DEFAULT_PLAYBACK_END_POLICY,
): Promise<EpisodeInfo | null> {
  const thresholdMode = endPolicy.quitNearEndThresholdMode;
  const nearNaturalEnd = didPlaybackEndNearNaturalEnd(result, timing, thresholdMode);

  const endAllowsAutoplayAdvance =
    result.endReason === "eof" ||
    (result.endReason === "quit" && endPolicy.quitNearEndBehavior === "continue" && nearNaturalEnd);

  if (!autoNextEnabled || title.type !== "series" || !endAllowsAutoplayAdvance) {
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
