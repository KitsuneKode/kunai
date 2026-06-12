import type { CoreProviderModule } from "@kunai/core";

export type ProviderPriorityInput = {
  readonly providerPriority: readonly string[];
  readonly animeProviderPriority: readonly string[];
};

export function orderProviderModulesByPriority(
  modules: readonly CoreProviderModule[],
  priority: ProviderPriorityInput,
): CoreProviderModule[] {
  const seriesRank = buildFirstSeenRank(priority.providerPriority);
  const animeRank = buildFirstSeenRank(priority.animeProviderPriority);
  return [...modules].sort((a, b) => {
    const aRank = a.manifest.mediaKinds.includes("anime")
      ? animeRank.get(a.providerId)
      : seriesRank.get(a.providerId);
    const bRank = b.manifest.mediaKinds.includes("anime")
      ? animeRank.get(b.providerId)
      : seriesRank.get(b.providerId);
    return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
  });
}

function buildFirstSeenRank(providerIds: readonly string[]): Map<string, number> {
  const rank = new Map<string, number>();
  providerIds.forEach((providerId, index) => {
    if (!rank.has(providerId)) rank.set(providerId, index);
  });
  return rank;
}
