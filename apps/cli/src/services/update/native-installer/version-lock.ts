import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCanonicalVersion } from "../version";
import { tryAcquireActivationLock } from "./activation-lock";
import {
  getInstallLayoutPaths,
  lifecycleGuardPath,
  lockFilePath,
  type InstallLayoutPaths,
} from "./install-layout";
import { isProcessAlive, normalizedHostname, processStartId } from "./lock-owner-identity";

export type VersionLockContent = {
  readonly pid: number;
  readonly version: string;
  readonly execPath: string;
  readonly acquiredAt: string;
  readonly ownerId?: string;
  readonly schemaVersion?: number;
  readonly scope?: string;
  readonly hostname?: string;
  readonly processStartId?: string | null;
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

const LIFECYCLE_CORRUPT_GRACE_MS = 250;

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

function isModernLifecycleContent(content: VersionLockContent): boolean {
  return (
    content.schemaVersion === 1 &&
    content.scope === "lifecycle" &&
    Number.isSafeInteger(content.pid) &&
    content.pid > 0 &&
    content.version === LIFECYCLE_LOCK_VERSION &&
    typeof content.execPath === "string" &&
    content.execPath.length > 0 &&
    typeof content.ownerId === "string" &&
    content.ownerId.length > 0 &&
    typeof content.acquiredAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(content.acquiredAt) &&
    typeof content.hostname === "string" &&
    content.hostname.trim().length > 0 &&
    (content.processStartId === null ||
      (typeof content.processStartId === "string" && content.processStartId.length > 0))
  );
}

/**
 * Schema-1 lifecycle identities are host-scoped. Foreign owners fail closed;
 * local owners are stale only when their PID is dead or its start ID changed.
 * Pre-schema records retain the legacy local-PID behavior for upgrades.
 */
async function isLifecycleLockStale(path: string): Promise<boolean> {
  const content = await readLockContent(path);
  if (!content) {
    const metadata = await stat(path).catch(() => null);
    return metadata === null || Date.now() - metadata.mtimeMs >= LIFECYCLE_CORRUPT_GRACE_MS;
  }
  const hasModernIdentity =
    content.schemaVersion !== undefined ||
    content.scope !== undefined ||
    content.hostname !== undefined ||
    content.processStartId !== undefined;
  if (!hasModernIdentity) return !isProcessAlive(content.pid);
  if (!isModernLifecycleContent(content)) {
    const metadata = await stat(path).catch(() => null);
    return metadata === null || Date.now() - metadata.mtimeMs >= LIFECYCLE_CORRUPT_GRACE_MS;
  }
  if (content.hostname?.trim().toLowerCase() !== normalizedHostname()) return false;
  if (!isProcessAlive(content.pid)) return true;
  if (content.processStartId) {
    const currentStartId = processStartId(content.pid);
    if (currentStartId && currentStartId !== content.processStartId) return true;
  }
  return false;
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

  const lifecyclePath = lifecycleLockPath(layout);
  const lifecyclePaths = [lifecycleGuardPath(layout), lifecyclePath];
  for (const guardPath of lifecyclePaths) {
    if (existsSync(guardPath) && !(await isLifecycleLockStale(guardPath))) {
      const existing = await readLockContent(guardPath);
      return { acquired: false, holderPid: existing?.pid };
    }
  }

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

  // Close the check/create race with lifecycle acquisition: if uninstall won
  // its lock after our first check, relinquish this version lock and refuse.
  for (const guardPath of lifecyclePaths) {
    if (existsSync(guardPath) && !(await isLifecycleLockStale(guardPath))) {
      const existing = await readLockContent(guardPath);
      const current = await readLockContent(path);
      if (current?.pid === process.pid) {
        await rm(path, { force: true }).catch(() => {});
      }
      return { acquired: false, holderPid: existing?.pid };
    }
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
      if (await isLifecycleLockStale(path)) {
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
  options: {
    readonly force?: boolean;
    readonly execPath?: string;
    readonly activationLockTimeoutMs?: number;
    /** Test seam for deterministic lifecycle cleanup failures. */
    readonly rmImpl?: typeof rm;
  } = {},
): Promise<LockAcquireResult> {
  // The activation lock is the cross-language election primitive. Acquire it
  // before inspecting or reclaiming lifecycle residue so two contenders can
  // never act on the same stale observation. It remains held until the
  // external purge-safe guard has been released.
  const activation = await tryAcquireActivationLock(layout, LIFECYCLE_LOCK_VERSION, {
    execPath: options.execPath,
    timeoutMs: options.activationLockTimeoutMs,
  });
  if (!activation.acquired) {
    return { acquired: false, holderPid: activation.holderPid };
  }

  const releaseActivationAndReturn = async (
    result: Extract<LockAcquireResult, { readonly acquired: false }>,
  ): Promise<LockAcquireResult> => {
    await activation.release();
    return result;
  };

  try {
    await mkdir(layout.locksDir, { recursive: true });

    // Force may reclaim stale residue, but never a live lock.
    if (options.force) {
      await cleanupStaleLocks(layout);
    }

    if (await hasActiveVersionLocks(layout)) {
      return await releaseActivationAndReturn({ acquired: false });
    }

    const paths = [lifecycleGuardPath(layout), lifecycleLockPath(layout)];
    const ownerId = `${process.pid}-${randomUUID()}`;
    const lifecycleRm = options.rmImpl ?? rm;

    const content: VersionLockContent = {
      schemaVersion: 1,
      scope: "lifecycle",
      pid: process.pid,
      version: LIFECYCLE_LOCK_VERSION,
      execPath: options.execPath ?? process.execPath,
      acquiredAt: new Date().toISOString(),
      ownerId,
      hostname: normalizedHostname(),
      processStartId: processStartId(process.pid),
    };

    const acquiredPaths: string[] = [];
    const backOutAcquiredPaths = async (): Promise<void> => {
      for (const acquiredPath of [...acquiredPaths].reverse()) {
        const current = await readLockContent(acquiredPath);
        if (current?.ownerId !== ownerId) continue;
        try {
          await lifecycleRm(acquiredPath, { force: true });
        } catch (error) {
          throw new Error(`Could not back out lifecycle lock at ${acquiredPath}`, { cause: error });
        }
      }
    };

    for (const path of paths) {
      if (existsSync(path) && !(await isLifecycleLockStale(path))) {
        const existing = await readLockContent(path);
        await backOutAcquiredPaths();
        return await releaseActivationAndReturn({
          acquired: false,
          holderPid: existing?.pid,
        });
      }
      if (existsSync(path)) {
        await lifecycleRm(path, { force: true }).catch(() => {});
      }
      try {
        await writeFile(path, `${JSON.stringify(content)}\n`, { flag: "wx" });
        acquiredPaths.push(path);
      } catch {
        const existing = await readLockContent(path);
        await backOutAcquiredPaths();
        return await releaseActivationAndReturn({
          acquired: false,
          holderPid: existing?.pid,
        });
      }
    }

    // Close the inverse race with version-lock acquisition. One side must see
    // the other after both exclusive creates and back out before mutation.
    if (await hasActiveVersionLocks(layout)) {
      await backOutAcquiredPaths();
      return await releaseActivationAndReturn({ acquired: false });
    }

    return {
      acquired: true,
      release: async () => {
        let lifecycleReleaseError: unknown;
        try {
          for (const path of [...acquiredPaths].reverse()) {
            const current = await readLockContent(path);
            if (current?.ownerId === ownerId) {
              try {
                await lifecycleRm(path, { force: true });
              } catch (error) {
                throw new Error(`Could not release lifecycle lock at ${path}`, { cause: error });
              }
              if (path === lifecycleLockPath(layout)) {
                // The external purge-safe guard and activation ownership are
                // both still held here. rmdir fails safely if any diagnostic
                // quarantine or unrelated lock remains.
                await rmdir(layout.locksDir).catch(() => {});
              }
            }
          }
        } catch (error) {
          lifecycleReleaseError = error;
        }

        try {
          // Purge may already have removed the activation path. Its owner-aware
          // release treats a missing path as success but surfaces real I/O
          // failures while a matching lock still exists.
          await activation.release();
        } catch (activationReleaseError) {
          if (lifecycleReleaseError) {
            const lifecycleDetail =
              lifecycleReleaseError instanceof Error
                ? lifecycleReleaseError.message
                : String(lifecycleReleaseError);
            throw new Error(
              `Could not release lifecycle lock (${lifecycleDetail}) and activation lock`,
              { cause: activationReleaseError },
            );
          }
          throw activationReleaseError;
        }

        // Activation ownership is the last entry in locksDir under the normal
        // uninstall path, so the directory can become empty only after its
        // release. Purge may already have removed the directory.
        await rmdir(layout.locksDir).catch(() => {});

        if (lifecycleReleaseError) throw lifecycleReleaseError;
      },
    };
  } catch (error) {
    try {
      await activation.release();
    } catch (activationReleaseError) {
      const acquisitionDetail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Lifecycle acquisition failed (${acquisitionDetail}) and activation ownership could not be released`,
        { cause: activationReleaseError },
      );
    }
    throw error;
  }
}
