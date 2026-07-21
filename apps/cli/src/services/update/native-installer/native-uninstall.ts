import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  isVersionedBinaryManifest,
  readInstallManifest,
  type InstallManifest,
} from "../install-manifest";
import { getInstallLayoutPaths, type InstallLayoutPaths } from "./install-layout";
import {
  inspectLauncherOwnership,
  removeLauncherCopyAsides,
  removeLauncherIfVersioned,
} from "./launcher";
import {
  beginInstallTransaction,
  finishInstallTransaction,
  listInstallTransactions,
} from "./transaction";
import { cleanupStaleLocks, hasActiveVersionLocks, tryAcquireLifecycleLock } from "./version-lock";

export interface NativeUninstallResult {
  readonly status: "removed" | "blocked" | "partial";
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly failed: readonly { path: string; error: string }[];
}

export type NativeUninstallOptions = {
  readonly layout?: InstallLayoutPaths;
  readonly purge?: boolean;
  /** May reclaim stale locks; never deletes a live lock. */
  readonly force?: boolean;
  readonly platform?: NodeJS.Platform;
  /** External/custom download directories that must survive even `--purge`. */
  readonly preservePaths?: readonly string[];
  /** Test seam for simulating partial removal failures. */
  readonly rmImpl?: typeof rm;
};

type RmFn = typeof rm;

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hasActiveTransactions(
  layout: Pick<InstallLayoutPaths, "transactionsDir">,
): Promise<boolean> {
  for (const record of await listInstallTransactions(layout)) {
    if (isProcessAlive(record.pid)) return true;
  }
  return false;
}

function resolveExpectedSha256(manifest: InstallManifest | null): string | undefined {
  return manifest?.artifactSha256?.toLowerCase();
}

