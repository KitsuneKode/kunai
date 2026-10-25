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

/**
 * Every production provider whose manifest declares `relayProfile` must appear
 * here — a missing entry answers `unknown-provider` for a provider the CLI
 * expects the relay to serve, and `buildRelayDriftProbes` derives its probes
 * from this registry so the drift check can't see its own gap. The roster
 * parity test in `apps/cli/test/unit/container/relay-roster.test.ts` pins this
 * list against the relayable production modules.
 */
export const relayProviderModules = [
  videasyProviderModule,
  vidlinkProviderModule,
  vidrockProviderModule,
  rivestreamProviderModule,
  movyProviderModule,
  allmangaProviderModule,
  anidbProviderModule,
  hianimeProviderModule,
  animeggProviderModule,
  kickassanimeProviderModule,
  miruroProviderModule,
] as const;

export const relayRegistry = buildProviderRelayRegistry(relayProviderModules);
