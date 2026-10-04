// =============================================================================
// File Storage Implementation
//
// JSON file persistence. Paths come from getKunaiPaths() — the single
// platform-resolving seam; do not hand-roll XDG/APPDATA logic here again (it
// drifted from packages/storage once already).
// =============================================================================

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

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();
  private resolvedPaths: Record<string, string> | undefined;
  /**
   * Set when a read found the live file corrupt or otherwise unreadable. The
   * bytes on disk are the user's only copy of a hand-repaired config, so a
   * later `write()` must not overwrite them with in-memory defaults — it is
   * diverted to a `.recovered` file until `acknowledgeRecovery()` (explicit
   * user action) or a successful read proves the live file is healthy again.
   */
  private recoveryPending = false;

  constructor(
    /** Explicit paths win; omitted means resolve the real profile on first use. */
    private readonly paths?: Record<string, string>,
    /** Warn channel for user-relevant events; debug-only detail goes through dbg(). */
    private readonly warn?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  /** Whether the live file is quarantined: writes are diverted, not clobbered. */
  get needsRecovery(): boolean {
    return this.recoveryPending;
  }

  /**
   * Explicit user action (settings repair, doctor acknowledgement): the live
   * file may be written again. Without this, `write()` keeps diverting to
   * `.recovered` files so defaults never silently replace the user's bytes.
   */
  acknowledgeRecovery(): void {
    this.recoveryPending = false;
  }

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
      // good earlier `.corrupt.bak` with an empty file. But the live file may
      // still hold the user's config, so quarantine it: a later write must not
      // replace those bytes with defaults until the user says so.
      dbgErr("storage.file", `Unreadable file at ${path}`, error);
      this.warn?.("Config file could not be read; defaults are in use", { path });
      this.recoveryPending = true;
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as T;
      // A clean read proves the live file is healthy — a hand repair outside
      // this process lifts the quarantine without needing explicit action.
      this.recoveryPending = false;
      return parsed;
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
      const corruptPath = `${path}.corrupt.${backupStamp()}.bak`;
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
      // Quarantine the live file: without this, the next `save()` persists the
      // in-memory defaults over the user's bytes and the backup is the only
      // copy left. Writes divert to a `.recovered` file until acknowledged.
      this.recoveryPending = true;
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = this.pathFor(key);

    // The live file is quarantined (corrupt or unreadable on read): overwriting
    // it with whatever is in memory would destroy the user's only copy. Divert
    // to a timestamped `.recovered` file — same naming rationale as the corrupt
    // backups — so nothing is lost in either direction.
    if (this.recoveryPending) {
      const recoveredPath = `${path}.recovered.${backupStamp()}.json`;
      const task = this.writeLock.then(async () => {
        await writeAtomicSecretJson(recoveredPath, data);
        return undefined;
      });

      this.writeLock = task.catch(() => {});
      this.warn?.("Config file needs recovery; saved to a recovery file instead", {
        path,
        recoveredPath,
      });
      await task;
      return;
    }

    const task = this.writeLock.then(async () => {
      await writeAtomicSecretJson(path, data);
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);

    // Explicit removal is the user action the quarantine waits for: the file
    // is gone by choice, so a later write recreating it is not a clobber.
    this.recoveryPending = false;
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
 * A sortable, collision-free stamp for a quarantined or diverted file.
 *
 * The ISO form matches `packages/storage/src/sqlite.ts:143` so both kinds of
 * quarantine sort together. The counter is not decoration: a bare millisecond
 * timestamp collides when two reads land in the same millisecond, and the
 * second write then clobbers the first — which is the exact defect the
 * timestamp was introduced to remove. A test performs two corrupt reads back to
 * back and asserts both sets of bytes survive. Recovered-write diverts reuse
 * the same stamp for the same reason.
 */
let corruptBackupCounter = 0;

function backupStamp(): string {
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
