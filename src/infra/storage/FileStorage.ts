// =============================================================================
// File Storage Implementation
//
// JSON file persistence using the existing file paths from the legacy code.
// =============================================================================

import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, unlink, rename } from "fs/promises";
import { join, dirname } from "path";
import os from "os";
import type { StorageService } from "./StorageService";

// OS-aware path resolution
function getAppDataDir(appName: string): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), appName);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", appName);
  }
  return join(home, ".local", "share", appName);
}

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

function getCacheDir(appName: string): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), appName);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Caches", appName);
  }
  return join(process.env.XDG_CACHE_HOME || join(home, ".cache"), appName);
}

const APP_NAME = "kitsunesnipe";

// Key → file path mapping
const PATHS: Record<string, string> = {
  config: join(getConfigDir(APP_NAME), "config.json"),
  history: join(getAppDataDir(APP_NAME), "history.json"),
  cache: join(getCacheDir(APP_NAME), "stream_cache.json"),
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

    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      // Safe fallback on corrupt parse: back it up so we don't nuke it permanently
      const corruptPath = `${path}.corrupt.bak`;
      try {
        await rename(path, corruptPath);
      } catch {}
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      ensureDir(path);
      const tmpPath = `${path}.tmp`;
      const str = JSON.stringify(data, null, 2);
      // Write to .tmp first, then atomic rename
      await writeFile(tmpPath, str, "utf-8");
      await rename(tmpPath, path);
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async delete(key: string): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      if (existsSync(path)) await unlink(path);
    });

    this.writeLock = task.catch(() => {});
    await task;
  }

  async exists(key: string): Promise<boolean> {
    const path = PATHS[key];
    if (!path) return false;
    return existsSync(path);
  }
}
