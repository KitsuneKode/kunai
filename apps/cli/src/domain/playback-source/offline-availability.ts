import type { OfflineAssetRecord } from "@kunai/storage";

/**
 * Fast "is this downloaded?" lookups for badges and the per-episode source
 * decision. Build once from a fetched asset list, then query many times — used
 * by episode/series/history lists (↓ badges, "↓ 3/13") and by the unified
 * playback pipeline to choose local vs online per episode. See the offline⇄online
 * parity spec.
 */
export type OfflineAvailabilityIndex = {
  /** A verified local copy exists. Omit season/episode for movies. */
  isReady(titleId: string, season?: number, episode?: number): boolean;
  /** Distinct downloaded (ready) episodes for the title. */
  readyCountForTitle(titleId: string): number;
};

function episodeKey(titleId: string, season?: number, episode?: number): string {
  return `${titleId}:${season ?? "_"}:${episode ?? "_"}`;
}

export function buildOfflineAvailabilityIndex(
  assets: readonly OfflineAssetRecord[],
): OfflineAvailabilityIndex {
  const ready = new Set<string>();
  const perTitle = new Map<string, Set<string>>();
  for (const a of assets) {
    if (a.state !== "ready") continue;
    ready.add(episodeKey(a.titleId, a.season, a.episode));
    let set = perTitle.get(a.titleId);
    if (!set) {
      set = new Set<string>();
      perTitle.set(a.titleId, set);
    }
    set.add(`${a.season ?? "_"}:${a.episode ?? "_"}`);
  }
  return {
    isReady: (titleId, season, episode) => ready.has(episodeKey(titleId, season, episode)),
    readyCountForTitle: (titleId) => perTitle.get(titleId)?.size ?? 0,
  };
}
