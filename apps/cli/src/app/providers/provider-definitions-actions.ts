import type { Container } from "@/container";
import {
  fetchAndCacheProviderHotfixManifest,
  groupProvidersByLane,
  loadCachedProviderHotfixManifest,
  providerManifestBackupPath,
  rollbackCachedProviderHotfixManifest,
  setActiveProviderHotfixManifest,
  type ManifestFetch,
} from "@/services/providers/provider-hotfix-manifest";
import {
  reloadProviderRegistryPriority,
  type ExpiryScheduler,
} from "@/services/providers/provider-registry-hotfix";
import type { ProviderPriorityInput } from "@kunai/core";

export interface ProviderDefinitionsPriorityContainer {
  readonly config: { readonly getRaw: () => ReturnType<Container["config"]["getRaw"]> };
  readonly providerRegistry: {
    readonly setPriority: (
      input: ProviderPriorityInput & { readonly disabledProviderIds?: readonly string[] },
    ) => void;
  };
}

export interface ProviderDefinitionsUpdateContainer extends ProviderDefinitionsPriorityContainer {
  readonly engine: {
    readonly modules: readonly {
      readonly manifest: { readonly id: string; readonly mediaKinds: readonly string[] };
    }[];
  };
}

export type ProviderDefinitionsSnapshot = {
  readonly activeRevision: number | null;
  readonly activeExpiresAt: string | null;
  readonly backupRevision: number | null;
};

export type ProviderDefinitionsRuntimeOptions = {
  readonly manifestUrl?: string;
  readonly path?: string;
  readonly statePath?: string;
  readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
  readonly fetchImpl?: ManifestFetch;
  readonly nowMs?: number;
};

export function readProviderDefinitionsSnapshot(
  options: Pick<ProviderDefinitionsRuntimeOptions, "path" | "trustedPublicKeysById" | "nowMs"> = {},
): ProviderDefinitionsSnapshot {
  const cached = loadCachedProviderHotfixManifest({
    path: options.path,
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });
  const backup = loadCachedProviderHotfixManifest({
    path: providerManifestBackupPath(options.path),
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });
  return {
    activeRevision: cached.status === "active" ? cached.manifest.revision : null,
    activeExpiresAt: cached.status === "active" ? cached.manifest.expiresAt : null,
    backupRevision: backup.status === "active" ? backup.manifest.revision : null,
  };
}

export {
  reloadProviderRegistryPriority,
  type ExpiryScheduler,
} from "@/services/providers/provider-registry-hotfix";

/**
 * Startup half of the hotfix lifecycle: verify the manifest cached by an earlier
 * `providers update` (or background refresh) and make it live for this process.
 * Without this, a cached manifest only ever applied in the process that fetched
 * it — the background refresh returns "skipped" for a fresh cache and
 * "unchanged" for the same revision, and neither activates anything.
 *
 * Works offline: the cache was verified against trusted keys and expiry is
 * re-checked here. An absent file, missing keys, or a failed verification
 * leaves bundled defaults in place.
 */
export function activateCachedProviderHotfixManifest(
  container: ProviderDefinitionsPriorityContainer,
  options: Pick<ProviderDefinitionsRuntimeOptions, "path" | "trustedPublicKeysById" | "nowMs"> & {
    readonly schedule?: ExpiryScheduler;
    readonly clock?: () => number;
  } = {},
): ReturnType<typeof loadCachedProviderHotfixManifest>["status"] {
  const cached = loadCachedProviderHotfixManifest({
    path: options.path,
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });
  if (cached.status !== "active") return cached.status;
  const fixedNowMs = options.nowMs;
  const fixedClock = fixedNowMs === undefined ? undefined : () => fixedNowMs;
  setActiveProviderHotfixManifest(cached.manifest);
  reloadProviderRegistryPriority(container, {
    schedule: options.schedule,
    nowMs: options.clock ?? fixedClock,
  });
  return cached.status;
}

export async function updateProviderDefinitionsFromShell(
  container: ProviderDefinitionsUpdateContainer,
  options: ProviderDefinitionsRuntimeOptions = {},
): Promise<string> {
  if (container.config.getRaw().offlineMode) {
    return "Skipped — offline mode is on";
  }
  const manifestUrl = (options.manifestUrl ?? process.env.KUNAI_PROVIDER_MANIFEST_URL)?.trim();
  if (!manifestUrl) {
    return "Set KUNAI_PROVIDER_MANIFEST_URL or run `kunai providers update --url <url>`";
  }
  const result = await fetchAndCacheProviderHotfixManifest({
    url: manifestUrl,
    path: options.path,
    statePath: options.statePath,
    trustedPublicKeysById: options.trustedPublicKeysById,
    fetchImpl: options.fetchImpl,
    nowMs: options.nowMs,
    knownProvidersByLane: groupProvidersByLane(container.engine.modules),
  });
  if (result.status === "updated" || result.status === "unchanged") {
    const fixedNowMs = options.nowMs;
    setActiveProviderHotfixManifest(result.manifest);
    reloadProviderRegistryPriority(container, {
      nowMs: fixedNowMs === undefined ? undefined : () => fixedNowMs,
    });
    return result.status === "updated"
      ? `Updated to rev ${result.manifest.revision}`
      : `Already up to date (rev ${result.manifest.revision})`;
  }
  return result.status === "rejected"
    ? `Update rejected: ${result.reason}`
    : `Dry-run verified rev ${result.manifest.revision}`;
}

export async function rollbackProviderDefinitionsFromShell(
  container: ProviderDefinitionsPriorityContainer,
  options: Pick<
    ProviderDefinitionsRuntimeOptions,
    "path" | "statePath" | "trustedPublicKeysById" | "nowMs"
  > = {},
): Promise<string> {
  const rolled = await rollbackCachedProviderHotfixManifest({
    path: options.path,
    statePath: options.statePath,
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });
  if (rolled.ok) {
    const fixedNowMs = options.nowMs;
    setActiveProviderHotfixManifest(rolled.manifest);
    reloadProviderRegistryPriority(container, {
      nowMs: fixedNowMs === undefined ? undefined : () => fixedNowMs,
    });
    return `Rolled back to rev ${rolled.manifest.revision}`;
  }
  return `Rollback skipped: ${rolled.reason}`;
}
