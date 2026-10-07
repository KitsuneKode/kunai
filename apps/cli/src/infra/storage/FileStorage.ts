// =============================================================================
// File Storage Implementation
//
// JSON file persistence. Paths come from getKunaiPaths() — the single
// platform-resolving seam; do not hand-roll XDG/APPDATA logic here again (it
// drifted from packages/storage once already).
// =============================================================================

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join, dirname } from "node:path";

import { writeAtomicSecretJson, writeAtomicSecretText } from "@/infra/fs/atomic-write";
import { dbgErr } from "@/logger";
import { getKunaiPaths } from "@kunai/storage";
import { isJsonObject, isJsonNumber, isJsonString } from "@kunai/types";

import { pidAlive, withConfigLockTransition, type ConfigLockOptions } from "./config-lock";
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

/**
 * Grace for incomplete legacy owner records. Valid live owners never expire
 * by age; a slow callback must not lose ownership.
 */
const STALE_LOCK_MS = 10_000;

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();
  private resolvedPaths: Record<string, string> | undefined;

  constructor(
    /** Explicit paths win; omitted means resolve the real profile on first use. */
    private readonly paths?: Record<string, string>,
    /** Warn channel for user-relevant events; debug-only detail goes through dbg(). */
    private readonly warn?: (message: string, context?: Record<string, unknown>) => void,
    /** Controlled clocks and event gates for lock regressions. */
    private readonly lockOptions: ConfigLockOptions = {},
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
      await writeAtomicSecretJson(path, data);
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
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

  /** Guard every acquire, stale reclaim and release; timeout never writes unlocked. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = `${this.pathFor(key)}.lock`;
    const now = this.lockOptions.now ?? Date.now;
    const wait = this.lockOptions.wait ?? Bun.sleep;
    const deadline = now() + (this.lockOptions.timeoutMs ?? 1_000);
    const token = JSON.stringify({ pid: process.pid, hostname: hostname(), ownerId: randomUUID() });
    await mkdir(dirname(lockPath), { recursive: true });
    for (;;) {
      const acquired = await withConfigLockTransition(
        lockPath,
        deadline,
        this.lockOptions,
        async () => {
          const current = await readLock(lockPath);
          if (current !== null && !(await staleOwner(lockPath, current, now()))) return false;
          if (current !== null) {
            await unlink(lockPath);
            await this.lockOptions.onReclaimMoved?.();
          }
          const handle = await open(lockPath, "wx", 0o600);
          try {
            try {
              await handle.writeFile(token);
            } finally {
              await handle.close();
            }
          } catch (error) {
            await unlink(lockPath).catch(() => {});
            throw error;
          }
          return true;
        },
      );
      if (acquired) {
        try {
          await this.lockOptions.onAcquired?.();
          return await fn();
        } finally {
          await this.lockOptions.onBeforeRelease?.();
          // Release gets a fresh budget; the critical section may outlive acquisition.
          await withConfigLockTransition(lockPath, now() + 1_000, this.lockOptions, async () => {
            if ((await readLock(lockPath)) === token) await unlink(lockPath);
          });
        }
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        this.warn?.("Config file is busy; settings were not saved");
        throw new Error(
          "Config is busy; settings were not saved. Close the other session and retry.",
        );
      }
      await wait(Math.min(25, remaining));
    }
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

async function readLock(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function staleOwner(path: string, text: string, now: number): Promise<boolean> {
  // Older FileStorage versions published either a numeric PID or pid:token.
  const legacyPid = Number(text.trim().split(":")[0]);
  if (Number.isSafeInteger(legacyPid) && legacyPid > 0) return !pidAlive(legacyPid);
  try {
    const owner: unknown = JSON.parse(text);
    if (
      isJsonObject(owner) &&
      isJsonNumber(owner.pid) &&
      Number.isSafeInteger(owner.pid) &&
      owner.pid > 0
    ) {
      if (isJsonString(owner.hostname) && owner.hostname !== hostname()) return false;
      return !pidAlive(owner.pid);
    }
  } catch {
    /* Incomplete legacy records receive a bounded publication grace. */
  }
  // Participating initializers hold the transition guard through the owner write.
  return now - (await stat(path)).mtimeMs > STALE_LOCK_MS;
}
