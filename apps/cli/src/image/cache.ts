import { createHash } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

import { writeAtomicBytes } from "@/infra/fs/atomic-write";

import { debugImage } from "./debug";

const TMDB_IMG = "https://image.tmdb.org/t/p/w300";
const CACHE_SUBDIR = join("kunai", "posters");

const fsOps = { mkdir, rename, stat, unlink };

function resolveCacheDir(): string {
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, CACHE_SUBDIR);
  const home = process.env.HOME ?? homedir();
  return join(home, ".cache", CACHE_SUBDIR);
}

function resolveExtension(posterPath: string): string {
  const normalized = posterPath.toLowerCase();
  if (normalized.endsWith(".png")) return ".png";
  if (normalized.endsWith(".jpg")) return ".jpg";
  if (normalized.endsWith(".jpeg")) return ".jpg";
  if (normalized.endsWith(".webp")) return ".webp";
  const ext = extname(normalized);
  if (ext) return ext;
  return ".img";
}

function buildPosterUrl(posterPath: string): string {
  return `${TMDB_IMG}${posterPath}`;
}

function buildCachePath(url: string, posterPath: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  const ext = resolveExtension(posterPath);
  return join(resolveCacheDir(), `${hash}${ext}`);
}

async function fileIsNonEmpty(path: string): Promise<boolean> {
  try {
    const info = await fsOps.stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

type AtomicWriteFn = (targetPath: string, data: ArrayBuffer | Uint8Array | Blob) => Promise<void>;

const posterOps = { atomicWrite: writeAtomicBytes as AtomicWriteFn };

export async function getCachedPoster(posterPath: string): Promise<string | null> {
  const url = buildPosterUrl(posterPath);
  const cachePath = buildCachePath(url, posterPath);

  if (await fileIsNonEmpty(cachePath)) {
    debugImage(`cache hit: ${basename(cachePath)}`);
    return cachePath;
  }

  debugImage(`cache miss: ${basename(cachePath)}`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    if (data.byteLength === 0) return null;
    await posterOps.atomicWrite(cachePath, data);
    return cachePath;
  } catch {
    return null;
  }
}

export const __testing = {
  fsOps,
  get atomicWrite(): AtomicWriteFn {
    return posterOps.atomicWrite;
  },
  set atomicWrite(fn: AtomicWriteFn) {
    posterOps.atomicWrite = fn;
  },
  buildPosterUrl,
  buildCachePath,
  resolveCacheDir,
  resolveExtension,
};
