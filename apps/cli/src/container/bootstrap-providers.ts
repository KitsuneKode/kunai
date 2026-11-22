import {
  createProviderEngine,
  isVideasyFamilyProvider,
  orderProviderModulesByPriority,
  type CoreProviderModule,
  type ProviderEngine,
  type ProviderPriorityInput,
} from "@kunai/core";
import type { ProviderHotfixManifest } from "@kunai/providers";
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
import {
  applyHotfixToProviderBootstrap,
  getActiveProviderHotfixManifest,
} from "../services/providers/provider-hotfix-manifest";
import {
  createProviderPrioritySnapshot,
  filterEnabledProviderModules,
} from "../services/providers/provider-priority";
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
 * The single production provider list. Exported so contract tests can prove the
 * configured lane defaults are actually registered without building a second
 * registry that could drift from this one.
 */
export async function loadProductionProviderModules(
  providerPriority: ProviderPriorityInput,
): Promise<readonly CoreProviderModule[]> {
  const [
    { videasyProviderModule },
    { vidlinkProviderModule },
    { vidrockProviderModule },
    { rivestreamProviderModule },
    { movyProviderModule },
    { allmangaProviderModule },
    { hianimeProviderModule },
    { animeggProviderModule },
    { kickassanimeProviderModule },
    { miruroProviderModule },
    { youtubeProviderModule },
  ] = await Promise.all([
    import("@kunai/providers/videasy"),
    import("@kunai/providers/vidlink"),
    import("@kunai/providers/vidrock"),
    import("@kunai/providers/rivestream"),
    import("@kunai/providers/movy"),
    import("@kunai/providers/allmanga"),
    import("@kunai/providers/hianime"),
    import("@kunai/providers/animegg"),
    import("@kunai/providers/kickassanime"),
    import("@kunai/providers/miruro"),
    import("@kunai/providers/youtube"),
  ]);

  return orderProviderModulesByPriority(
    [
      videasyProviderModule,
      vidlinkProviderModule,
      vidrockProviderModule,
      rivestreamProviderModule,
      movyProviderModule,
      allmangaProviderModule,
      hianimeProviderModule,
      miruroProviderModule,
      animeggProviderModule,
      kickassanimeProviderModule,
      youtubeProviderModule,
    ],
    providerPriority,
  );
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

  const providerRegistry = createProviderRegistry(engine, {
    ...providerPriority,
    disabledProviderIds: [...config.disabledProviders],
  });

  const getOrderedModules = createOrderedModulesGetter(config, providerModules);
  const getEffectiveProviderPriority = (): ProviderPriorityInput =>
    applyHotfixToProviderBootstrap(
      createProviderPrioritySnapshot(config),
      config.disabledProviders,
      getActiveProviderHotfixManifest(),
    ).priority;
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
      getProviderPriority: getEffectiveProviderPriority,
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

type OrderedModulesConfig = PersistenceBootstrap["config"];

/**
 * The provider modules playback may use, in attempt order: user priority and
 * disables, then the active signed hotfix manifest (lane priority + `disabled`).
 * The registry and this list must agree, or a provider the manifest disabled is
 * still replayed from cache and still attempted on fallback. The manifest is
 * read through the expiry-aware getter on every call, so an expired manifest
 * stops excluding providers without anyone rewriting state.
 */
export function createOrderedModulesGetter(
  config: OrderedModulesConfig,
  providerModules: readonly CoreProviderModule[],
  getManifest: () => ProviderHotfixManifest | null = getActiveProviderHotfixManifest,
): () => readonly CoreProviderModule[] {
  let cacheKey: string | null = null;
  let ordered: readonly CoreProviderModule[] = providerModules;
  return () => {
    const manifest = getManifest();
    const effective = applyHotfixToProviderBootstrap(
      createProviderPrioritySnapshot(config),
      config.disabledProviders,
      manifest,
    );
    const raw = config.getRaw();
    const key = [
      effective.priority.providerPriority.join(","),
      effective.priority.animeProviderPriority.join(","),
      (effective.priority.youtubeProviderPriority ?? []).join(","),
      raw.providerRelay?.enabled ? "relay-on" : "relay-off",
      JSON.stringify(raw.providerRelay?.providers ?? {}),
      effective.disabledProviderIds.join(","),
    ].join("|");
    if (key !== cacheKey) {
      cacheKey = key;
      ordered = filterEnabledProviderModules(
        orderProviderModulesByPriority(providerModules, effective.priority),
        effective.disabledProviderIds,
      );
    }
    return ordered;
  };
}
