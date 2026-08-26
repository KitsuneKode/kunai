import type { OfflineAssetRecord } from "@kunai/storage";
import { encodeProviderEpisodeIdentity, type ProviderEpisodeIdentity } from "@kunai/types";

/**
 * Fast "is this downloaded?" lookups for badges and the per-episode source
 * decision. Build once from a fetched asset list, then query many times — used
 * by episode/series/history lists (↓ badges, "↓ 3/13") and by the unified
 * playback pipeline to choose local vs online per episode. See the offline⇄online
 * parity spec.
 */
export type OfflineAvailabilityIndex = {
  /** A verified local copy exists. Omit season/episode for movies. */
  isReady(
    titleId: string,
    season?: number,
    episode?: number,
    providerEpisodeIdentity?: ProviderEpisodeIdentity,
  ): boolean;
  /** Distinct downloaded (ready) episodes for the title. */
  readyCountForTitle(titleId: string): number;
};

function episodeKey(
  titleId: string,
  season?: number,
  episode?: number,
  providerEpisodeIdentity?: ProviderEpisodeIdentity,
): string {
  const base = `${titleId}:${season ?? "_"}:${episode ?? "_"}`;
  return providerEpisodeIdentity
    ? `${base}:${encodeProviderEpisodeIdentity(providerEpisodeIdentity)}`
    : base;
}

export function buildOfflineAvailabilityIndex(
  assets: readonly OfflineAssetRecord[],
): OfflineAvailabilityIndex {
  const ready = new Set<string>();
  const perTitle = new Map<string, Set<string>>();
  for (const a of assets) {
    if (a.state !== "ready") continue;
    ready.add(episodeKey(a.titleId, a.season, a.episode));
    if (a.providerEpisodeIdentity) {
      ready.add(episodeKey(a.titleId, a.season, a.episode, a.providerEpisodeIdentity));
    }
    let set = perTitle.get(a.titleId);
    if (!set) {
      set = new Set<string>();
      perTitle.set(a.titleId, set);
    }
    set.add(episodeKey("", a.season, a.episode, a.providerEpisodeIdentity));
  }
  return {
    isReady: (titleId, season, episode, providerEpisodeIdentity) =>
      ready.has(episodeKey(titleId, season, episode, providerEpisodeIdentity)),
    readyCountForTitle: (titleId) => perTitle.get(titleId)?.size ?? 0,
  };
}
