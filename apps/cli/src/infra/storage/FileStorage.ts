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

// Key → file path mapping (history and cache are SQLite — no JSON paths here)
const PATHS: Record<string, string> = {
  config: join(getKunaiPaths().configDir, "config.json"),
};

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: Record<string, string> = PATHS,
    /** Warn channel for user-relevant events; debug-only detail goes through dbg(). */
    private readonly warn?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  async read<T>(key: string): Promise<T | null> {
    const path = this.paths[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    if (process.platform !== "win32") await chmod(path, 0o600);
    try {
      return (await file.json()) as T;
    } catch (error) {
      // Corrupt JSON — back it up so we don't nuke it permanently, and say so:
      // a silently reset config used to look exactly like a fresh install.
      const corruptPath = `${path}.corrupt.bak`;
      const parent = dirname(corruptPath);
      if (parent) await mkdir(parent, { recursive: true }).catch(() => {});
      await writeAtomicSecretText(corruptPath, await file.text().catch(() => "")).catch(() => {});
      dbgErr("storage.file", `Corrupt JSON at ${path}; backed up to ${corruptPath}`, error);
      this.warn?.("Config file was unreadable and has been reset to defaults", {
        corruptBackup: corruptPath,
      });
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = this.paths[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      await writeAtomicSecretJson(path, data);
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async delete(key: string): Promise<void> {
    const path = this.paths[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      if (await Bun.file(path).exists()) await unlink(path);
      return undefined;
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async exists(key: string): Promise<boolean> {
    const path = this.paths[key];
    if (!path) return false;
    return Bun.file(path).exists();
  }
}
