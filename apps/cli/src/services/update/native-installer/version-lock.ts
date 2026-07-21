import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCanonicalVersion } from "../version";
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

export type VersionLockInspection =
  | { readonly status: "missing" }
  | { readonly status: "active"; readonly content: VersionLockContent }
  | {
      readonly status: "stale";
      readonly content: VersionLockContent | null;
      readonly detail: string;
    };

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

/**
 * Alive holders are never stale. Dead-PID and unreadable/invalid lock files
 * are immediately reclaimable (aligned with inspectVersionLock "stale").
 */
async function isLockStale(path: string): Promise<boolean> {
  const content = await readLockContent(path);
  if (content) {
    return !isProcessAlive(content.pid);
  }
  // Unreadable/invalid: reclaim immediately (matches inspect "stale").
  return true;
}

/** Read-only lock inspection — never deletes or reclaims lock files. */
export async function inspectVersionLock(
  layout: Pick<InstallLayoutPaths, "locksDir">,
  version: string,
): Promise<VersionLockInspection> {
  const path = lockFilePath(layout, version);
  if (!existsSync(path)) return { status: "missing" };

  const content = await readLockContent(path);
  if (content && isProcessAlive(content.pid)) {
    return { status: "active", content };
  }
  if (content) {
    return {
      status: "stale",
      content,
      detail: `Lock holder pid ${content.pid} is not running`,
    };
  }
  return {
    status: "stale",
    content: null,
    detail: "Lock file is unreadable or missing required fields",
  };
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
    if (entry === LIFECYCLE_LOCK_NAME) {
      const path = join(layout.locksDir, LIFECYCLE_LOCK_NAME);
      if (await isLockStale(path)) {
        await rm(path, { force: true }).catch(() => {});
      }
      continue;
    }
    const version = parseCanonicalVersion(entry.replace(/\.lock$/, ""));
    if (!version) continue;
    const path = lockFilePath(layout, version);
    if (await isLockStale(path)) {
      await rm(path, { force: true }).catch(() => {});
    }
  }
}

const LIFECYCLE_LOCK_NAME = "lifecycle.lock";
const LIFECYCLE_LOCK_VERSION = "0.0.0";

export function lifecycleLockPath(layout: Pick<InstallLayoutPaths, "locksDir">): string {
  return join(layout.locksDir, LIFECYCLE_LOCK_NAME);
}

/** True when any per-version lock is held by a live process. Never treats force as license to delete. */
export async function hasActiveVersionLocks(
  layout: Pick<InstallLayoutPaths, "locksDir">,
): Promise<boolean> {
  if (!existsSync(layout.locksDir)) return false;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(layout.locksDir).catch(() => [] as string[])) {
    if (entry === LIFECYCLE_LOCK_NAME) continue;
    const version = parseCanonicalVersion(entry.replace(/\.lock$/, ""));
    if (!version) continue;
    const inspection = await inspectVersionLock(layout, version);
    if (inspection.status === "active") return true;
  }
  return false;
}

/**
 * Exclusive lifecycle lock for uninstall (and similar whole-install mutations).
 * Refuses when any live per-version lock exists — `--force` never deletes those.
 * Stale version/lifecycle locks may be reclaimed first.
 */
export async function tryAcquireLifecycleLock(
  layout: InstallLayoutPaths,
  options: { readonly force?: boolean; readonly execPath?: string } = {},
): Promise<LockAcquireResult> {
  await mkdir(layout.locksDir, { recursive: true });

  // Force may reclaim stale residue, but never a live lock.
  if (options.force) {
    await cleanupStaleLocks(layout);
  }

  if (await hasActiveVersionLocks(layout)) {
    return { acquired: false };
  }

  const path = lifecycleLockPath(layout);
  if (existsSync(path) && !(await isLockStale(path))) {
    const existing = await readLockContent(path);
    return { acquired: false, holderPid: existing?.pid };
  }
  if (existsSync(path)) {
    await rm(path, { force: true }).catch(() => {});
  }

  const content: VersionLockContent = {
    pid: process.pid,
    version: LIFECYCLE_LOCK_VERSION,
    execPath: options.execPath ?? process.execPath,
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
