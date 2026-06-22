import { homedir } from "node:os";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/** Number of versioned binaries to retain beyond protected versions. */
export const VERSION_RETENTION_COUNT = 2;

export const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

export type InstallLayoutPaths = {
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly configDir: string;
  readonly versionsDir: string;
  readonly locksDir: string;
  readonly stagingRoot: string;
  readonly launcherPath: string;
  readonly binaryFileName: string;
};

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
  return join(layout.versionsDir, version, layout.binaryFileName);
}

/** Staging directory for a download: `{cacheDir}/staging/{semver}/`. */
export function stagingDirForVersion(
  layout: Pick<InstallLayoutPaths, "stagingRoot">,
  version: string,
): string {
  return join(layout.stagingRoot, version);
}

/** Lock file for a version install: `{dataDir}/locks/{semver}.lock`. */
export function lockFilePath(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
): string {
  return join(layout.locksDir, `${version}.lock`);
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

/** Extract semver from a versioned exec path, or null. */
export function parseVersionFromExecPath(
  execPath: string,
  layout: Pick<InstallLayoutPaths, "versionsDir"> = getInstallLayoutPaths(),
): string | null {
  const normalized = execPath.replaceAll("\\", "/");
  const versions = layout.versionsDir.replaceAll("\\", "/");
  const idx = normalized.indexOf(`${versions}/`);
  if (idx === -1) return null;
  const rest = normalized.slice(idx + versions.length + 1);
  const segment = rest.split("/")[0];
  return segment && /^\d+\.\d+\.\d+/.test(segment) ? segment : null;
}
