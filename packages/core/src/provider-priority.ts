import type { ProviderLane } from "@kunai/types";

import { resolveProviderId } from "./provider-engine";
import type { CoreProviderModule } from "./provider-sdk";

export type ProviderPriorityInput = {
  readonly providerPriority: readonly string[];
  readonly animeProviderPriority: readonly string[];
  readonly youtubeProviderPriority?: readonly string[];
};

export function resolveProviderLaneFromModule(module: CoreProviderModule): ProviderLane {
  return resolveProviderLaneFromMediaKinds(module.manifest.mediaKinds);
}

export function resolveProviderLaneFromMediaKinds(
  mediaKinds: readonly CoreProviderModule["manifest"]["mediaKinds"][number][],
): ProviderLane {
  if (mediaKinds.includes("video")) return "youtube";
  if (mediaKinds.includes("anime")) return "anime";
  return "series";
}

export function orderProviderModulesByPriority(
  modules: readonly CoreProviderModule[],
  priority: ProviderPriorityInput,
): CoreProviderModule[] {
  const seriesRank = buildFirstSeenRank(priority.providerPriority);
  const animeRank = buildFirstSeenRank(priority.animeProviderPriority);
  const youtubeRank = buildFirstSeenRank(priority.youtubeProviderPriority);

  const seriesModules = sortLaneModules(
    modules.filter((module) => resolveProviderLaneFromModule(module) === "series"),
    seriesRank,
  );
  const animeModules = sortLaneModules(
    modules.filter((module) => resolveProviderLaneFromModule(module) === "anime"),
    animeRank,
  );
  const youtubeModules = sortLaneModules(
    modules.filter((module) => resolveProviderLaneFromModule(module) === "youtube"),
    youtubeRank,
  );

  let seriesIndex = 0;
  let animeIndex = 0;
  let youtubeIndex = 0;

  return modules.map((module) => {
    const lane = resolveProviderLaneFromModule(module);
    if (lane === "anime") {
      const next = animeModules[animeIndex] ?? module;
      animeIndex += 1;
      return next;
    }
    if (lane === "youtube") {
      const next = youtubeModules[youtubeIndex] ?? module;
      youtubeIndex += 1;
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
    const normalizedProviderId = resolveProviderId(providerId);
    if (!rank.has(normalizedProviderId)) rank.set(normalizedProviderId, index);
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
        (rank.get(resolveProviderId(a.module.providerId)) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(resolveProviderId(b.module.providerId)) ?? Number.MAX_SAFE_INTEGER);
      return rankDelta === 0 ? a.index - b.index : rankDelta;
    })
    .map(({ module }) => module);
}
