import { rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getKunaiPaths, joinerForNodePlatform, type StoragePlatform } from "@kunai/storage";

import { parseCanonicalVersion, type CanonicalVersion } from "../version";

/** Number of versioned binaries to retain beyond protected versions. */
export const VERSION_RETENTION_COUNT = 2;

export const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

export type InstallLayoutPaths = {
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly configDir: string;
  readonly versionsDir: string;
  readonly locksDir: string;
  readonly transactionsDir: string;
  readonly stagingRoot: string;
  readonly launcherPath: string;
  readonly binaryFileName: string;
};

function requireCanonicalVersion(version: string): CanonicalVersion {
  const parsed = parseCanonicalVersion(version);
  if (!parsed) {
    throw new Error(`Invalid install version for path: ${version}`);
  }
  return parsed;
}

/** `getKunaiPaths` speaks the three storage platforms; everything else is Linux-shaped. */
function storagePlatformFor(platform: NodeJS.Platform): StoragePlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

function defaultLauncherPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "kunai", "bin", "kunai.exe");
  }
  const binDir = process.env.KUNAI_BIN_DIR ?? join(homedir(), ".local", "bin");
  return join(binDir, "kunai");
}

/**
 * The launcher's filename on a given platform.
 *
 * Exported because it is a real cross-platform contract, not an internal
 * detail: Windows resolves executables through PATHEXT, so a launcher named
 * `kunai` with no extension is invisible to PATH lookup there. Anything that
 * constructs or seeds a launcher path has to agree with this.
 */
export function binaryFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "kunai.exe" : "kunai";
}

/**
 * Frozen on-disk layout for native binary installs. Shell installers (`install.sh`,
 * `install.ps1`) mirror these paths — keep header comments in sync when changing.
 */
export function getInstallLayoutPaths(
  overrides: {
    readonly dataDir?: string;
    readonly cacheDir?: string;
    readonly configDir?: string;
    readonly launcherPath?: string;
    readonly platform?: NodeJS.Platform;
  } = {},
): InstallLayoutPaths {
  const platform = overrides.platform ?? process.platform;
  // Resolve the storage dirs for the *same* platform as the launcher and binary
  // name. Calling getKunaiPaths() bare made `platform: "win32"` on Linux return a
  // Windows launcher beside Linux XDG dirs -- a layout no real machine has, so
  // installer tests could agree with each other and disagree with production.
  const kunai = getKunaiPaths({ platform: storagePlatformFor(platform) });
  const dataDir = overrides.dataDir ?? kunai.dataDir;
  const cacheDir = overrides.cacheDir ?? kunai.cacheDir;
  const configDir = overrides.configDir ?? kunai.configDir;
  // Join for `platform`, not for the host. `node:path` always follows the host,
  // so asking for a Linux layout from Windows returned `\data\kunai\versions` —
  // the storage dirs above were already resolved for the target platform, and
  // the separators then contradicted them.
  const joinFor = joinerForNodePlatform(platform);

  return {
    dataDir,
    cacheDir,
    configDir,
    versionsDir: joinFor(dataDir, "versions"),
    locksDir: joinFor(dataDir, "locks"),
    transactionsDir: joinFor(dataDir, "transactions"),
    stagingRoot: joinFor(cacheDir, "staging"),
    launcherPath: overrides.launcherPath ?? defaultLauncherPath(platform),
    binaryFileName: binaryFileName(platform),
  };
}

/**
 * Joiner matching the layout's own platform, inferred from the directories it
 * already carries.
 *
 * These helpers receive a layout, not a platform, and used `node:path` — which
 * follows the host. Given a Linux layout on Windows they produced
 * `\data\kunai\versions\1.2.3\kunai`, contradicting the very layout passed in.
 * A Windows layout is rooted at a drive (`C:\…`) or a UNC path; nothing else is.
 */
