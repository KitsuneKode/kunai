// =============================================================================
// File Storage Implementation
//
// JSON file persistence. Paths come from getKunaiPaths() — the single
// platform-resolving seam; do not hand-roll XDG/APPDATA logic here again (it
// drifted from packages/storage once already).
// =============================================================================

import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { chmod, mkdir, unlink } from "node:fs/promises";
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

/**
 * A config read→merge→write cycle takes milliseconds — a lock file older than
 * this is a crashed holder's leftover, not contention.
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

  /**
   * Cross-process mutex on the backing file, claimed via O_EXCL on
   * `<file>.lock`. A holder that dies mid-cycle leaves the lock behind —
   * past `STALE_LOCK_MS` it is reclaimed rather than deadlocking the next
   * save forever. If a pathological holdout never releases, we run unlocked
   * after ~1s: a save that waits forever is worse than one that races.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = `${this.pathFor(key)}.lock`;
    const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
    let acquired = false;
    for (let wait = 0; wait < 40 && !acquired; wait += 1) {
      try {
        const fd = openSync(lockPath, "wx");
        writeSync(fd, `${token}\n`);
        closeSync(fd);
        acquired = true;
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") {
          await mkdir(dirname(lockPath), { recursive: true }).catch(() => {});
          continue;
        }
        if (code !== "EEXIST") throw error;
        let age = Number.POSITIVE_INFINITY;
        try {
          age = Date.now() - statSync(lockPath).mtimeMs;
        } catch {
          // The holder released between our claim attempt and the stat.
          continue;
        }
        if (age > STALE_LOCK_MS) {
          try {
            unlinkSync(lockPath);
          } catch {
            // Another contender already reclaimed it — retry the claim.
          }
          continue;
        }
        await Bun.sleep(25);
      }
    }
    if (!acquired) {
      dbgErr("storage.file", `Lock ${lockPath} never released; running without it`, undefined);
      return fn();
    }
    try {
      return await fn();
    } finally {
      // Unlink only if the file still carries our token — after a stale
      // reclaim the path can belong to a newer holder whose lock we must
      // not delete out from under them.
      try {
        if (readFileSync(lockPath, "utf8").trim() === token) {
          unlinkSync(lockPath);
        }
      } catch {
        // Already reclaimed as stale by a contender, or never created.
      }
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
