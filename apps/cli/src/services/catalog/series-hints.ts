import type { TvmazeShowHint } from "@/services/catalog/tvmaze-client";

/**
 * What the app knows about a series beyond its TMDB id, keyed by that id.
 *
 * The TMDB season/episode functions only receive a TMDB id. When every TMDB
 * host is down, the TVmaze fallback needs a name, a year, or ideally an IMDb
 * id. The container records a hint for every series the session selects.
 */
const hints = new Map<string, TvmazeShowHint>();
const MAX_HINTS = 200;

export function rememberSeriesHint(tmdbId: string, hint: TvmazeShowHint): void {
  if (!/^\d+$/.test(tmdbId) || !hint.name.trim()) return;
  if (!hints.has(tmdbId) && hints.size >= MAX_HINTS) {
    const oldest = hints.keys().next().value;
    if (oldest !== undefined) hints.delete(oldest);
  }
  hints.set(tmdbId, hint);
}

export function seriesHintFor(tmdbId: string): TvmazeShowHint | undefined {
  return hints.get(tmdbId);
}

export function clearSeriesHintsForTest(): void {
  hints.clear();
}
