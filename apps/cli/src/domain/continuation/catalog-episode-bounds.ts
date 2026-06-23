import type { HistoryProgress } from "@kunai/storage";
import type { ReleaseProgressProjection } from "@kunai/storage";

/** Known catalog end for a season (or absolute anime list). */
export type CatalogEpisodeBounds = {
  readonly season?: number;
  readonly latestEpisode: number;
};

export function anchorEpisodeRef(entry: HistoryProgress): { season: number; episode: number } {
  return {
    season: entry.season ?? 1,
    episode: entry.episode ?? entry.absoluteEpisode ?? 1,
  };
}

export function catalogBoundsFromReleaseProjection(
  projection: ReleaseProgressProjection | undefined,
): CatalogEpisodeBounds | null {
  if (!projection) return null;
  const latestEpisode = projection.latestAiredEpisode;
  if (typeof latestEpisode !== "number" || latestEpisode <= 0) return null;
  return {
    season: projection.latestAiredSeason ?? 1,
    latestEpisode,
  };
}

export function catalogBoundsFromEpisodeCount(
  season: number,
  episodeCount: number,
): CatalogEpisodeBounds | null {
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return null;
  return { season, latestEpisode: episodeCount };
}

export function isAtOrPastCatalogEnd(
  anchor: { season: number; episode: number },
  bounds: CatalogEpisodeBounds | null | undefined,
): boolean {
  if (!bounds || bounds.latestEpisode <= 0) return false;
  const boundsSeason = bounds.season ?? anchor.season;
  if (anchor.season > boundsSeason) return true;
  if (anchor.season < boundsSeason) return false;
  return anchor.episode >= bounds.latestEpisode;
}

/** Next episode within known catalog bounds, or null when the anchor is at the end. */
export function optimisticNextEpisodeWithinBounds(
  anchor: { season: number; episode: number },
  bounds: CatalogEpisodeBounds | null | undefined,
): { season: number; episode: number } | null {
  if (isAtOrPastCatalogEnd(anchor, bounds)) return null;
  const nextEpisode = anchor.episode + 1;
  const boundsSeason = bounds?.season ?? anchor.season;
  if (bounds && anchor.season === boundsSeason && nextEpisode > bounds.latestEpisode) {
    return null;
  }
  return { season: anchor.season, episode: nextEpisode };
}
