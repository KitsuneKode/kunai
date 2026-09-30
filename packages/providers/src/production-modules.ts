import type { CoreProviderModule } from "@kunai/core";

import { allmangaProviderModule } from "./allmanga/direct";
import { anidbProviderModule } from "./anidb/direct";
import { animeggProviderModule } from "./animegg/direct";
import { hianimeProviderModule } from "./hianime/direct";
import { kickassanimeProviderModule } from "./kickassanime/direct";
import { miruroProviderModule } from "./miruro/direct";
import { movyProviderModule } from "./movy/direct";
import { rivestreamProviderModule } from "./rivestream/direct";
import { videasyProviderModule } from "./videasy/index";
import { vidlinkProviderModule } from "./vidlink/direct";
import { vidrockProviderModule } from "./vidrock/direct";
import { youtubeProviderModule } from "./youtube/index";

/**
 * The production roster, statically imported.
 *
 * `PRODUCTION_PROVIDER_LOADERS` in `./production` holds the same set behind
 * dynamic imports for the CLI's lazy bootstrap; consumers that need the
 * modules synchronously — the relay server registry, the status sweep — use
 * this array. Order matches the loader map so either entry point produces the
 * same lane positions through `orderProviderModulesByPriority`.
 */
export const PRODUCTION_PROVIDER_MODULES: readonly CoreProviderModule[] = [
  videasyProviderModule,
  vidlinkProviderModule,
  vidrockProviderModule,
  rivestreamProviderModule,
  movyProviderModule,
  anidbProviderModule,
  allmangaProviderModule,
  hianimeProviderModule,
  miruroProviderModule,
  animeggProviderModule,
  kickassanimeProviderModule,
  youtubeProviderModule,
];
