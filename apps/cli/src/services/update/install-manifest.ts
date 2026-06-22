import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import type { InstallMethodKind } from "./install-method";

/**
 * Records how this Kunai install happened so `kunai upgrade` / `kunai uninstall`
 * route to the correct mechanism per channel and never fight another installer.
 * Authoritative when present; otherwise callers fall back to `detectInstallMethod`.
 */
export type InstallLayoutKind = "flat" | "versioned";

export type InstallManifest = {
  readonly channel: InstallMethodKind;
  readonly version: string;
  /** Launcher path (~/.local/bin/kunai or Windows bin/kunai.exe). */
  readonly binPath: string;
  /** Versioned binary path under dataDir/versions (binary channel). */
  readonly versionPath?: string;
  readonly dlBase: string;
  readonly installedAt: string;
  readonly layout?: InstallLayoutKind;
};

const FILENAME = "install.json";

export async function readInstallManifest(
  configDir = getKunaiPaths().configDir,
): Promise<InstallManifest | null> {
  const path = join(configDir, FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as InstallManifest;
  } catch {
    return null;
  }
}

export async function writeInstallManifest(
  partial: Omit<InstallManifest, "installedAt">,
  configDir = getKunaiPaths().configDir,
): Promise<void> {
  const path = join(configDir, FILENAME);
  await mkdir(configDir, { recursive: true });
  const full: InstallManifest = { ...partial, installedAt: new Date().toISOString() };
  // Atomic: temp file in the target dir + rename (CLAUDE.md fs guidance).
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(full, null, 2)}\n`);
  await rename(tmp, path);
}
