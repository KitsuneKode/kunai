import type { EpisodeIdentity } from "@kunai/types";

/**
 * Does this episode carry coordinates a series provider can be asked about?
 *
 * The guard was `!episode?.season || !episode.episode`, which is a truthiness
 * test on a field where zero is meaningful: **season 0 is the catalog identity
 * for specials and OVAs**. `!0` is true, so every special was rejected before
 * the provider was called — no request, no failure, no trace. The lane simply
 * reported nothing to play.
 *
 * Season and episode are checked differently on purpose:
 *
 * - **Season** may be 0. It must be a non-negative integer, so a missing,
 *   negative, or fractional season still fails here rather than sending a
 *   nonsense season upstream.
 * - **Episode** may not be 0. Episode numbers are 1-based across Kunai, so a
 *   zero episode is a bug in the caller, not a special.
 *
 * This lives in `shared/` because the truthiness bug recurred independently in
 * the Videasy route builder and in the shared direct-stream validator. One
 * predicate, one rationale, every series provider.
 */
export function hasResolvableSeriesCoordinates(
  episode: EpisodeIdentity | undefined,
): episode is EpisodeIdentity & { readonly season: number; readonly episode: number } {
  const { season, episode: number } = episode ?? {};
  if (typeof season !== "number" || !Number.isInteger(season) || season < 0) return false;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) return false;
  return true;
}
