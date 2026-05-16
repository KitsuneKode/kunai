// =============================================================================
// File Storage Implementation
//
// JSON file persistence using the existing file paths from the legacy code.
// =============================================================================

import { mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import { join, dirname } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

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

export class FileStorage implements StorageService {
  // Simple mutex to prevent concurrent writes from interleaving and corrupting files
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly paths: Record<string, string> = PATHS) {}

  async read<T>(key: string): Promise<T | null> {
    const path = this.paths[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
      return (await file.json()) as T;
    } catch {
      // Corrupt JSON — back it up so we don't nuke it permanently
      const corruptPath = `${path}.corrupt.bak`;
      const parent = dirname(corruptPath);
      if (parent) await mkdir(parent, { recursive: true }).catch(() => {});
      await Bun.write(corruptPath, await file.text().catch(() => "")).catch(() => {});
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = this.paths[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    const task = this.writeLock.then(async () => {
      await writeAtomicJson(path, data);
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
