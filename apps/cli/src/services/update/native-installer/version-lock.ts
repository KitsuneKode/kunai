import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { getInstallLayoutPaths, lockFilePath, type InstallLayoutPaths } from "./install-layout";

export type VersionLockContent = {
  readonly pid: number;
  readonly version: string;
  readonly execPath: string;
  readonly acquiredAt: string;
};

export type LockAcquireResult =
  | { readonly acquired: true; readonly release: () => Promise<void> }
  | { readonly acquired: false; readonly holderPid?: number };

const LOCK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readLockContent(path: string): Promise<VersionLockContent | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as VersionLockContent;
  } catch {
    return null;
  }
}

async function isLockStale(path: string): Promise<boolean> {
  const content = await readLockContent(path);
  if (content) {
    if (!isProcessAlive(content.pid)) return true;
    const age = Date.now() - Date.parse(content.acquiredAt);
    return age > LOCK_STALE_MS;
  }
  try {
    const stat = await Bun.file(path).stat();
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/**
 * Try to acquire a per-version install lock. Contention returns acquired:false
 * (background updater should skip silently).
 */
export async function tryAcquireVersionLock(
  layout: InstallLayoutPaths,
  version: string,
  execPath: string = process.execPath,
): Promise<LockAcquireResult> {
  const path = lockFilePath(layout, version);
  await mkdir(layout.locksDir, { recursive: true });

  if (existsSync(path) && !(await isLockStale(path))) {
    const existing = await readLockContent(path);
    return { acquired: false, holderPid: existing?.pid };
  }

  if (existsSync(path)) {
    await rm(path, { force: true }).catch(() => {});
  }

  const content: VersionLockContent = {
    pid: process.pid,
    version,
    execPath,
    acquiredAt: new Date().toISOString(),
  };

  try {
    await writeFile(path, `${JSON.stringify(content)}\n`, { flag: "wx" });
  } catch {
    const existing = await readLockContent(path);
    return { acquired: false, holderPid: existing?.pid };
  }

  return {
    acquired: true,
    release: async () => {
      const current = await readLockContent(path);
      if (current?.pid === process.pid) {
        await rm(path, { force: true }).catch(() => {});
      }
    },
  };
}

/** Run `fn` under a version lock; throws if lock not acquired and `requireLock` is true. */
export async function withVersionLock<T>(
  layout: InstallLayoutPaths,
  version: string,
  fn: () => Promise<T>,
  options: { readonly requireLock?: boolean; readonly execPath?: string } = {},
): Promise<T | null> {
  const lock = await tryAcquireVersionLock(layout, version, options.execPath);
  if (!lock.acquired) {
    if (options.requireLock) {
      throw new Error(
        `Install lock held${lock.holderPid ? ` by pid ${lock.holderPid}` : ""} for version ${version}`,
      );
    }
    return null;
  }
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

let lifetimeLockPath: string | null = null;
let lifetimeLockRelease: (() => Promise<void>) | null = null;

/**
 * Hold a process-lifetime lock when running from the versioned store.
 *
 * Registers no signal or exit handlers: the shutdown coordinator releases the
 * lock through releaseCurrentVersionLock(), and a crashed process leaves a
 * stale lock that the liveness check reclaims on the next run.
 */
export async function lockCurrentVersion(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
  execPath: string = process.execPath,
): Promise<void> {
  const { isVersionedExecPath, parseVersionFromExecPath } = await import("./install-layout");
  if (!isVersionedExecPath(execPath, layout)) return;
  const version = parseVersionFromExecPath(execPath, layout);
  if (!version) return;

  const path = lockFilePath(layout, version);
  if (lifetimeLockPath === path) return;

  const lock = await tryAcquireVersionLock(layout, version, execPath);
  if (!lock.acquired) return;

  lifetimeLockPath = path;
  lifetimeLockRelease = lock.release;
}

/** Release the process-lifetime lock; concurrent calls release exactly once. */
export async function releaseCurrentVersionLock(): Promise<void> {
  const release = lifetimeLockRelease;
  lifetimeLockRelease = null;
  lifetimeLockPath = null;
  if (!release) return;
  await release();
}

export async function cleanupStaleLocks(layout: InstallLayoutPaths): Promise<void> {
  if (!existsSync(layout.locksDir)) return;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(layout.locksDir).catch(() => [] as string[])) {
    const path = lockFilePath(layout, entry.replace(/\.lock$/, ""));
    if (await isLockStale(path)) {
      await rm(path, { force: true }).catch(() => {});
    }
  }
}
