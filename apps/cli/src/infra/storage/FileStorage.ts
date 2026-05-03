// =============================================================================
// File Storage Implementation
//
// JSON file persistence using the existing file paths from the legacy code.
// =============================================================================

import { existsSync, mkdirSync } from "fs";
import { unlink } from "fs/promises";
import os from "os";
import { join, dirname } from "path";

import type { StorageService } from "./StorageService";

// OS-aware path resolution
function getConfigDir(appName: string): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), appName);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", appName);
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), appName);
}

const APP_NAME = "kunai";

// Key → file path mapping (history and cache are SQLite — no JSON paths here)
const PATHS: Record<string, string> = {
  config: join(getConfigDir(APP_NAME), "config.json"),
};

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();

  async read<T>(key: string): Promise<T | null> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
      return (await file.json()) as T;
    } catch {
      // Corrupt JSON — back it up so we don't nuke it permanently
      const corruptPath = `${path}.corrupt.bak`;
      await Bun.write(corruptPath, await file.text().catch(() => "")).catch(() => {});
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      ensureDir(path);
      await Bun.write(path, JSON.stringify(data, null, 2));
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async delete(key: string): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      if (await Bun.file(path).exists()) await unlink(path);
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async exists(key: string): Promise<boolean> {
    const path = PATHS[key];
    if (!path) return false;
    return Bun.file(path).exists();
  }
}
