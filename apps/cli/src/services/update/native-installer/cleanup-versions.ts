import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { readInstallManifest } from "../install-manifest";
import { compareCanonicalVersions, parseCanonicalVersion } from "../version";
import {
  getInstallLayoutPaths,
  parseVersionFromExecPath,
  VERSION_RETENTION_COUNT,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import { readLockContent, tryAcquireVersionLock } from "./version-lock";

function compareSemverDesc(a: string, b: string): number {
  const left = parseCanonicalVersion(a);
  const right = parseCanonicalVersion(b);
  if (!left || !right) return 0;
  return compareCanonicalVersions(right, left);
}

async function listVersionDirs(versionsDir: string): Promise<string[]> {
  if (!existsSync(versionsDir)) return [];
  const entries = await readdir(versionsDir).catch(() => [] as string[]);
  const versions: string[] = [];
  for (const entry of entries) {
    const canonical = parseCanonicalVersion(entry);
    if (!canonical) continue;
    const binPath = join(
      versionsDir,
      canonical,
      process.platform === "win32" ? "kunai.exe" : "kunai",
    );
    if (existsSync(binPath)) versions.push(canonical);
  }
  return versions.sort(compareSemverDesc);
}

async function isVersionProtected(
  layout: InstallLayoutPaths,
  version: string,
  protectedPaths: Set<string>,
): Promise<boolean> {
  const versionPath = versionBinaryPath(layout, version);
  if (protectedPaths.has(versionPath)) return true;
  const lock = await tryAcquireVersionLock(layout, version);
  if (!lock.acquired) return true;
  await lock.release();
  const content = await readLockContent(join(layout.locksDir, `${version}.lock`));
  if (content && content.pid !== process.pid) {
    try {
      process.kill(content.pid, 0);
      return true;
    } catch {
      // stale
    }
  }
  return false;
}

/**
 * Retain VERSION_RETENTION_COUNT newest eligible versions; delete older ones.
 * Fire-and-forget safe — errors are swallowed.
 */
export async function cleanupOldVersions(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
  execPath: string = process.execPath,
): Promise<void> {
  const protectedPaths = new Set<string>([execPath]);
  const runningVersion = parseVersionFromExecPath(execPath, layout);
  if (runningVersion) {
    protectedPaths.add(versionBinaryPath(layout, runningVersion));
  }

  try {
    const { readlink } = await import("node:fs/promises");
    if (existsSync(layout.launcherPath) && process.platform !== "win32") {
      try {
        const target = await readlink(layout.launcherPath);
        protectedPaths.add(target);
      } catch {
        // not a symlink
      }
    }
  } catch {
    // ignore
  }

  // Protect active + previous (explicit rollback candidate) from retention deletion.
  const manifest = await readInstallManifest(layout.configDir).catch(() => null);
  if (manifest?.activeVersion && parseCanonicalVersion(manifest.activeVersion)) {
    protectedPaths.add(versionBinaryPath(layout, manifest.activeVersion));
  }
  if (manifest?.previousVersion && parseCanonicalVersion(manifest.previousVersion)) {
    protectedPaths.add(versionBinaryPath(layout, manifest.previousVersion));
  }

  const versions = await listVersionDirs(layout.versionsDir);
  const eligible: string[] = [];
  for (const version of versions) {
    if (await isVersionProtected(layout, version, protectedPaths)) continue;
    eligible.push(version);
  }

  const toDelete = eligible.slice(VERSION_RETENTION_COUNT);
  for (const version of toDelete) {
    const dir = join(layout.versionsDir, version);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  await cleanupOrphanStaging(layout);
  await cleanupTempInstallFiles(layout);
  const { cleanupAbandonedTransactions } = await import("./transaction");
  await cleanupAbandonedTransactions(layout).catch(() => {});
}

async function cleanupOrphanStaging(layout: InstallLayoutPaths): Promise<void> {
  if (!existsSync(layout.stagingRoot)) return;
  const oneHourAgo = Date.now() - 3_600_000;
  for (const entry of await readdir(layout.stagingRoot).catch(() => [] as string[])) {
    const path = join(layout.stagingRoot, entry);
    try {
      const s = await stat(path);
      if (s.mtimeMs < oneHourAgo) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function cleanupTempInstallFiles(layout: InstallLayoutPaths): Promise<void> {
  if (!existsSync(layout.versionsDir)) return;
  for (const version of await readdir(layout.versionsDir).catch(() => [] as string[])) {
    const canonical = parseCanonicalVersion(version);
    if (!canonical) continue;
    const dir = join(layout.versionsDir, canonical);
    for (const entry of await readdir(dir).catch(() => [] as string[])) {
      if (entry.includes(".tmp.")) {
        await rm(join(dir, entry), { force: true }).catch(() => {});
      }
    }
  }
}
