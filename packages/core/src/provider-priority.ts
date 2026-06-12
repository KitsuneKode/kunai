import type { CoreProviderModule } from "./provider-sdk";

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

  const seriesModules = sortLaneModules(
    modules.filter((module) => providerLane(module) === "series"),
    seriesRank,
  );
  const animeModules = sortLaneModules(
    modules.filter((module) => providerLane(module) === "anime"),
    animeRank,
  );

  let seriesIndex = 0;
  let animeIndex = 0;

  return modules.map((module) => {
    if (providerLane(module) === "anime") {
      const next = animeModules[animeIndex] ?? module;
      animeIndex += 1;
      return next;
    }

    const next = seriesModules[seriesIndex] ?? module;
    seriesIndex += 1;
    return next;
  });
}

export function buildFirstSeenRank(
  providerIds: readonly string[] | undefined,
): Map<string, number> {
  const rank = new Map<string, number>();
  (providerIds ?? []).forEach((providerId, index) => {
    if (!rank.has(providerId)) rank.set(providerId, index);
  });
  return rank;
}

function sortLaneModules(
  modules: readonly CoreProviderModule[],
  rank: ReadonlyMap<string, number>,
): CoreProviderModule[] {
  return modules
    .map((module, index) => ({ module, index }))
    .sort((a, b) => {
      const rankDelta =
        (rank.get(a.module.providerId) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.module.providerId) ?? Number.MAX_SAFE_INTEGER);
      return rankDelta === 0 ? a.index - b.index : rankDelta;
    })
    .map(({ module }) => module);
}

function providerLane(module: CoreProviderModule): "anime" | "series" {
  return module.manifest.mediaKinds.includes("anime") ? "anime" : "series";
}
