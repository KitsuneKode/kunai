import { existsSync } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  readInstallManifest,
  writeInstallManifest,
  type InstallManifest,
} from "../install-manifest";
import { parseCanonicalVersion } from "../version";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import { updateLauncher } from "./launcher";
import { beginInstallTransaction, finishInstallTransaction } from "./transaction";
import { inspectVersionLock, withVersionLock } from "./version-lock";
import { verifyStoredVersion } from "./version-metadata";

export interface RollbackCandidate {
  readonly version: string;
  readonly versionPath: string;
  readonly target: string;
  readonly artifactSha256: string;
  readonly sizeBytes: number;
  readonly installedAt: string;
  readonly active: boolean;
  readonly previous: boolean;
  readonly lockStatus: "missing" | "stale";
}

export type RollbackRefuseCode =
  | "missing-manifest"
  | "non-native"
  | "no-previous"
  | "invalid-version"
  | "already-active"
  | "missing"
  | "corrupt"
  | "locked"
  | "not-candidate";

export type RollbackPlanResult =
  | {
      readonly status: "ready";
      readonly fromVersion: string;
      readonly candidate: RollbackCandidate;
    }
  | {
      readonly status: "refused";
      readonly reason: string;
      readonly code: RollbackRefuseCode;
    };

export type RollbackExecuteResult =
  | { readonly status: "rolled-back"; readonly fromVersion: string; readonly toVersion: string }
  | { readonly status: "dry-run"; readonly fromVersion: string; readonly toVersion: string }
  | {
      readonly status: "refused";
      readonly reason: string;
      readonly code: RollbackRefuseCode;
    }
  | { readonly status: "failed"; readonly error: string };

export type RollbackOptions = {
  readonly to?: string;
  readonly dryRun?: boolean;
  readonly layout?: InstallLayoutPaths;
};

