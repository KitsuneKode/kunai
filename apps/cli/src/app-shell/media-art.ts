// =============================================================================
// media-art.ts — season-aware artwork resolution with a graceful fallback chain
//
// One resolver feeds both the panel poster and the prev/now/next thumbnails so
// they never disagree. The chain degrades honestly instead of leaving a blank:
//   episode still → season poster → series poster → series backdrop → fallback
// Pure; no I/O. The poster pipeline (chafa/Kitty) consumes the returned url.
// =============================================================================

import { episodeThumbKey, type TitleDetail } from "@/domain/catalog/title-detail";

/**
 * Season-aware key art: prefer the season poster, then the series poster, then a
 * caller fallback (e.g. the title's own posterUrl), then the backdrop.
 */
export function resolveSeasonAwarePosterUrl(input: {
  readonly titleDetail?: TitleDetail;
  readonly season?: number;
  readonly fallbackPosterUrl?: string;
}): string | undefined {
  const art = input.titleDetail?.artwork;
  if (input.season !== undefined && art?.seasonPosters?.[input.season]) {
    return art.seasonPosters[input.season];
  }
  return art?.poster ?? input.fallbackPosterUrl ?? art?.backdrop;
}

/**
 * Episode thumbnail with a graceful fallback so a card always renders art:
 * explicit episode artwork → catalog episode still → season poster → series
 * poster/backdrop → caller fallback. Returns `undefined` only when nothing at
 * all is known (callers then show the petal placeholder).
 */
export function resolveEpisodeThumbUrl(input: {
  readonly titleDetail?: TitleDetail;
  readonly season?: number;
  readonly episode?: number;
  /** Provider/catalog episode thumbnail carried on EpisodeInfo.artwork. */
  readonly episodeArtworkUrl?: string;
  readonly fallbackPosterUrl?: string;
}): string | undefined {
  if (input.episodeArtworkUrl) return input.episodeArtworkUrl;
  const art = input.titleDetail?.artwork;
  if (input.season !== undefined && input.episode !== undefined && art?.episodeThumbnails) {
    const still = art.episodeThumbnails[episodeThumbKey(input.season, input.episode)];
    if (still) return still;
  }
  return resolveSeasonAwarePosterUrl({
    titleDetail: input.titleDetail,
    season: input.season,
    fallbackPosterUrl: input.fallbackPosterUrl,
  });
}
