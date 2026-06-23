import {
  allmangaProviderModule,
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
  miruroProviderModule,
] as const;

export const relayRegistry = buildProviderRelayRegistry(relayProviderModules);
