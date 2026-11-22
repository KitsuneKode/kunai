import { existsSync } from "node:fs";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import {
  ALLMANGA_BUILD_ID,
  ALLMANGA_EPOCH,
  ALLMANGA_EPOCH_MS,
  getActiveProviderHotfixManifest,
  getEffectiveAllMangaCryptoProfile,
  setActiveProviderHotfixManifest,
} from "@kunai/providers";

import {
  fetchAndCacheProviderHotfixManifest,
  groupProvidersByLane,
  loadCachedProviderHotfixManifest,
  providerManifestBackupPath,
  providerManifestCachePath,
  resetCachedProviderHotfixManifest,
  rollbackCachedProviderHotfixManifest,
  type CachedProviderManifestState,
  type ManifestFetch,
} from "./provider-hotfix-manifest";

export interface RunProvidersCommandOptions {
  readonly subcommand?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly url?: string;
  readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
  readonly cachePath?: string;
  readonly nowMs?: number;
  readonly fetchImpl?: ManifestFetch;
  readonly write?: (text: string) => void;
}

function summarizeManifestState(
  state: CachedProviderManifestState,
  options?: {
    readonly trustedPublicKeysById?: Readonly<Record<string, string>>;
    readonly nowMs?: number;
  },
) {
  const backupPath = providerManifestBackupPath(state.path);
  const backupAvailable = existsSync(backupPath);
  let backupRevision: number | null = null;
  if (backupAvailable) {
    const backupState = loadCachedProviderHotfixManifest({
      path: backupPath,
      trustedPublicKeysById: options?.trustedPublicKeysById,
      nowMs: options?.nowMs,
    });
    if (backupState.status === "active") {
      backupRevision = backupState.manifest.revision;
    }
  }
  const backupMeta =
    backupRevision !== null ? { backupAvailable, backupRevision } : { backupAvailable };
  if (state.status === "active") {
    return {
      status: state.status,
      path: state.path,
      keyId: state.keyId,
      revision: state.manifest.revision,
      generatedAt: state.manifest.generatedAt,
      expiresAt: state.manifest.expiresAt,
      providerOverrides: Object.keys(state.manifest.providers),
      ...backupMeta,
    };
  }
  if (state.status === "invalid") {
    return { status: state.status, path: state.path, reason: state.reason, ...backupMeta };
  }
  return { status: state.status, path: state.path, ...backupMeta };
}

