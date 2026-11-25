import {
  createDohResolver,
  createProviderEngine,
  isVideasyFamilyProvider,
  orderProviderModulesByPriority,
  setProviderDohResolver,
  type CoreProviderModule,
  type DohAddress,
  type DohResolver,
  type ProviderEngine,
  type ProviderPriorityInput,
} from "@kunai/core";
import type { ProviderHotfixManifest } from "@kunai/providers";
import { isStremioAddonProviderId } from "@kunai/providers";
import { buildProviderRelayRegistry, createRelayFetchPort } from "@kunai/relay";
import { ProviderCacheRepository } from "@kunai/storage";

import {
  isStremioAddonInstalled,
  stremioAddonsEnabled,
  type StremioAddonsConsent,
} from "../domain/provider/stremio-addons";
import { createKeyedJoiner } from "../infra/concurrency/keyed-joiner";
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
  groupProvidersByLane,
  maybeUrgentProviderManifestRefresh,
} from "../services/providers/provider-hotfix-manifest";
import {
  createProviderPrioritySnapshot,
  filterEnabledProviderModules,
} from "../services/providers/provider-priority";
import { reloadProviderRegistryPriority } from "../services/providers/provider-registry-hotfix";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import { createProviderRegistry } from "../services/providers/ProviderRegistry";
import { createStremioAddonModules } from "../services/providers/stremio-addon-modules";
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
  // Stremio addons the user installed. Kunai ships none, so the bundled roster
  // is what this returns when the argument is left out.
  userAddonModules: readonly CoreProviderModule[] = [],
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
      // After the bundled providers: an addon the user has not placed in their
      // provider order is a fallback, never the default.
      ...userAddonModules,
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

  // The opt-in state is re-read from the config file on every check, so a
  // standalone `kunai addons disable` takes effect in an already-running
  // session at the next resolve — not only at the next restart. Modules only
  // exist when addons were enabled at startup; enabling mid-session cannot
  // conjure modules that were never loaded.
  const readConsent = (): StremioAddonsConsent =>
    config.readStremioAddonsConsent?.() ?? config.getRaw();
  const addonsEnabled = () => stremioAddonsEnabled(readConsent());
  const providerModules = providerModulesOverride
    ? orderProviderModulesByPriority([...providerModulesOverride], providerPriority)
    : await loadConfiguredProviderModules(config, providerPriority);
  const relayRegistry = buildProviderRelayRegistry(providerModules);
  const dohResolver = createProviderDnsResolver(
    () => config.getRaw().providerDns,
    (reason) =>
      diagnosticsService.record({
        category: "network",
        operation: "provider-dns.doh-unreachable",
        message: `DNS-over-HTTPS unreachable (${reason}); using system DNS for 10 minutes`,
      }),
  );
  // curl-impersonate fetchers read the same resolver, so they share its cache and breaker.
  setProviderDohResolver(dohResolver);
  const createProviderFetchPort = (providerId: (typeof providerModules)[number]["providerId"]) =>
    createRelayFetchPort({
      providerId,
      dohResolver,
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

  // An addon id is available only while the experimental feature is on and the
  // addon is still installed — read fresh so a standalone disable is honoured
  // by every registry lookup without restarting.
  const isProviderAvailable = (id: string) =>
    !isStremioAddonProviderId(id) ||
    (addonsEnabled() && isStremioAddonInstalled(config.stremioAddons, id));
  const providerRegistry = createProviderRegistry(
    engine,
    {
      ...providerPriority,
      disabledProviderIds: [...config.disabledProviders],
    },
    isProviderAvailable,
  );

  const getOrderedModules = createOrderedModulesGetter(
    config,
    providerModules,
    getActiveProviderHotfixManifest,
    (module) => isProviderAvailable(module.providerId),
  );
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
      onProviderDown: () => {
        void refreshHotfixAfterProviderDown(config, providerRegistry, engine.modules);
      },
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
      stremioAddonsAvailable: () =>
        providerModules.some((module) => isStremioAddonProviderId(module.providerId)) &&
        addonsEnabled(),
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
 * The production module roster for a configured profile: bundled providers in
 * priority order, then the user's Stremio addon modules — but only while the
 * experimental opt-in is enabled. Addon modules carry an `isEnabled` gate
 * back to this same consent read, so a later standalone disable stops them at
 * the next resolve even though the module object remains loaded.
 */
export async function loadConfiguredProviderModules(
  config: OrderedModulesConfig,
  providerPriority: ProviderPriorityInput,
): Promise<readonly CoreProviderModule[]> {
  const addonsEnabled = () =>
    stremioAddonsEnabled(config.readStremioAddonsConsent?.() ?? config.getRaw());
  const addonModules = addonsEnabled()
    ? createStremioAddonModules({
        getEntries: () => config.stremioAddons,
        isEnabled: addonsEnabled,
        onName: (addon, name) => {
          void config.recordStremioAddonName(addon.manifestUrl, name).catch(() => {
            // The name is display-only; the addon keeps working under its host.
          });
        },
      })
    : [];
  return loadProductionProviderModules(providerPriority, addonModules);
}

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
  /**
   * Live admission checked after the memoized ordering, on every call — a
   * Stremio addon drops out the moment the experimental flag is off, without
   * waiting for the priority key to change. Keep it cheap: it runs per resolve.
   */
  admitModule?: (module: CoreProviderModule) => boolean,
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
    return admitModule ? ordered.filter(admitModule) : ordered;
  };
}

/**
 * A provider just went down locally. If a signed fix is already published,
 * fetch it now instead of at the next 6-hour check, and apply it: playback
 * admission reads the active manifest on every resolve, and the registry copy
 * is reloaded here. Opt-in and throttled inside `maybeUrgent…`; never throws.
 */
async function refreshHotfixAfterProviderDown(
  config: OrderedModulesConfig,
  providerRegistry: ProviderRegistry,
  modules: readonly CoreProviderModule[],
): Promise<void> {
  if (config.offlineMode) return;
  try {
    const outcome = await maybeUrgentProviderManifestRefresh({
      knownProvidersByLane: groupProvidersByLane(modules),
    });
    if (outcome === "updated") reloadProviderRegistryPriority({ config, providerRegistry });
  } catch {
    // Advisory: a failed refresh leaves the current manifest in place.
  }
}

/**
 * One resolver for the session, gated on the live setting so flipping
 * Settings › DNS-over-HTTPS applies to the next lookup without a restart.
 * `KUNAI_DOH_DISABLE=1` forces system DNS regardless of the setting.
 */
export function createProviderDnsResolver(
  readMode: () => "doh" | "system",
  onUnreachable: (reason: string) => void,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DohResolver {
  const doh = createDohResolver({ onBreakerOpen: onUnreachable });
  // A provider's first burst asks for the same host several times at once:
  // join those into one bounded lookup, which still finishes (and fills the
  // cache) if every caller leaves.
  const lookups = createKeyedJoiner<readonly DohAddress[] | null>({ whenAbandoned: "finish" });
  return {
    resolve: (hostname, signal) =>
      env.KUNAI_DOH_DISABLE === "1" || readMode() !== "doh"
        ? Promise.resolve(null)
        : lookups.join(hostname.toLowerCase(), (upstream) => doh.resolve(hostname, upstream), {
            signal,
          }),
    stats: () => doh.stats(),
  };
}
