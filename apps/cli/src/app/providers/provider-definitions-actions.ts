import type { Container } from "@/container";
import {
  applyHotfixToProviderBootstrap,
  fetchAndCacheProviderHotfixManifest,
  getActiveProviderHotfixManifest,
  groupProvidersByLane,
  loadCachedProviderHotfixManifest,
  providerManifestBackupPath,
  rollbackCachedProviderHotfixManifest,
  setActiveProviderHotfixManifest,
  type ManifestFetch,
} from "@/services/providers/provider-hotfix-manifest";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
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

function reloadProviderRegistryPriority(container: ProviderDefinitionsPriorityContainer): void {
  const raw = container.config.getRaw();
  const effective = applyHotfixToProviderBootstrap(
    createProviderPrioritySnapshot(raw),
    raw.disabledProviders,
    getActiveProviderHotfixManifest(),
  );
  container.providerRegistry.setPriority({
    ...effective.priority,
    disabledProviderIds: effective.disabledProviderIds,
  });
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
    setActiveProviderHotfixManifest(result.manifest);
    reloadProviderRegistryPriority(container);
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
    setActiveProviderHotfixManifest(rolled.manifest);
    reloadProviderRegistryPriority(container);
    return `Rolled back to rev ${rolled.manifest.revision}`;
  }
  return `Rollback skipped: ${rolled.reason}`;
}
