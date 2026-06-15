// =============================================================================
// create-history-metadata-resolver.ts — title-search backed metadata resolver
//
// History titles often carry a provider-opaque id (e.g. AllManga) with no catalog
// key, so the only way to recover a poster + external ids is a catalog title
// search. Matching is conservative — a wrong match would backfill the wrong ids and
// poison reconciliation — so we only accept a result whose normalised title equals
// or contains (a sequel-suffix tolerance) the history title.
// =============================================================================

import type { SearchResult } from "@/domain/types";
import type { MediaKind } from "@kunai/types";

import type { HistoryMetadataResolver, ResolvedHistoryMetadata } from "./HistoryMetadataHealer";
import type { HistoryHealTarget } from "./select-heal-targets";

const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342";

function toPosterUrl(posterPath: string | null | undefined): string | undefined {
  if (!posterPath) return undefined;
  if (/^https?:\/\//i.test(posterPath)) return posterPath;
  return `${TMDB_POSTER_BASE_URL}${posterPath}`;
}

/** Lowercase alphanumeric-only key for tolerant title comparison. */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isPlausibleMatch(historyTitle: string, candidateTitle: string): boolean {
  const a = normalizeTitle(historyTitle);
  const b = normalizeTitle(candidateTitle);
  if (!a || !b) return false;
  // Equal, or one contains the other (handles "Bungo Stray Dogs 3" vs "Bungo Stray
  // Dogs"). Require the shorter side to be a meaningful length to avoid junk hits.
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.includes(shorter);
}

export function createHistoryMetadataResolver(deps: {
  readonly search: (title: string, mediaKind: MediaKind) => Promise<readonly SearchResult[]>;
}): HistoryMetadataResolver {
  return {
    async resolve(target: HistoryHealTarget): Promise<ResolvedHistoryMetadata | null> {
      const results = await deps.search(target.title, target.mediaKind);
      const match = results.find((result) => isPlausibleMatch(target.title, result.title));
      if (!match) return null;

      const posterUrl = toPosterUrl(match.posterPath);
      const externalIds = match.externalIds;
      if (!posterUrl && !externalIds) return null;

      return {
        ...(posterUrl ? { posterUrl } : {}),
        ...(externalIds ? { externalIds } : {}),
      };
    },
  };
}
