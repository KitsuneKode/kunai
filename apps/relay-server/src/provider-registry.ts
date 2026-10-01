import {
  allmangaProviderModule,
  anidbProviderModule,
  miruroProviderModule,
  productionProviderRoster,
  rivestreamProviderModule,
  videasyProviderModule,
  vidlinkProviderModule,
} from "@kunai/providers";
import { buildProviderRelayRegistry } from "@kunai/relay";

const relayModulesById = {
  videasy: videasyProviderModule,
  vidlink: vidlinkProviderModule,
  rivestream: rivestreamProviderModule,
  allanime: allmangaProviderModule,
  anidb: anidbProviderModule,
  miruro: miruroProviderModule,
} as const;

export const relayProviderModules = productionProviderRoster
  .filter((descriptor) => descriptor.relay)
  .map((descriptor) => {
    const module = relayModulesById[descriptor.id as keyof typeof relayModulesById];
    if (!module) {
      throw new Error(`Relay roster entry ${descriptor.id} has no module`);
    }
    return module;
  });

export const relayRegistry = buildProviderRelayRegistry(relayProviderModules);
