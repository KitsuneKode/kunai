import {
  createProviderEngine,
  isVideasyFamilyProvider,
  orderProviderModulesByPriority,
  type ProviderEngine,
} from "@kunai/core";
import { buildProviderRelayRegistry, createRelayFetchPort } from "@kunai/relay";

import { PlaybackResolveCoordinator } from "../services/playback/PlaybackResolveCoordinator";
import { PlaybackResolveWorkService } from "../services/playback/PlaybackResolveWorkService";
import {
  resolveProviderAttemptTimeoutMs,
  resolveProviderMaxAttempts,
} from "../services/playback/provider-resolve-budget-policy";
import { StreamHealthService } from "../services/playback/StreamHealthService";
import { createProviderPrioritySnapshot } from "../services/providers/provider-priority";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import { createProviderRegistry } from "../services/providers/ProviderRegistry";
import type { PersistenceBootstrap } from "./bootstrap-persistence";
import { applyYoutubeProviderConfig } from "./configure-youtube-provider";

export type ProviderBootstrap = {
  readonly engine: ProviderEngine;
  readonly providerRegistry: ProviderRegistry;
  readonly playbackResolveWork: PlaybackResolveWorkService;
};

export async function bootstrapProviders(
  persistence: PersistenceBootstrap,
): Promise<ProviderBootstrap> {
  const {
    config,
    endpointHealth,
    titleBridgePort,
    cacheStore,
    providerHealth,
    sourceInventory,
    titleProviderHealth,
    titlePlaybackSource,
    diagnosticsService,
  } = persistence;

  const providerPriority = createProviderPrioritySnapshot(config);
  const [
    { videasyProviderModule },
    { vidlinkProviderModule },
    { rivestreamProviderModule },
    { allmangaProviderModule },
    { miruroProviderModule },
    { youtubeProviderModule },
  ] = await Promise.all([
    import("@kunai/providers/videasy"),
    import("@kunai/providers/vidlink"),
    import("@kunai/providers/rivestream"),
    import("@kunai/providers/allmanga"),
    import("@kunai/providers/miruro"),
    import("@kunai/providers/youtube"),
  ]);

  applyYoutubeProviderConfig(config.getRaw(), persistence.cacheDb);

  const providerModules = orderProviderModulesByPriority(
    [
      videasyProviderModule,
      vidlinkProviderModule,
      rivestreamProviderModule,
      allmangaProviderModule,
      miruroProviderModule,
      youtubeProviderModule,
    ],
    providerPriority,
  );
  const relayRegistry = buildProviderRelayRegistry(providerModules);
  const createProviderFetchPort = (providerId: (typeof providerModules)[number]["providerId"]) =>
    createRelayFetchPort({
      providerId,
      registry: relayRegistry,
      relayConfig: config.getRaw().providerRelay,
      env: {
        baseUrl: process.env.KUNAI_RELAY_BASE_URL,
        token: process.env.KUNAI_RELAY_TOKEN,
      },
    });
  const engine = createProviderEngine({
    modules: providerModules,
    attemptTimeoutMs: resolveProviderAttemptTimeoutMs(config.startupPriority),
    maxAttempts: resolveProviderMaxAttempts(config.startupPriority),
    fetch: createProviderFetchPort,
    endpointHealth,
    titleBridge: titleBridgePort,
    auth: {
      getSecret(providerId, key) {
        if (!isVideasyFamilyProvider(providerId)) return undefined;
        if (key === "videasySessionToken") {
          return (
            process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim() ||
            config.videasySessionToken.trim() ||
            undefined
          );
        }
        if (key === "videasyAppId") {
          return config.videasyAppId;
        }
        return undefined;
      },
    },
  });

  const providerRegistry = createProviderRegistry(engine, providerPriority);
  const streamHealthService = new StreamHealthService();
  const playbackResolveWork = new PlaybackResolveWorkService(
    new PlaybackResolveCoordinator({
      engine,
      cacheStore,
      providerHealth,
      streamHealthService,
      sourceInventory,
      titleProviderHealth,
      endpointHealth,
      titlePlaybackSource: titlePlaybackSource,
      diagnostics: diagnosticsService,
      getProviderPriority: () => createProviderPrioritySnapshot(config),
      catalogCrosswalk: persistence.catalogCrosswalk,
    }),
    {
      onCompletedLedger: (ledger) => diagnosticsService.recordResolveWorkLedger(ledger),
    },
  );

  return {
    engine,
    providerRegistry,
    playbackResolveWork,
  };
}