async function listInstalledVersions(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
): Promise<string[]> {
  if (!existsSync(layout.versionsDir)) return [];
  const entries = await readdir(layout.versionsDir).catch(() => [] as string[]);
  const versions: string[] = [];
  for (const entry of entries) {
    const canonical = parseCanonicalVersion(entry);
    if (!canonical) continue;
    if (existsSync(versionBinaryPath(layout, canonical))) versions.push(canonical);
  }
  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Local checksum-verified versions eligible for rollback listing.
 * Never downloads. Versions with an active lock are excluded.
 */
export async function listRollbackCandidates(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
): Promise<readonly RollbackCandidate[]> {
  const manifest = await readInstallManifest(layout.configDir);
  const versions = await listInstalledVersions(layout);
  const candidates: RollbackCandidate[] = [];

  for (const version of versions) {
    const verification = await verifyStoredVersion(layout, version);
    if (verification.status !== "verified") continue;

    const lock = await inspectVersionLock(layout, version);
    if (lock.status === "active") continue;

    candidates.push({
      version,
      versionPath: versionBinaryPath(layout, version),
      target: verification.metadata.target,
      artifactSha256: verification.metadata.artifactSha256,
      sizeBytes: verification.metadata.sizeBytes,
      installedAt: verification.metadata.installedAt,
      active: manifest?.activeVersion === version,
      previous: manifest?.previousVersion === version,
      lockStatus: lock.status === "stale" ? "stale" : "missing",
    });
  }

  return candidates;
}

async function diagnoseTargetRefusal(
  layout: InstallLayoutPaths,
  version: string,
): Promise<Extract<RollbackPlanResult, { status: "refused" }>> {
  const binaryPath = versionBinaryPath(layout, version);
  if (!existsSync(binaryPath) && !existsSync(join(layout.versionsDir, version))) {
    return {
      status: "refused",
      code: "missing",
      reason: `Version ${version} is not present in the local version store`,
    };
  }

  const lock = await inspectVersionLock(layout, version);
  if (lock.status === "active") {
    return {
      status: "refused",
      code: "locked",
      reason: `Version ${version} is locked by a live process`,
    };
  }

  const verification = await verifyStoredVersion(layout, version);
  if (verification.status === "missing-binary" || verification.status === "missing-metadata") {
    return {
      status: "refused",
      code: "missing",
      reason: verification.detail,
    };
  }
  if (
    verification.status === "checksum-mismatch" ||
    verification.status === "size-mismatch" ||
    verification.status === "invalid-metadata" ||
    verification.status === "untrusted-metadata"
  ) {
    return {
      status: "refused",
      code: "corrupt",
      reason: verification.detail,
    };
  }

  return {
    status: "refused",
    code: "not-candidate",
    reason: `Version ${version} is not an eligible rollback candidate`,
  };
}

/**
 * Read-only rollback plan. Does not mutate launcher, manifest, locks, or store.
 */
export async function planRollback(
  layoutOrOptions: InstallLayoutPaths | RollbackOptions = {},
  maybeOptions?: RollbackOptions,
): Promise<RollbackPlanResult> {
  const options: RollbackOptions =
    layoutOrOptions && "versionsDir" in layoutOrOptions
      ? { ...maybeOptions, layout: layoutOrOptions }
      : (layoutOrOptions as RollbackOptions);
  const layout = options.layout ?? getInstallLayoutPaths();

  const manifest = await readInstallManifest(layout.configDir);
  if (!manifest) {
    return {
      status: "refused",
      code: "missing-manifest",
      reason: "No install manifest found; rollback requires a native binary install",
    };
  }
  if (manifest.method !== "binary") {
    return {
      status: "refused",
      code: "non-native",
      reason: `Rollback is only supported for native binary installs (found ${manifest.method})`,
    };
  }

  let targetVersion: string;
  if (options.to !== undefined) {
    const canonical = parseCanonicalVersion(options.to);
    if (!canonical) {
      return {
        status: "refused",
        code: "invalid-version",
        reason: `Invalid rollback version: ${options.to}`,
      };
    }
    targetVersion = canonical;
  } else if (manifest.previousVersion) {
    targetVersion = manifest.previousVersion;
  } else {
    return {
      status: "refused",
      code: "no-previous",
      reason: "No previousVersion recorded in the install manifest",
    };
  }

  if (targetVersion === manifest.activeVersion) {
    return {
      status: "refused",
      code: "already-active",
      reason: `Version ${targetVersion} is already active`,
    };
  }

  const candidates = await listRollbackCandidates(layout);
  const candidate = candidates.find((entry) => entry.version === targetVersion);
  if (!candidate) {
    return diagnoseTargetRefusal(layout, targetVersion);
  }

  return {
    status: "ready",
    fromVersion: manifest.activeVersion,
    candidate,
  };
}

async function restoreLauncher(
  launcherPath: string,
  previousTarget: string | null,
  platform: NodeJS.Platform,
): Promise<void> {
  if (!previousTarget) return;
  await updateLauncher({ launcherPath, versionPath: previousTarget, platform });
}

async function readLauncherTarget(launcherPath: string): Promise<string | null> {
  if (!existsSync(launcherPath)) return null;
  if (process.platform === "win32") return null;
  try {
    return await readlink(launcherPath);
  } catch {
    return null;
  }
}

/**
 * Activate a local verified version. Never downloads historical binaries.
 * Reverifies under a rollback transaction + version lock before swapping.
 */
export async function executeRollback(
  layoutOrOptions: InstallLayoutPaths | RollbackOptions = {},
  maybeOptions?: RollbackOptions,
): Promise<RollbackExecuteResult> {
  const options: RollbackOptions =
    layoutOrOptions && "versionsDir" in layoutOrOptions
      ? { ...maybeOptions, layout: layoutOrOptions }
      : (layoutOrOptions as RollbackOptions);
  const layout = options.layout ?? getInstallLayoutPaths();

  const plan = await planRollback({ ...options, layout });
  if (plan.status === "refused") {
    return plan;
  }

  if (options.dryRun) {
    return {
      status: "dry-run",
      fromVersion: plan.fromVersion,
      toVersion: plan.candidate.version,
    };
  }

  const { candidate, fromVersion } = plan;
  const previousLauncherTarget = await readLauncherTarget(layout.launcherPath);

  try {
    const locked = await withVersionLock(
      layout,
      candidate.version,
      async () => {
        const transaction = await beginInstallTransaction(layout, {
          kind: "rollback",
          version: candidate.version,
        });

        try {
          const reverify = await verifyStoredVersion(layout, candidate.version);
          if (reverify.status !== "verified") {
            throw new Error(
              reverify.status === "missing-binary" || reverify.status === "missing-metadata"
                ? reverify.detail
                : `Rollback re-verification failed: ${reverify.detail}`,
            );
          }

          await updateLauncher({
            launcherPath: layout.launcherPath,
            versionPath: candidate.versionPath,
          });

          const manifest = (await readInstallManifest(layout.configDir)) as InstallManifest;
          try {
            await writeInstallManifest(
              {
                method: "binary",
                activeVersion: candidate.version,
                previousVersion: fromVersion,
                launcherPath: manifest.launcherPath,
                versionedPath: candidate.versionPath,
                downloadBaseUrl: manifest.downloadBaseUrl,
                target: candidate.target,
                artifactSha256: candidate.artifactSha256,
                managedPaths: manifest.managedPaths,
                ...(manifest.observedProvenance
                  ? { observedProvenance: manifest.observedProvenance }
                  : {}),
              },
              layout.configDir,
            );
          } catch (manifestError) {
            await restoreLauncher(
              layout.launcherPath,
              previousLauncherTarget ?? versionBinaryPath(layout, fromVersion),
              process.platform,
            );
            throw manifestError;
          }

          await finishInstallTransaction(layout, transaction.id);
          return {
            status: "rolled-back" as const,
            fromVersion,
            toVersion: candidate.version,
          };
        } catch (error) {
          await finishInstallTransaction(layout, transaction.id).catch(() => {});
          throw error;
        }
      },
      { requireLock: true },
    );

    if (locked === null) {
      return {
        status: "refused",
        code: "locked",
        reason: `Version ${candidate.version} is locked by a live process`,
      };
    }

    return locked;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/locked|Install lock held/i.test(message)) {
      return {
        status: "refused",
        code: "locked",
        reason: message,
      };
    }
    if (/missing|not present/i.test(message)) {
      return { status: "refused", code: "missing", reason: message };
    }
    if (/checksum|size-mismatch|re-verification|untrusted|invalid-metadata/i.test(message)) {
      return { status: "refused", code: "corrupt", reason: message };
    }
    return { status: "failed", error: message };
  }
}
