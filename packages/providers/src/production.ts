import type { CoreProviderModule } from "@kunai/core";

/**
 * The single production roster, keyed by the providerId each module reports.
 *
 * Every consumer of "the production providers" used to keep its own list, and
 * they drifted: the CLI loaded twelve modules while the relay server and the
 * status sweep each registered a shorter hand-written one. This map is the
 * source of truth — `loadProductionProviderModules()` in the CLI iterates it,
 * and `PRODUCTION_PROVIDER_MODULES` is the same set for consumers that need
 * the modules synchronously. `test/production-roster.test.ts` pins the two
 * together, so adding a provider means adding it to both.
 *
 * Keys are providerIds, not directory names: the allmanga module registers as
 * `allanime` — its historical id, kept so existing configs and cache keys keep
 * resolving.
 */
export const PRODUCTION_PROVIDER_LOADERS = {
  videasy: () => import("./videasy/index").then((m) => m.videasyProviderModule),
  vidlink: () => import("./vidlink/direct").then((m) => m.vidlinkProviderModule),
  vidrock: () => import("./vidrock/direct").then((m) => m.vidrockProviderModule),
  rivestream: () => import("./rivestream/direct").then((m) => m.rivestreamProviderModule),
  movy: () => import("./movy/direct").then((m) => m.movyProviderModule),
  anidb: () => import("./anidb/direct").then((m) => m.anidbProviderModule),
  allanime: () => import("./allmanga/direct").then((m) => m.allmangaProviderModule),
  hianime: () => import("./hianime/direct").then((m) => m.hianimeProviderModule),
  miruro: () => import("./miruro/direct").then((m) => m.miruroProviderModule),
  animegg: () => import("./animegg/direct").then((m) => m.animeggProviderModule),
  kickassanime: () => import("./kickassanime/direct").then((m) => m.kickassanimeProviderModule),
  youtube: () => import("./youtube/index").then((m) => m.youtubeProviderModule),
} satisfies Record<string, () => Promise<CoreProviderModule>>;

export type ProductionProviderId = keyof typeof PRODUCTION_PROVIDER_LOADERS;

export const PRODUCTION_PROVIDER_IDS = Object.keys(
  PRODUCTION_PROVIDER_LOADERS,
) as readonly ProductionProviderId[];
