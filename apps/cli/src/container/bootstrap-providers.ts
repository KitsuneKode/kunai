import {
  createProviderEngine,
  isVideasyFamilyProvider,
  orderProviderModulesByPriority,
  type CoreProviderModule,
  type ProviderEngine,
  type ProviderPriorityInput,
} from "@kunai/core";
import { PRODUCTION_PROVIDER_LOADERS } from "@kunai/providers/production";
import { buildProviderRelayRegistry, createRelayFetchPort } from "@kunai/relay";
import { ProviderCacheRepository } from "@kunai/storage";

import { PlaybackResolveCoordinator } from "../services/playback/PlaybackResolveCoordinator";
import { PlaybackResolveWorkService } from "../services/playback/PlaybackResolveWorkService";
import {
  resolveProviderAttemptTimeoutMs,
  resolveProviderHedgeDelayMs,
  resolveProviderMaxAttempts,
} from "../services/playback/provider-resolve-budget-policy";
import { StreamHealthService } from "../services/playback/StreamHealthService";
import { createProviderCachePort } from "../services/providers/provider-cache-port";
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

/**
 * The single production provider list, loaded through the shared
 * `PRODUCTION_PROVIDER_LOADERS` roster in `@kunai/providers` — the same map
 * the relay server and the status sweep consume, so the three cannot drift
 * apart again. Exported so contract tests can prove the configured lane
 * defaults are actually registered without building a second registry that
 * could drift from this one.
 */
export async function loadProductionProviderModules(
  providerPriority: ProviderPriorityInput,
): Promise<readonly CoreProviderModule[]> {
  const modules = await Promise.all(
    Object.values(PRODUCTION_PROVIDER_LOADERS).map((load) => load()),
  );

  return orderProviderModulesByPriority(modules, providerPriority);
}

export async function bootstrapProviders(
  persistence: PersistenceBootstrap,
  providerModulesOverride?: readonly CoreProviderModule[],
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
  applyYoutubeProviderConfig(config.getRaw(), persistence.cacheDb);

  const providerModules = providerModulesOverride
    ? orderProviderModulesByPriority([...providerModulesOverride], providerPriority)
    : await loadProductionProviderModules(providerPriority);
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
  const providerCachePort = createProviderCachePort(
    new ProviderCacheRepository(persistence.cacheDb),
  );
  const engine = createProviderEngine({
    modules: providerModules,
    attemptTimeoutMs: resolveProviderAttemptTimeoutMs(config.startupPriority),
    maxAttempts: resolveProviderMaxAttempts(config.startupPriority),
    hedgeDelayMs: resolveProviderHedgeDelayMs(config.startupPriority),
    fetch: createProviderFetchPort,
    endpointHealth,
    cache: providerCachePort,
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

  // The module ordering is a pure function of the priority lists, which change
  // only via config edits — memoize on the joined lists rather than re-sorting
  // the module array on every resolve.
  const getOrderedModules = (() => {
    let cacheKey: string | null = null;
    let ordered: readonly CoreProviderModule[] = providerModules;
    return () => {
      const priority = createProviderPrioritySnapshot(config);
      const key = [
        priority.providerPriority.join(","),
        priority.animeProviderPriority.join(","),
        (priority.youtubeProviderPriority ?? []).join(","),
      ].join("|");
      if (key !== cacheKey) {
        cacheKey = key;
        ordered = orderProviderModulesByPriority(providerModules, priority);
      }
      return ordered;
    };
  })();
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
      getOrderedModules,
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
