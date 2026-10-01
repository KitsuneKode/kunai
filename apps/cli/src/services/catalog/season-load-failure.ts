// =============================================================================
// season-load-failure.ts — why a season/episode catalog read produced nothing,
// and the honest sentence to show the user for each cause.
//
// The season picker used to answer every failure — DNS dead, TMDB 500, a 404
// for a title that simply is not in the catalog, an unreadable body — with one
// line: "Check your connection." Three of those are the catalog answering, so
// the advice was wrong precisely when the network was fine.
// =============================================================================

import type { TmdbFetchFailureKind } from "@/services/catalog/tmdb-proxy";

/**
 * Why a season-data load yielded nothing usable. `empty` is the one the
 * transport layer cannot produce: the catalog answered fine, the title simply
 * lists no playable seasons.
 */
export type SeasonLoadFailure = TmdbFetchFailureKind | "empty";

const OFFLINE_MODE_MESSAGE =
  "Offline mode is on — season data could not be loaded. Turn it off in settings, or play from the offline library.";

/**
 * One bounded, actionable sentence per failure kind. A failure kind that proves
 * the catalog answered (4xx, malformed body, an empty-but-successful read) names
 * itself; `offlineMode` is only allowed to explain the kinds it could actually
 * have caused.
 */
export function describeSeasonLoadFailure(
  failure: SeasonLoadFailure | undefined,
  posture: { readonly offlineMode?: boolean } = {},
): string {
  switch (failure) {
    case "upstream":
      return "The episode catalog answered with an error — try again in a moment.";
    case "not-found":
      return "The episode catalog has no record of this title — it may be a stale or provider-only entry.";
    case "empty":
      return "The catalog answered, but this title lists no playable seasons.";
    case "malformed":
      return "The catalog's answer could not be read — likely a proxy or API change; try again later.";
    case "unreachable":
      return posture.offlineMode
        ? OFFLINE_MODE_MESSAGE
        : "Could not reach the episode catalog — check the network connection, then try again.";
    default:
      return posture.offlineMode
        ? OFFLINE_MODE_MESSAGE
        : "Could not load season data for this title — an unexpected error occurred.";
  }
}
