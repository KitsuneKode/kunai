import {
  allmangaProviderModule,
  anidbProviderModule,
  animeggProviderModule,
  hianimeProviderModule,
  kickassanimeProviderModule,
  movyProviderModule,
  vidrockProviderModule,
  miruroProviderModule,
  rivestreamProviderModule,
  videasyProviderModule,
  vidlinkProviderModule,
} from "@kunai/providers";
import { buildProviderRelayRegistry } from "@kunai/relay";

export const relayProviderModules = [
  videasyProviderModule,
  vidlinkProviderModule,
  rivestreamProviderModule,
  allmangaProviderModule,
  anidbProviderModule,
  miruroProviderModule,
  hianimeProviderModule,
  animeggProviderModule,
  kickassanimeProviderModule,
  vidrockProviderModule,
  movyProviderModule,
] as const;

export const relayRegistry = buildProviderRelayRegistry(relayProviderModules);