async function tryRemove(
  path: string,
  removed: string[],
  failed: { path: string; error: string }[],
  rmImpl: RmFn,
  recursive = true,
): Promise<boolean> {
  if (!existsSync(path)) return true;
  try {
    await rmImpl(path, { recursive, force: true });
    removed.push(path);
    return true;
  } catch (error) {
    failed.push({
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function blocked(preserved: readonly string[]): NativeUninstallResult {
  return { status: "blocked", removed: [], preserved: [...preserved], failed: [] };
}

/**
 * Ownership-safe native uninstall: removes installer-owned lifecycle residue and
 * (only with purge) standard user roots. Default preserves config/history/cache/downloads.
 */
export async function nativeUninstall(
  options: NativeUninstallOptions = {},
): Promise<NativeUninstallResult> {
  const layout = options.layout ?? getInstallLayoutPaths();
  const platform = options.platform ?? process.platform;
  const rmImpl = options.rmImpl ?? rm;
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const preserved: string[] = [];
  const downloadsDefault = join(layout.dataDir, "downloads");

  const manifest = await readInstallManifest(layout.configDir);
  if (!manifest || !isVersionedBinaryManifest(manifest)) {
    return blocked([layout.configDir, layout.dataDir, layout.cacheDir]);
  }

  // Active locks / transactions block before any mutation — force never deletes live locks.
  if (options.force) {
    await cleanupStaleLocks(layout);
  }
  if (await hasActiveVersionLocks(layout)) {
    return blocked([
      layout.launcherPath,
      layout.versionsDir,
      layout.configDir,
      layout.dataDir,
      layout.cacheDir,
    ]);
  }
  if (await hasActiveTransactions(layout)) {
    return blocked([
      layout.launcherPath,
      layout.versionsDir,
      layout.configDir,
      layout.dataDir,
      layout.cacheDir,
    ]);
  }

  const expectedSha256 = resolveExpectedSha256(manifest);
  const ownership = await inspectLauncherOwnership({
    launcherPath: layout.launcherPath,
    versionsDir: layout.versionsDir,
    expectedSha256,
    platform,
  });
  if (ownership === "unmanaged") {
    return blocked([
      layout.launcherPath,
      layout.versionsDir,
      join(layout.configDir, "install.json"),
    ]);
  }

  const lifecycle = await tryAcquireLifecycleLock(layout, {
    force: options.force,
    execPath: process.execPath,
  });
  if (!lifecycle.acquired) {
    return blocked([
      layout.launcherPath,
      layout.versionsDir,
      layout.configDir,
      layout.dataDir,
      layout.cacheDir,
    ]);
  }

  const transaction = await beginInstallTransaction(layout, {
    kind: "uninstall",
    version: manifest.activeVersion,
  });

  let lifecycleReleased = false;
  try {
    // 1. Launcher + owned copy-asides
    if (ownership === "managed") {
      const launcherRemoved = await removeLauncherIfVersioned({
        launcherPath: layout.launcherPath,
        versionsDir: layout.versionsDir,
        expectedSha256,
        platform,
      });
      if (launcherRemoved) removed.push(layout.launcherPath);
    }
    for (const aside of await removeLauncherCopyAsides(layout.launcherPath)) {
      removed.push(aside);
    }

    // 2. Versions / staging / transactions / locks
    await cleanupStaleLocks(layout);

    const versionsOk = await tryRemove(layout.versionsDir, removed, failed, rmImpl);
    const stagingOk = await tryRemove(layout.stagingRoot, removed, failed, rmImpl);

    if (existsSync(layout.transactionsDir)) {
      for (const entry of await readdir(layout.transactionsDir).catch(() => [] as string[])) {
        await tryRemove(join(layout.transactionsDir, entry), removed, failed, rmImpl, false);
      }
    }
    const transactionsOk = await tryRemove(layout.transactionsDir, removed, failed, rmImpl);

    if (existsSync(layout.locksDir)) {
      for (const entry of await readdir(layout.locksDir).catch(() => [] as string[])) {
        if (entry === "lifecycle.lock") continue;
        await tryRemove(join(layout.locksDir, entry), removed, failed, rmImpl, false);
      }
    }

    const lifecyclePartial = failed.length > 0 || !versionsOk || !stagingOk || !transactionsOk;

    // 3. Manifest last — only when lifecycle cleanup fully succeeded.
    const manifestPath = join(layout.configDir, "install.json");
    if (!lifecyclePartial) {
      await tryRemove(manifestPath, removed, failed, rmImpl, false);
    }

    // 4. Optional purge of user roots (never external/custom download dirs).
    //    Skip purge entirely on partial lifecycle failure so install.json and
    //    user roots survive (purge of configDir would otherwise wipe the manifest).
    const preserveSet = new Set(options.preservePaths ?? []);
    if (options.purge && !lifecyclePartial) {
      for (const root of [layout.configDir, layout.dataDir, layout.cacheDir]) {
        if (preserveSet.has(root)) {
          preserved.push(root);
          continue;
        }
        await tryRemove(root, removed, failed, rmImpl);
      }
      for (const path of preserveSet) {
        if (existsSync(path)) preserved.push(path);
      }
    } else {
      preserved.push(layout.configDir, layout.dataDir, layout.cacheDir);
      if (existsSync(downloadsDefault)) preserved.push(downloadsDefault);
      for (const path of preserveSet) {
        if (existsSync(path)) preserved.push(path);
      }
    }

    if (existsSync(join(layout.transactionsDir, `${transaction.id}.json`))) {
      await finishInstallTransaction(layout, transaction.id).catch(() => {});
    }

    // Release lifecycle lock before removing the locks directory.
    await lifecycle.release();
    lifecycleReleased = true;
    if (existsSync(layout.locksDir)) {
      const remaining = await readdir(layout.locksDir).catch(() => [] as string[]);
      for (const entry of remaining) {
        await tryRemove(join(layout.locksDir, entry), removed, failed, rmImpl, false);
      }
      await tryRemove(layout.locksDir, removed, failed, rmImpl);
    }

    return {
      status: failed.length > 0 ? "partial" : "removed",
      removed: [...new Set(removed)],
      preserved: [...new Set(preserved)],
      failed,
    };
  } finally {
    if (!lifecycleReleased) {
      await lifecycle.release();
    }
  }
}
