// =============================================================================
// File Storage Implementation
//
// JSON file persistence using the existing file paths from the legacy code.
// =============================================================================

import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { StorageService } from "./StorageService";

const HOME = process.env.HOME ?? "~";

// Key → file path mapping
const PATHS: Record<string, string> = {
  config: join(HOME, ".config", "kitsunesnipe", "config.json"),
  history: join(HOME, ".local", "share", "kitsunesnipe", "history.json"),
  cache: join(process.cwd(), "stream_cache.json"),
};

function ensureDir(filePath: string) {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class FileStorage implements StorageService {
  async read<T>(key: string): Promise<T | null> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    ensureDir(path);
    await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  }

  async delete(key: string): Promise<void> {
    const path = PATHS[key];
    if (!path) throw new Error(`Unknown storage key: ${key}`);

    if (existsSync(path)) await unlink(path);
  }

  async exists(key: string): Promise<boolean> {
    const path = PATHS[key];
    if (!path) return false;
    return existsSync(path);
  }
}
