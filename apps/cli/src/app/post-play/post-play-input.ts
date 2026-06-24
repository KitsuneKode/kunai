import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import { formatCatalogAirDateLabel } from "@/domain/playback/playback-policy";
import type { PostPlayInput } from "@/domain/playback/post-play-state";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

export type PostPlayPlaybackContext = {
  readonly title: TitleInfo;
  readonly currentEpisode: EpisodeInfo;
  readonly availability: EpisodeAvailability;
  readonly isAnime: boolean;
  readonly nextAirDateHint?: string;
  /** False when mpv never meaningfully started (exit on load / quit in first seconds). */
  readonly playbackStarted?: boolean;
};

export function buildPostPlayInputFromPlaybackContext(
  context: PostPlayPlaybackContext,
): PostPlayInput {
  const { title, currentEpisode, availability, nextAirDateHint, playbackStarted } = context;

  if (title.type !== "series") {
    return {
      hasNextEpisode: false,
      isSeasonFinale: false,
      isSeriesComplete: true,
      isCaughtUpOnAiring: false,
      playbackStarted,
    };
  }

  const hasNextInSeason =
    availability.nextEpisode !== null && availability.nextEpisode.season === currentEpisode.season;

  const hasNextSeason = availability.nextSeasonEpisode !== null;

  const nextAirDate =
    nextAirDateHint ??
    (availability.upcomingNext?.airDate
      ? formatCatalogAirDateLabel(availability.upcomingNext.airDate)
      : undefined);

  const isCaughtUpOnAiring =
    availability.nextEpisode === null &&
    (availability.upcomingNext !== null ||
      availability.animeNextReleaseUnknown ||
      Boolean(nextAirDate));

  const isSeriesComplete =
    availability.nextEpisode === null &&
    availability.nextSeasonEpisode === null &&
    availability.upcomingNext === null &&
    !availability.animeNextReleaseUnknown;

  const isSeasonFinale =
    !hasNextInSeason && hasNextSeason && !isCaughtUpOnAiring && !isSeriesComplete;

  return {
    hasNextEpisode: hasNextInSeason,
    isSeasonFinale,
    isSeriesComplete,
    isCaughtUpOnAiring,
    hasNextSeason,
    nextAirDate,
    playbackStarted,
  };
}

export function buildPostPlayEpisodeLabel(
  title: TitleInfo,
  currentEpisode: EpisodeInfo,
  totalEpisodesInSeason?: number,
): string {
  if (title.type !== "series") {
    return "Movie";
  }
  const location = `S${String(currentEpisode.season).padStart(2, "0")}  ·  E${String(currentEpisode.episode).padStart(2, "0")}`;
  if (totalEpisodesInSeason && totalEpisodesInSeason > 0) {
    return `${location} of ${totalEpisodesInSeason}`;
  }
  return location;
}

export function buildPostPlayNextEpisodeLabel(
  nextEpisode: EpisodeInfo | null | undefined,
  episodeTitle?: string,
): string | undefined {
  if (!nextEpisode) return undefined;
  const tag = `S${String(nextEpisode.season).padStart(2, "0")} E${String(nextEpisode.episode).padStart(2, "0")}`;
  if (episodeTitle?.trim()) {
    const cleaned = episodeTitle.replace(/^▶\s*/, "").trim();
    return `${tag} — ${cleaned}`;
  }
  if (nextEpisode.name?.trim()) {
    return `${tag} — ${nextEpisode.name.trim()}`;
  }
  return tag;
}

/**
 * Display label for the cross-title queue head, used as the post-play "Up Next"
 * when the current title has no episode-chain next (series finished / movie).
 * Appends a SxxExx tag only for series entries that carry one.
 */
export function buildPostPlayQueueNextLabel(
  queueHead: QueueEntry | null | undefined,
): string | undefined {
  if (!queueHead) return undefined;
  const title = queueHead.title.trim();
  if (!title) return undefined;
  if (queueHead.mediaKind !== "movie" && queueHead.episode !== undefined) {
    const tag = `S${String(queueHead.season ?? 1).padStart(2, "0")}E${String(queueHead.episode).padStart(2, "0")}`;
    return `${title} · ${tag}`;
  }
  return title;
}
