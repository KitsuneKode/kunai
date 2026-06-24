import { buildShareRefFromTitleContext } from "@/app/bootstrap/share-ref-from-context";
import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import {
  encodePlaybackTargetRef,
  type PlaybackTargetRef,
} from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";

import type { PresencePlaybackActivity } from "./PresenceService";

export type DiscordCatalogLink = {
  readonly label: string;
  readonly url: string;
};

export function buildShareRefForActivity(
  activity: PresencePlaybackActivity,
): PlaybackTargetRef | null {
  return buildShareRefFromTitleContext({
    mode: activity.mode,
    title: activity.title,
    episode: activity.episode,
    providerId: activity.providerId,
  });
}

export function buildPlayableShareUrlForActivity(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private",
): string | null {
  if (privacy === "private") return null;
  const ref = buildShareRefForActivity(activity);
  return ref ? encodePlaybackTargetRef(ref) : null;
}

export function buildCatalogViewLink(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "year" | "externalIds">;
  readonly mode: ShellMode;
}): DiscordCatalogLink | null {
  const anilistId = resolveAnilistId(input.title);
  if ((input.mode === "anime" || input.title.id.startsWith("anilist:")) && anilistId) {
    return {
      label: "View on AniList",
      url: `https://anilist.co/anime/${anilistId}`,
    };
  }

  const imdbId = input.title.externalIds?.imdbId?.trim();
  if (imdbId) {
    const normalized = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
    return {
      label: "View on IMDb",
      url: `https://www.imdb.com/title/${normalized}/`,
    };
  }

  const tmdbId = resolveTmdbId(input.title);
  if (tmdbId) {
    const segment = input.title.type === "movie" ? "movie" : "tv";
    return {
      label: "View on TMDB",
      url: `https://www.themoviedb.org/${segment}/${tmdbId}`,
    };
  }

  return null;
}

export function buildCatalogEpisodeLink(
  activity: PresencePlaybackActivity,
): DiscordCatalogLink | null {
  if (activity.title.type !== "series") return null;

  const tmdbId = resolveTmdbId(activity.title);
  if (tmdbId) {
    return {
      label: "View episode on TMDB",
      url: `https://www.themoviedb.org/tv/${tmdbId}/season/${activity.episode.season}/episode/${activity.episode.episode}`,
    };
  }

  const anilistId = resolveAnilistId(activity.title);
  if ((activity.mode === "anime" || activity.title.id.startsWith("anilist:")) && anilistId) {
    return {
      label: "View on AniList",
      url: `https://anilist.co/anime/${anilistId}`,
    };
  }

  return null;
}

export function buildBestCatalogLink(
  activity: PresencePlaybackActivity,
): DiscordCatalogLink | null {
  return buildCatalogEpisodeLink(activity) ?? buildCatalogViewLink(activity);
}

export function buildDiscordPresenceButtons(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private",
): readonly { label: string; url: string }[] {
  if (privacy === "private") return [];

  const catalog = buildBestCatalogLink(activity);
  return catalog ? [catalog] : [];
}

export function buildDiscordActivityUrlFields(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private" = "full",
): Record<string, string> {
  const viewLink = buildCatalogViewLink({ mode: activity.mode, title: activity.title });
  const episodeLink = buildCatalogEpisodeLink(activity);
  const stateLink = episodeLink ?? viewLink;
  const fields: Record<string, string> = {};
  if (viewLink) fields.details_url = viewLink.url;
  if (stateLink) fields.state_url = stateLink.url;
  const playable = buildPlayableShareUrlForActivity(activity, privacy);
  if (playable) fields.playable_ref = playable;
  return fields;
}

function resolveDiscordArtworkUrl(...candidates: readonly (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    const resolved = resolveCatalogPosterUrl(candidate);
    if (resolved) return resolved;
  }
  return null;
}

export type DiscordPosterFallbackReason =
  | "missing-artwork"
  | "relative-tmdb-path"
  | "non-https"
  | "unresolved";

export function explainDiscordPosterFallbackReason(
  ...candidates: readonly (string | undefined)[]
): DiscordPosterFallbackReason {
  const trimmedCandidates = candidates
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));
  if (trimmedCandidates.length === 0) return "missing-artwork";
  if (trimmedCandidates.some((candidate) => candidate.startsWith("/"))) {
    return "relative-tmdb-path";
  }
  if (trimmedCandidates.some((candidate) => candidate.startsWith("http://"))) {
    return "non-https";
  }
  return "unresolved";
}

export function buildDiscordPosterAsset(
  title: Pick<TitleInfo, "posterUrl" | "artwork" | "name" | "year">,
  episode?: Pick<EpisodeInfo, "artwork">,
): {
  readonly large_image: string;
  readonly large_text: string;
  readonly large_url?: string;
  readonly fallbackReason?: DiscordPosterFallbackReason;
} {
  const candidates = [
    title.posterUrl,
    title.artwork?.posterUrl,
    title.artwork?.thumbnailUrl,
    title.artwork?.backdropUrl,
    episode?.artwork?.posterUrl,
    episode?.artwork?.thumbnailUrl,
    episode?.artwork?.backdropUrl,
  ] as const;
  const posterUrl = resolveDiscordArtworkUrl(...candidates);
  const hover = compact([title.name, title.year]).join(" · ") || "Kunai";
  if (posterUrl) {
    return { large_image: posterUrl, large_text: hover };
  }
  return {
    large_image: "kunai",
    large_text: hover,
    fallbackReason: explainDiscordPosterFallbackReason(...candidates),
  };
}

function resolveAnilistId(title: Pick<TitleInfo, "id" | "externalIds">): string | null {
  const fromExternal = title.externalIds?.anilistId?.trim();
  if (fromExternal) return fromExternal;
  const match = /^anilist:(\d+)$/.exec(title.id.trim());
  return match?.[1] ?? null;
}

function resolveTmdbId(title: Pick<TitleInfo, "id" | "externalIds">): string | null {
  const fromExternal = title.externalIds?.tmdbId?.trim();
  if (fromExternal) return fromExternal;
  const match = /^tmdb:(\d+)$/.exec(title.id.trim());
  return match?.[1] ?? null;
}

function compact(values: readonly (string | undefined | null | false)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}
