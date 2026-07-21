import { existsSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";

import type { InstallManifest } from "../install-manifest";
import { writeInstallManifest } from "../install-manifest";
import { parseCanonicalVersion } from "../version";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import { updateLauncher } from "./launcher";

export type MigrateFlatResult =
  | { readonly migrated: false }
  | { readonly migrated: true; readonly versionPath: string };

/**
 * Move a legacy flat binary install into the versioned store before upgrade.
 */
export async function migrateFlatInstall(input: {
  readonly manifest: InstallManifest | null;
  readonly currentVersion: string;
  readonly execPath?: string;
  readonly layout?: InstallLayoutPaths;
}): Promise<MigrateFlatResult> {
  const layout = input.layout ?? getInstallLayoutPaths();
  const execPath = input.execPath ?? process.execPath;
  const manifest = input.manifest;

  if (manifest?.layout === "versioned" && manifest.versionPath) {
    return { migrated: false };
  }

  const channel = manifest?.channel;
  if (channel && channel !== "binary") return { migrated: false };

  const binPath = manifest?.binPath ?? layout.launcherPath;
  const sourcePath = existsSync(execPath) && !execPath.endsWith(".js") ? execPath : binPath;
  if (!existsSync(sourcePath)) return { migrated: false };

  const version = parseCanonicalVersion(manifest?.version ?? input.currentVersion);
  if (!version) return { migrated: false };

  const targetPath = versionBinaryPath(layout, version);
  if (existsSync(targetPath) && manifest?.layout === "versioned") {
    return { migrated: false };
  }

  await mkdir(layout.versionsDir, { recursive: true });
  const parent = targetPath.replace(/[/\\][^/\\]+$/, "");
  await mkdir(parent, { recursive: true });

  if (sourcePath !== targetPath) {
    if (existsSync(targetPath)) {
      await copyFile(sourcePath, `${targetPath}.migrating.${process.pid}`);
      await rename(`${targetPath}.migrating.${process.pid}`, targetPath);
    } else {
      await copyFile(sourcePath, targetPath);
    }
  }

  await updateLauncher({ launcherPath: layout.launcherPath, versionPath: targetPath });

  const dlBase = manifest?.dlBase ?? "https://github.com/KitsuneKode/kunai/releases";
  await writeInstallManifest({
    channel: "binary",
    version,
    binPath: layout.launcherPath,
    versionPath: targetPath,
    dlBase,
    layout: "versioned",
  });

  return { migrated: true, versionPath: targetPath };
}
