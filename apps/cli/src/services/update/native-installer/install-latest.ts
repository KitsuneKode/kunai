import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifestUnderActivation } from "../install-manifest";
import { fetchLatestVersion } from "../latest-version";
import {
  detectPlatform,
  releaseAssetName,
  resolveReleaseBinaryTarget,
  type PlatformLibc,
} from "../platform-assets";
import { pickChecksum, verifyChecksum } from "../self-replace";
import { normalizeRequestedVersion, parseCanonicalVersion } from "../version";
import { withActivationLock } from "./activation-lock";
import { cleanupOldVersions } from "./cleanup-versions";
import {
  DEFAULT_BINARY_DOWNLOAD_POLICY,
  DEFAULT_CHECKSUM_DOWNLOAD_POLICY,
  DownloadError,
  downloadToFile,
  type FetchLike,
} from "./download";
import {
  DEFAULT_DL_BASE,
  getInstallLayoutPaths,
  removeStagingAndPruneParents,
  stagingDirForVersion,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import {
  atomicInstallBinaryFromFile,
  captureLauncherSnapshot,
  discardLauncherSnapshot,
  restoreLauncherSnapshot,
  updateLauncher,
} from "./launcher";
import { isMuslEnvironmentSync } from "./musl";
import { extractReleaseArchive } from "./release-archive";
import {
  beginInstallTransaction,
  cleanupAbandonedTransactions,
  finishInstallTransaction,
} from "./transaction";
import { withVersionLock } from "./version-lock";
import { writeInstalledVersionMetadata } from "./version-metadata";

export type InstallLatestResult =
  | { readonly status: "up-to-date"; readonly version: string }
  | { readonly status: "installed"; readonly version: string; readonly versionPath: string }
  | { readonly status: "skipped"; readonly reason: "lock-contention" }
  | { readonly status: "failed"; readonly error: string };

export type InstallLatestOptions = {
  readonly version?: string;
  readonly force?: boolean;
  readonly dlBase?: string;
  readonly layout?: InstallLayoutPaths;
  readonly fetchImpl?: FetchLike;
  readonly libc?: PlatformLibc;
};

let inFlightInstall: Promise<InstallLatestResult> | null = null;

/**
 * Download, verify, and install the latest (or pinned) binary into the versioned
 * store, then update the launcher symlink. Module-level singleflight.
 */
export function installLatest(options: InstallLatestOptions = {}): Promise<InstallLatestResult> {
  if (inFlightInstall) return inFlightInstall;
  const promise = installLatestImpl(options).finally(() => {
    if (inFlightInstall === promise) inFlightInstall = null;
  });
  inFlightInstall = promise;
  return promise;
}

async function installLatestImpl(options: InstallLatestOptions): Promise<InstallLatestResult> {
  const layout = options.layout ?? getInstallLayoutPaths();
  const manifest = await readInstallManifest(layout.configDir);
  const dlBase = options.dlBase ?? manifest?.downloadBaseUrl ?? DEFAULT_DL_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  const resolved =
    options.version && options.version !== "latest"
      ? normalizeRequestedVersion(options.version)
      : parseCanonicalVersion((await fetchLatestVersion(fetchImpl as typeof fetch)) ?? "");
  if (!resolved) {
    return { status: "failed", error: "Could not resolve target version." };
  }

  const { os, arch } = detectPlatform();
  if (!os || !arch) {
    return { status: "failed", error: "Could not detect OS/arch." };
  }

  const libc = options.libc ?? (os === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu");
  const assetName = releaseAssetName(os, arch, libc);
  const releaseTarget = resolveReleaseBinaryTarget(os, arch, libc);
  const tag = `v${resolved}`;
  const downloadUrl = `${dlBase}/download/${tag}/${assetName}`;
  const checksumUrl = `${dlBase}/download/${tag}/SHA256SUMS`;
  const archiveName = releaseTarget?.archiveName;
  const archiveUrl = archiveName ? `${dlBase}/download/${tag}/${archiveName}` : undefined;
  const archiveChecksumUrl = `${dlBase}/download/${tag}/SHA256SUMS.archives`;
  const versionPath = versionBinaryPath(layout, resolved);

  if (!options.force && existsSync(versionPath) && manifest?.activeVersion === resolved) {
    return { status: "up-to-date", version: resolved };
  }

  try {
    const result = await withVersionLock(layout, resolved, async () => {
      await cleanupAbandonedTransactions(layout).catch(() => {});
      await rm(stagingDirForVersion(layout, resolved), { recursive: true, force: true }).catch(
        () => {},
      );

      const staging = join(
        stagingDirForVersion(layout, resolved),
        `txn-${process.pid}-${Date.now()}`,
      );
      await mkdir(staging, { recursive: true });

      const transaction = await beginInstallTransaction(layout, {
        kind:
          manifest?.activeVersion && manifest.activeVersion !== resolved ? "upgrade" : "install",
        version: resolved,
        stagingDir: staging,
      });

      const stagedBinary = join(staging, assetName);
      const stagedChecksums = join(staging, "SHA256SUMS");
      const stagedArchiveChecksums = join(staging, "SHA256SUMS.archives");
      const stagedArchive = archiveName ? join(staging, archiveName) : undefined;

      try {
        await downloadToFile({
          url: checksumUrl,
          destinationPath: stagedChecksums,
          fetchImpl,
          policy: DEFAULT_CHECKSUM_DOWNLOAD_POLICY,
        });
        const sumsText = await readFile(stagedChecksums, "utf8");
        const expected = pickChecksum(sumsText, assetName);
        if (!expected) {
          throw new Error(`No checksum entry for ${assetName}`);
        }

        let artifactSha256: string;
        let artifactSizeBytes: number;
        let archiveProvenance:
          | {
              readonly archiveName: string;
              readonly archiveSha256: string;
              readonly archiveSizeBytes: number;
              readonly archiveSourceUrl: string;
            }
          | undefined;

        let archiveManifestAvailable = Boolean(
          releaseTarget && archiveName && archiveUrl && stagedArchive,
        );
        if (archiveManifestAvailable) {
          try {
            await downloadToFile({
              url: archiveChecksumUrl,
              destinationPath: stagedArchiveChecksums,
              fetchImpl,
              policy: DEFAULT_CHECKSUM_DOWNLOAD_POLICY,
            });
          } catch (error) {
            if (error instanceof DownloadError && (error.status === 404 || error.status === 410)) {
              archiveManifestAvailable = false;
            } else {
              throw error;
            }
          }
        }

        if (
          archiveManifestAvailable &&
          releaseTarget &&
          archiveName &&
          archiveUrl &&
          stagedArchive
        ) {
          const archiveSums = await readFile(stagedArchiveChecksums, "utf8");
          const expectedArchive = pickChecksum(archiveSums, archiveName);
          if (!expectedArchive) throw new Error(`No checksum entry for ${archiveName}`);
          const archiveDownload = await downloadToFile({
            url: archiveUrl,
            destinationPath: stagedArchive,
            fetchImpl,
            policy: {
              ...DEFAULT_BINARY_DOWNLOAD_POLICY,
              maxBytes: releaseTarget.maxArchiveBytes,
            },
          });
          if (!verifyChecksum(archiveDownload.sha256, expectedArchive)) {
            throw new Error(`Checksum mismatch for ${archiveName}`);
          }

          const archiveBytes = new Uint8Array(await Bun.file(stagedArchive).arrayBuffer());
          const binaryBytes = extractReleaseArchive(archiveBytes, releaseTarget);
          artifactSha256 = createHash("sha256").update(binaryBytes).digest("hex");
          artifactSizeBytes = binaryBytes.length;
          if (!verifyChecksum(artifactSha256, expected)) {
            throw new Error(`Checksum mismatch for extracted ${assetName}`);
          }
          await Bun.write(stagedBinary, binaryBytes);
          archiveProvenance = {
            archiveName,
            archiveSha256: archiveDownload.sha256,
            archiveSizeBytes: archiveDownload.sizeBytes,
            archiveSourceUrl: archiveUrl,
          };
        } else {
          const downloaded = await downloadToFile({
            url: downloadUrl,
            destinationPath: stagedBinary,
            fetchImpl,
            policy: DEFAULT_BINARY_DOWNLOAD_POLICY,
          });
          if (!verifyChecksum(downloaded.sha256, expected)) {
            throw new Error(`Checksum mismatch for ${assetName}`);
          }
          artifactSha256 = downloaded.sha256;
          artifactSizeBytes = downloaded.sizeBytes;
        }

        await mkdir(dirname(versionPath), { recursive: true });
        await atomicInstallBinaryFromFile(stagedBinary, versionPath);

        await writeInstalledVersionMetadata(layout, {
          schemaVersion: 1,
          version: resolved,
          target: releaseTarget?.id ?? `${os}-${arch}`,
          artifactName: assetName,
          artifactSha256,
          sizeBytes: artifactSizeBytes,
          sourceUrl: downloadUrl,
          ...archiveProvenance,
          verification: "release-checksum",
          installedAt: new Date().toISOString(),
        });

        const activated = await withActivationLock(layout, resolved, async () => {
          // Another version may have activated while this version downloaded.
          // Re-read shared state only after winning the cross-version lock.
          const activeManifest = await readInstallManifest(layout.configDir);
          const launcherPath = activeManifest?.launcherPath ?? layout.launcherPath;
          const launcherSnapshot = await captureLauncherSnapshot(launcherPath);
          let preserveSnapshot = false;

          try {
            await updateLauncher({
              launcherPath,
              versionPath,
            });
            await writeInstallManifestUnderActivation(
              {
                method: "binary",
                activeVersion: resolved,
                launcherPath,
                versionedPath: versionPath,
                downloadBaseUrl: dlBase,
                target: releaseTarget?.id ?? `${os}-${arch}`,
                artifactName: assetName,
                artifactSha256,
                artifactSizeBytes,
                artifactSourceUrl: downloadUrl,
                ...archiveProvenance,
                ...(activeManifest?.activeVersion && activeManifest.activeVersion !== resolved
                  ? { previousVersion: activeManifest.activeVersion }
                  : {}),
              },
              layout,
            );
          } catch (manifestError) {
            try {
              await restoreLauncherSnapshot(launcherSnapshot);
            } catch (restoreError) {
              preserveSnapshot = true;
              const recoveryFailure = new Error(
                "Install manifest commit and launcher restoration both failed",
                { cause: restoreError },
              );
              Object.assign(recoveryFailure, { errors: [manifestError, restoreError] });
              throw recoveryFailure;
            }
            throw manifestError;
          } finally {
            if (!preserveSnapshot) {
              await discardLauncherSnapshot(launcherSnapshot).catch(() => {});
            }
          }
        });

        await finishInstallTransaction(layout, transaction.id);
        await removeStagingAndPruneParents(staging, layout.stagingRoot);

        if (activated === null) {
          return { status: "skipped" as const, reason: "lock-contention" as const };
        }

        void cleanupOldVersions(layout);

        return { status: "installed" as const, version: resolved, versionPath };
      } catch (error) {
        await finishInstallTransaction(layout, transaction.id).catch(() => {});
        await removeStagingAndPruneParents(staging, layout.stagingRoot);
        throw error;
      }
    });

    if (result === null) {
      return { status: "skipped", reason: "lock-contention" };
    }

    return result;
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type SetupMessage = {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
};

/** PATH and launcher diagnostics after install. */
export async function checkInstall(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
): Promise<SetupMessage[]> {
  const messages: SetupMessage[] = [];
  const pathEnv = process.env.PATH ?? "";
  const binDir = dirname(layout.launcherPath);

  if (!existsSync(layout.launcherPath)) {
    messages.push({ level: "error", message: `Launcher missing: ${layout.launcherPath}` });
    return messages;
  }

  if (!pathEnv.split(":").includes(binDir) && !pathEnv.split(";").includes(binDir)) {
    messages.push({
      level: "warn",
      message: `Add ${binDir} to your PATH, then restart your shell.`,
    });
  } else {
    messages.push({ level: "info", message: `Launcher ready at ${layout.launcherPath}` });
  }

  return messages;
}
