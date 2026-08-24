import { existsSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";

import {
  readInstallManifest,
  writeInstallManifest,
  type InstallManifest,
} from "../install-manifest";
import { parseCanonicalVersion } from "../version";
import { withActivationLock } from "./activation-lock";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import {
  captureLauncherSnapshot,
  discardLauncherSnapshot,
  restoreLauncherSnapshot,
  updateLauncher,
} from "./launcher";

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

  if (manifest?.versionedPath) {
    return { migrated: false };
  }

  const method = manifest?.method;
  if (method && method !== "binary") return { migrated: false };

  const binPath = manifest?.launcherPath ?? layout.launcherPath;
  const sourcePath = existsSync(execPath) && !execPath.endsWith(".js") ? execPath : binPath;
  if (!existsSync(sourcePath)) return { migrated: false };

  const version = parseCanonicalVersion(manifest?.activeVersion ?? input.currentVersion);
  if (!version) return { migrated: false };

  const targetPath = versionBinaryPath(layout, version);
  if (existsSync(targetPath) && manifest?.versionedPath) {
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

  const activated = await withActivationLock(layout, version, async () => {
    // A manual installer may have completed while the legacy binary was copied.
    // Re-evaluate shared state only after winning activation ownership.
    const activeManifest = await readInstallManifest(layout.configDir);
    if (
      activeManifest?.versionedPath ||
      (activeManifest?.method && activeManifest.method !== "binary")
    ) {
      return { migrated: false } as const;
    }

    const launcherPath = activeManifest?.launcherPath ?? layout.launcherPath;
    const launcherSnapshot = await captureLauncherSnapshot(launcherPath);

    let preserveBackup = false;
    try {
      await updateLauncher({ launcherPath, versionPath: targetPath });

      const downloadBaseUrl =
        activeManifest?.downloadBaseUrl ?? "https://github.com/KitsuneKode/kunai/releases";
      await writeInstallManifest(
        {
          method: "binary",
          activeVersion: version,
          launcherPath,
          versionedPath: targetPath,
          downloadBaseUrl,
        },
        layout.configDir,
      );

      return { migrated: true, versionPath: targetPath } as const;
    } catch (manifestError) {
      try {
        await restoreLauncherSnapshot(launcherSnapshot);
      } catch (restoreError) {
        preserveBackup = launcherSnapshot.kind === "file";
        const recoveryFailure = new Error(
          "Flat-install manifest commit and launcher restoration both failed",
          { cause: restoreError },
        );
        Object.assign(recoveryFailure, { errors: [manifestError, restoreError] });
        throw recoveryFailure;
      }
      throw manifestError;
    } finally {
      if (!preserveBackup) await discardLauncherSnapshot(launcherSnapshot).catch(() => {});
    }
  });

  return activated ?? { migrated: false };
}