function joinerForLayoutPath(anyLayoutDir: string): (...segments: string[]) => string {
  const isWindowsLayout = /^[A-Za-z]:[\\/]/.test(anyLayoutDir) || anyLayoutDir.startsWith("\\\\");
  return joinerForNodePlatform(isWindowsLayout ? "win32" : "linux");
}

/** Absolute path for a versioned binary: `{dataDir}/versions/{semver}/kunai`. */
export function versionBinaryPath(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return joinerForLayoutPath(layout.versionsDir)(
    layout.versionsDir,
    canonical,
    layout.binaryFileName,
  );
}

/** Staging directory for a download: `{cacheDir}/staging/{semver}/`. */
export function stagingDirForVersion(
  layout: Pick<InstallLayoutPaths, "stagingRoot">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return joinerForLayoutPath(layout.stagingRoot)(layout.stagingRoot, canonical);
}

/**
 * Remove a txn staging directory and prune empty version/staging parents left
 * by `mkdir -p` so failed or completed installs leave no operational residue.
 */
export async function removeStagingAndPruneParents(
  stagingPath: string,
  stagingRoot: string,
): Promise<void> {
  await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
  await pruneEmptyStagingParents(stagingPath, stagingRoot);
}

/** Normalized for prefix comparison: forward slashes, no trailing separator. */
function normalizeDirPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

/** True when `path` sits inside `root` (and is not `root` itself). */
export function isInsideStagingRoot(path: string, root: string): boolean {
  const normalizedRoot = normalizeDirPath(root);
  const normalizedPath = normalizeDirPath(path);
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * Walk up from `stagingPath` removing now-empty directories, stopping at
 * `stagingRoot`, then drop the root itself if it too is empty. `rmdir` only
 * succeeds on empty directories, so a concurrent install's staging tree is
 * never removed out from under it.
 */
export async function pruneEmptyStagingParents(
  stagingPath: string,
  stagingRoot: string,
): Promise<void> {
  let parent = dirname(stagingPath);
  while (isInsideStagingRoot(parent, stagingRoot)) {
    try {
      await rmdir(parent);
    } catch {
      return;
    }
    parent = dirname(parent);
  }
  await rmdir(stagingRoot).catch(() => {});
}

/** Lock file for a version install: `{dataDir}/locks/{semver}.lock`. */
export function lockFilePath(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return joinerForLayoutPath(layout.locksDir)(layout.locksDir, `${canonical}.lock`);
}

/** Per-version metadata sidecar: `{dataDir}/versions/{semver}/version.json`. */
export function versionMetadataPath(
  layout: Pick<InstallLayoutPaths, "versionsDir">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return joinerForLayoutPath(layout.versionsDir)(layout.versionsDir, canonical, "version.json");
}

/** Install transaction record: `{dataDir}/transactions/{id}.json`. */
export function transactionFilePath(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
  id: string,
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid install transaction id: ${id}`);
  }
  return joinerForLayoutPath(layout.transactionsDir)(layout.transactionsDir, `${id}.json`);
}

/** True when `execPath` lives under the versioned store. */
export function isVersionedExecPath(
  execPath: string,
  layout: Pick<InstallLayoutPaths, "versionsDir"> = getInstallLayoutPaths(),
): boolean {
  const normalized = execPath.replaceAll("\\", "/");
  const versions = layout.versionsDir.replaceAll("\\", "/");
  return normalized.includes(`${versions}/`);
}

/** Extract strict semver from a versioned exec path, or null. */
export function parseVersionFromExecPath(
  execPath: string,
  layout: Pick<InstallLayoutPaths, "versionsDir"> = getInstallLayoutPaths(),
): CanonicalVersion | null {
  const normalized = execPath.replaceAll("\\", "/");
  const versions = layout.versionsDir.replaceAll("\\", "/");
  const idx = normalized.indexOf(`${versions}/`);
  if (idx === -1) return null;
  const rest = normalized.slice(idx + versions.length + 1);
  const segment = rest.split("/")[0];
  return segment ? parseCanonicalVersion(segment) : null;
}