export async function runProvidersCommand(options: RunProvidersCommandOptions): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const action = options.subcommand ?? "status";

  if (action === "reset") {
    const result = resetCachedProviderHotfixManifest({
      path: options.cachePath,
      includeBackup: Boolean(options.force),
    });
    if (options.json) {
      write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    } else {
      write(
        result.removed
          ? `Removed cached provider manifest at ${result.path}; bundled defaults are active.\n`
          : `No cached provider manifest present at ${result.path}.\n`,
      );
    }
    return 0;
  }

  if (action === "rollback") {
    const rolled = await rollbackCachedProviderHotfixManifest({
      path: options.cachePath,
      trustedPublicKeysById: options.trustedPublicKeysById,
      nowMs: options.nowMs,
    });
    if (options.json) {
      write(
        `${JSON.stringify(
          rolled.ok
            ? {
                ok: true,
                path: rolled.path,
                keyId: rolled.keyId,
                revision: rolled.manifest.revision,
                expiresAt: rolled.manifest.expiresAt,
              }
            : { ok: false, path: rolled.path, reason: rolled.reason },
          null,
          2,
        )}\n`,
      );
    } else if (rolled.ok) {
      write(
        `Rolled back provider manifest to verified rev ${rolled.manifest.revision} (${rolled.keyId}).\n`,
      );
    } else {
      write(`kunai providers rollback failed: ${rolled.reason}\n`);
    }
    return rolled.ok ? 0 : 1;
  }

  const modules = await loadProductionProviderModules({
    providerPriority: [],
    animeProviderPriority: [],
  });

  if (action === "update") {
    const manifestUrl = options.url ?? process.env.KUNAI_PROVIDER_MANIFEST_URL?.trim();
    if (!manifestUrl) {
      const payload = {
        ok: false,
        reason:
          "No manifest URL provided. Pass --url <https-url> or set KUNAI_PROVIDER_MANIFEST_URL.",
        cachePath: options.cachePath ?? providerManifestCachePath(),
      };
      if (options.json) write(`${JSON.stringify(payload, null, 2)}\n`);
      else write(`kunai providers update: ${payload.reason}\n`);
      return 2;
    }

    const result = await fetchAndCacheProviderHotfixManifest({
      url: manifestUrl,
      trustedPublicKeysById: options.trustedPublicKeysById,
      path: options.cachePath,
      nowMs: options.nowMs,
      dryRun: options.dryRun,
      force: options.force,
      knownProvidersByLane: groupProvidersByLane(modules),
      fetchImpl: options.fetchImpl,
    });

    if (result.status === "rejected") {
      if (options.json) {
        write(
          `${JSON.stringify({ ok: false, status: result.status, reason: result.reason }, null, 2)}\n`,
        );
      } else {
        write(`kunai providers update rejected: ${result.reason}\n`);
      }
      return 1;
    }

    const summary = {
      ok: true,
      status: result.status,
      path: result.path,
      keyId: result.keyId,
      revision: result.manifest.revision,
      previousRevision: result.previousRevision,
      expiresAt: result.manifest.expiresAt,
      backedUp: result.backedUp,
      providerOverrides: Object.keys(result.manifest.providers),
    };
    if (options.json) {
      write(`${JSON.stringify(summary, null, 2)}\n`);
    } else if (result.status === "dry-run") {
      write(
        `Dry-run verified rev ${result.manifest.revision} (${result.keyId}); nothing written to ${result.path}.\n`,
      );
    } else if (result.status === "unchanged") {
      write(`Provider manifest is already at rev ${result.manifest.revision} (no changes).\n`);
    } else {
      write(
        `Verified and cached provider manifest rev ${result.manifest.revision} (${result.keyId}) at ${result.path}\n`,
      );
    }
    return 0;
  }

  if (action === "verify") {
    const nowMs = options.nowMs ?? Date.now();
    const manifestState = loadCachedProviderHotfixManifest({
      path: options.cachePath,
      trustedPublicKeysById: options.trustedPublicKeysById,
      nowMs,
    });
    const liveEpoch = Math.floor(nowMs / ALLMANGA_EPOCH_MS);
    const epochsBehind = Math.max(0, liveEpoch - ALLMANGA_EPOCH);
    const previousActive = getActiveProviderHotfixManifest();
    let activeProfile = getEffectiveAllMangaCryptoProfile();
    if (manifestState.status === "active") {
      setActiveProviderHotfixManifest(manifestState.manifest);
      try {
        activeProfile = getEffectiveAllMangaCryptoProfile();
      } finally {
        setActiveProviderHotfixManifest(previousActive);
      }
    }
    const manifestOk = manifestState.status !== "invalid";
    const cryptoFresh = epochsBehind < 2;
    const ok = manifestOk && cryptoFresh;
    const expiresInHours =
      manifestState.status === "active"
        ? Math.max(
            0,
            Math.round((Date.parse(manifestState.manifest.expiresAt) - nowMs) / (60 * 60 * 1000)),
          )
        : null;
    const manifestSummary = summarizeManifestState(manifestState, {
      trustedPublicKeysById: options.trustedPublicKeysById,
      nowMs,
    });
    const hotfixManifest =
      expiresInHours !== null ? { ...manifestSummary, expiresInHours } : manifestSummary;
    const payload = {
      ok,
      schemaVersion: 1 as const,
      hotfixManifest,
      allmangaCrypto: {
        pinnedBuildId: ALLMANGA_BUILD_ID,
        effectiveBuildId: activeProfile.buildId,
        pinnedEpoch: ALLMANGA_EPOCH,
        currentEpoch: liveEpoch,
        epochsBehind,
        fresh: cryptoFresh,
      },
    };
    if (options.json) {
      write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      const lines = [
        `Hotfix manifest: ${manifestState.status}${
          manifestState.status === "active"
            ? ` (rev ${manifestState.manifest.revision}, expires in ${expiresInHours}h)`
            : manifestState.status === "invalid"
              ? ` (${manifestState.reason})`
              : " (using bundled defaults)"
        }`,
        `AllManga crypto: build ${activeProfile.buildId}, epoch ${ALLMANGA_EPOCH} vs ${liveEpoch} (${epochsBehind} behind)${
          cryptoFresh
            ? " · fresh"
            : " · stale (run kunai providers update or refresh bundled epoch)"
        }`,
      ];
      write(`${lines.join("\n")}\n`);
    }
    return ok ? 0 : 1;
  }

  if (action !== "status") {
    const reason = `Unknown providers subcommand "${action}". Expected: status, update, verify, rollback, or reset.`;
    if (options.json) write(`${JSON.stringify({ ok: false, reason }, null, 2)}\n`);
    else write(`kunai providers: ${reason}\n`);
    return 2;
  }

  const manifestState = loadCachedProviderHotfixManifest({
    path: options.cachePath,
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });

  const manifestSummary = summarizeManifestState(manifestState, {
    trustedPublicKeysById: options.trustedPublicKeysById,
    nowMs: options.nowMs,
  });
  const report = {
    schemaVersion: 1 as const,
    providers: modules.map((mod) => ({
      id: mod.manifest.id,
      displayName: mod.manifest.displayName,
      domain: mod.manifest.domain,
      recommended: mod.manifest.recommended,
      mediaKinds: [...mod.manifest.mediaKinds],
    })),
    hotfixManifest: manifestSummary,
  };

  if (options.json) {
    write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const backupSuffix =
    "backupRevision" in manifestSummary && manifestSummary.backupRevision !== undefined
      ? ` · rollback backup: rev ${manifestSummary.backupRevision}`
      : manifestSummary.backupAvailable
        ? " · rollback backup available"
        : "";
  const lines = [
    `Production providers (${report.providers.length}):`,
    ...report.providers.map(
      (p) => `  - ${p.id} (${p.displayName}) · ${p.domain}${p.recommended ? " · recommended" : ""}`,
    ),
    `Hotfix manifest: ${manifestState.status}${
      manifestState.status === "active"
        ? ` (rev ${manifestState.manifest.revision}, expires ${manifestState.manifest.expiresAt})`
        : manifestState.status === "invalid"
          ? ` (${manifestState.reason})`
          : " (using bundled defaults)"
    }${backupSuffix}`,
  ];
  write(`${lines.join("\n")}\n`);
  return 0;
}
