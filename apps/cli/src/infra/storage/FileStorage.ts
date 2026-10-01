// =============================================================================
// File Storage Implementation
//
// JSON file persistence. Paths come from getKunaiPaths() — the single
// platform-resolving seam; do not hand-roll XDG/APPDATA logic here again (it
// drifted from packages/storage once already).
// =============================================================================

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

import { writeAtomicSecretJson, writeAtomicSecretText } from "@/infra/fs/atomic-write";
import { dbgErr } from "@/logger";
import { getKunaiPaths } from "@kunai/storage";

import type { StorageService } from "./StorageService";

/**
 * Key → file path mapping (history and cache are SQLite — no JSON paths here).
 *
 * Built on first use, never at import. As a module-level constant this called
 * `getKunaiPaths()` while the module was being loaded, so the developer's real
 * `config.json` path was frozen in before a test could point HOME/XDG/APPDATA
 * at a sandbox — a suite that imported this file early, however indirectly,
 * then wrote the live profile. Resolving lazily means the environment in effect
 * when a path is actually needed is the one that decides it.
 */
function defaultPaths(): Record<string, string> {
  return {
    config: join(getKunaiPaths().configDir, "config.json"),
  };
}

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();
  private resolvedPaths: Record<string, string> | undefined;

  constructor(
    /** Explicit paths win; omitted means resolve the real profile on first use. */
    private readonly paths?: Record<string, string>,
    /** Warn channel for user-relevant events; debug-only detail goes through dbg(). */
    private readonly warn?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  async read<T>(key: string): Promise<T | null> {
    const path = this.pathFor(key);

    const file = Bun.file(path);

    let raw: string;
    try {
      if (process.platform !== "win32") await chmod(path, 0o600);
      raw = await file.text();
    } catch (error) {
      // "Not there" is nothing stored, not a read error for the caller to
      // handle. An `exists()` pre-check used to answer this, but it left both
      // the chmod and the read outside the guard: a file that vanished in
      // between (another process, a concurrent `delete()`) made `read()` reject
      // with ENOENT instead of returning null.
      if (errorCode(error) === "ENOENT") return null;
      // Unreadable for another reason (permissions, I/O). Nothing was read, so
      // there is no content to preserve — writing a backup here would replace a
      // good earlier `.corrupt.bak` with an empty file.
      dbgErr("storage.file", `Unreadable file at ${path}`, error);
      this.warn?.("Config file could not be read; defaults are in use", { path });
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      // Corrupt JSON — preserve the bytes we actually read so a hand-repaired
      // config is never lost, and say precisely what happened.
      //
      // The backup name is timestamped. A fixed `.corrupt.bak` meant every
      // subsequent launch overwrote the previous one, so a user who hit this
      // twice lost both the original config and any earlier backup — and since
      // the corrupt file is never rewritten, the second launch re-detected,
      // re-warned and re-clobbered it. `packages/storage/src/sqlite.ts:152`
      // already quarantines this way for the same reason; this path was the
      // only outlier.
      const corruptPath = `${path}.corrupt.${corruptBackupStamp()}.bak`;
      const parent = dirname(corruptPath);
      if (parent) await mkdir(parent, { recursive: true }).catch(() => {});
      await writeAtomicSecretText(corruptPath, raw).catch(() => {});
      dbgErr("storage.file", `Corrupt JSON at ${path}; backed up to ${corruptPath}`, error);
      // The claim has to match the behaviour: nothing rewrites `path` here, so
      // this run uses defaults *in memory* and the unreadable file stays on
      // disk until something writes over it. Saying "has been reset" sent
      // people looking for a rewrite that never happened.
      this.warn?.("Config file was unreadable; defaults are in use for this run", {
        corruptBackup: corruptPath,
      });
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = this.pathFor(key);

    const task = this.writeLock.then(async () => {
      await withCrossProcessLock(`${path}.lock`, async () => {
        await writeAtomicSecretJson(path, data);
      });
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async mutate<T extends Record<string, unknown>>(
    key: string,
    update: (current: T | null) => T,
  ): Promise<void> {
    const path = this.pathFor(key);
    const task = this.writeLock.then(async () => {
      await withCrossProcessLock(`${path}.lock`, async () => {
        const current = await this.readUnlocked<T>(path);
        await writeAtomicSecretJson(path, update(current));
      });
      return undefined;
    });
    this.writeLock = task.catch(() => {});
    await task;
  }

  private async readUnlocked<T>(path: string): Promise<T | null> {
    const file = Bun.file(path);
    let raw: string;
    try {
      raw = await file.text();
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as T;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);

    const task = this.writeLock.then(async () => {
      if (await Bun.file(path).exists()) await unlink(path);
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  private lookupPath(key: string): string | undefined {
    this.resolvedPaths ??= this.paths ?? defaultPaths();
    return this.resolvedPaths[key];
  }

  private pathFor(key: string): string {
    const path = this.lookupPath(key);
    if (!path) throw new Error(`Unknown storage key: ${key}`);
    return path;
  }

  async exists(key: string): Promise<boolean> {
    const path = this.lookupPath(key);
    if (!path) return false;
    return Bun.file(path).exists();
  }
}

/**
 * A sortable, collision-free stamp for a quarantined file.
 *
 * The ISO form matches `packages/storage/src/sqlite.ts:143` so both kinds of
 * quarantine sort together. The counter is not decoration: a bare millisecond
 * timestamp collides when two reads land in the same millisecond, and the
 * second write then clobbers the first — which is the exact defect the
 * timestamp was introduced to remove. A test performs two corrupt reads back to
 * back and asserts both sets of bytes survive.
 */
let corruptBackupCounter = 0;

function corruptBackupStamp(): string {
  corruptBackupCounter = (corruptBackupCounter + 1) % 1_000;
  // Timestamp + counter disambiguate within one process; the random suffix keeps
  // two processes that corrupt-read in the same millisecond from picking the
  // same backup path and clobbering each other's copy.
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${corruptBackupCounter}-${nonce}`;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a stale lock only when this call still owns the bytes it judged stale.
 *
 * Two waiters used to read a dead pid and then `unlink` the path. The first
 * could create a new live lock in between, and the second deleted that one.
 * `rename` claims one generation. A rename that steals different bytes is put
 * back and does not count as a reclaim.
 */
export async function reclaimStaleLock(lockPath: string): Promise<boolean> {
  let observed = "";
  try {
    observed = await Bun.file(lockPath).text();
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
  if (!(await observedLockIsStale(lockPath, observed))) return false;

  const quarantine = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch {
    return false;
  }

  let stolen = "";
  try {
    stolen = await Bun.file(quarantine).text();
  } catch {
    stolen = "";
  }
  if (stolen !== observed) {
    try {
      await rename(quarantine, lockPath);
    } catch {
      await unlink(quarantine).catch(() => {});
    }
    return false;
  }
  await unlink(quarantine).catch(() => {});
  return true;
}

async function observedLockIsStale(lockPath: string, text: string): Promise<boolean> {
  const pid = Number(text.trim());
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > LOCK_WAIT_MS;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}

/** Exclusive lock file. A dead owner's pid, or a lock with no pid older than the wait, is removed. */
async function withCrossProcessLock(lockPath: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      const handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      try {
        await fn();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (await reclaimStaleLock(lockPath)) continue;
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw new Error(`config lock timed out: ${lockPath}`, { cause: error });
      }
      await Bun.sleep(LOCK_POLL_MS);
    }
  }
}
