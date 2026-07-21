import { homedir } from "node:os";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

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

function defaultLauncherPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "kunai", "bin", "kunai.exe");
  }
  const binDir = process.env.KUNAI_BIN_DIR ?? join(homedir(), ".local", "bin");
  return join(binDir, "kunai");
}

function binaryFileName(platform: NodeJS.Platform = process.platform): string {
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
  const kunai = getKunaiPaths();
  const dataDir = overrides.dataDir ?? kunai.dataDir;
  const cacheDir = overrides.cacheDir ?? kunai.cacheDir;
  const configDir = overrides.configDir ?? kunai.configDir;
  const platform = overrides.platform ?? process.platform;

  return {
    dataDir,
    cacheDir,
    configDir,
    versionsDir: join(dataDir, "versions"),
    locksDir: join(dataDir, "locks"),
    transactionsDir: join(dataDir, "transactions"),
    stagingRoot: join(cacheDir, "staging"),
    launcherPath: overrides.launcherPath ?? defaultLauncherPath(platform),
    binaryFileName: binaryFileName(platform),
  };
}

/** Absolute path for a versioned binary: `{dataDir}/versions/{semver}/kunai`. */
export function versionBinaryPath(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return join(layout.versionsDir, canonical, layout.binaryFileName);
}

/** Staging directory for a download: `{cacheDir}/staging/{semver}/`. */
export function stagingDirForVersion(
  layout: Pick<InstallLayoutPaths, "stagingRoot">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return join(layout.stagingRoot, canonical);
}

/** Lock file for a version install: `{dataDir}/locks/{semver}.lock`. */
export function lockFilePath(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return join(layout.locksDir, `${canonical}.lock`);
}

/** Per-version metadata sidecar: `{dataDir}/versions/{semver}/version.json`. */
export function versionMetadataPath(
  layout: Pick<InstallLayoutPaths, "versionsDir">,
  version: string,
): string {
  const canonical = requireCanonicalVersion(version);
  return join(layout.versionsDir, canonical, "version.json");
}

/** Install transaction record: `{dataDir}/transactions/{id}.json`. */
export function transactionFilePath(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
  id: string,
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid install transaction id: ${id}`);
  }
  return join(layout.transactionsDir, `${id}.json`);
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
