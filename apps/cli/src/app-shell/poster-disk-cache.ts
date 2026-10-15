// =============================================================================
// poster-disk-cache.ts — LRU on-disk lane for remote poster source bytes.
//
// The memory source cache (24 entries) and prepared cache (64 entries) cover a
// session's working set, but every scroll past them refetches + re-decodes from
// the CDN. This lane persists validated source bytes across launches and past
// memory eviction: keyed by (url, width, protocol) so a rail-sized fetch never
// serves a hero-sized surface.
//
// Shape is deliberately boring: one file per entry (`<sha256>.poster`) under
// `<cacheDir>/poster-sources`, LRU by mtime, bounded by entries and bytes,
// pruned on write. Every filesystem failure degrades to a miss — the memory
// cache and network paths are untouched. Local files are never cached here;
// they are already on disk.
// =============================================================================

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getKunaiPaths } from "@/services/storage/storage-read-models";

export const MAX_POSTER_DISK_CACHE_ENTRIES = 150;
export const MAX_POSTER_DISK_CACHE_BYTES = 64 * 1024 * 1024;
const DISK_CACHE_SUBDIR = "poster-sources";

let overrideDir: string | null = null;

/** Test seam: redirect the cache at an isolated tmp dir. Never the live profile. */
export function setPosterDiskCacheDir(dir: string | null): void {
  overrideDir = dir;
}

function cacheDir(): string {
  if (overrideDir) return overrideDir;
  return join(getKunaiPaths().cacheDir, DISK_CACHE_SUBDIR);
}

export type PosterDiskCacheKeyParts = {
  /** Fully resolved fetch URL (CDN size already embedded). */
  readonly url: string;
  /** Terminal columns the fetch was sized for (drives the TMDB width). */
  readonly cols: number;
};

/** Protocol lane of a resolved poster ref, or null when it must skip the disk. */
export function posterDiskCacheProtocol(resolved: string): string | null {
  if (
    resolved.startsWith("file://") ||
    resolved.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(resolved) ||
    resolved.startsWith("\\\\")
  ) {
    return null;
  }
  const schemeEnd = resolved.indexOf(":");
  if (schemeEnd <= 0) return null;
  // SAFETY: scheme slice of a resolved ref, not a credential — no secret material.
  const scheme = resolved.slice(0, schemeEnd).toLowerCase();
  return scheme === "http" || scheme === "https" ? scheme : null;
}

/** LRU disk key: sha256 over (protocol, width, url). Hex, filesystem-safe. */
export function posterDiskCacheFileName(parts: PosterDiskCacheKeyParts): string | null {
  const protocol = posterDiskCacheProtocol(parts.url);
  if (!protocol) return null;
  return `${createHash("sha256").update(`${protocol}\x00${parts.cols}\x00${parts.url}`, "utf8").digest("hex")}.poster`;
}

async function pruneCache(dir: string): Promise<void> {
  let entries: { name: string; size: number; mtimeMs: number }[];
  try {
    const names = await readdir(dir);
    entries = [];
    for (const name of names) {
      if (!name.endsWith(".poster")) continue;
      try {
        const st = await stat(join(dir, name));
        if (st.isFile()) entries.push({ name, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let remainingEntries = entries.length;
  for (const entry of entries) {
    if (remainingEntries <= MAX_POSTER_DISK_CACHE_ENTRIES && bytes <= MAX_POSTER_DISK_CACHE_BYTES) {
      break;
    }
    try {
      await rm(join(dir, entry.name), { force: true });
    } catch {
      continue;
    }
    remainingEntries -= 1;
    bytes -= entry.size;
  }
}

export async function readPosterDiskCache(
  parts: PosterDiskCacheKeyParts,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const fileName = posterDiskCacheFileName(parts);
  if (!fileName) return null;
  try {
    const file = Bun.file(join(cacheDir(), fileName));
    if (!(await file.exists())) return null;
    if (file.size === 0 || file.size > maxBytes) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    // Touch for LRU recency; failure is not a miss.
    await utimes(join(cacheDir(), fileName), new Date(), new Date()).catch(() => undefined);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Synchronous hit gate for the fetch path. The poster pipeline fires the
 * network fetch synchronously on a memory miss (tests assert the coalescing),
 * so the disk lane may not insert an await before that decision: stat first,
 * and only await a read when a usable file is actually there. A stale true
 * (deleted between stat and read) just falls through to the network.
 */
export function isPosterDiskCacheCandidate(
  parts: PosterDiskCacheKeyParts,
  maxBytes: number,
): boolean {
  const fileName = posterDiskCacheFileName(parts);
  if (!fileName) return false;
  try {
    const path = join(cacheDir(), fileName);
    if (!existsSync(path)) return false;
    const size = statSync(path).size;
    return size > 0 && size <= maxBytes;
  } catch {
    return false;
  }
}

/** Never rejects: disk persistence is best-effort behind the memory cache. */
export async function writePosterDiskCache(
  parts: PosterDiskCacheKeyParts,
  bytes: Uint8Array,
): Promise<void> {
  const fileName = posterDiskCacheFileName(parts);
  if (!fileName || bytes.byteLength === 0) return;
  try {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), bytes, { flag: "w" });
    await pruneCache(dir);
  } catch {
    return;
  }
}

/** Test seam: drop every entry in the (possibly overridden) cache dir. */
export async function clearPosterDiskCache(): Promise<void> {
  try {
    const dir = cacheDir();
    const names = await readdir(dir);
    await Promise.all(
      names
        .filter((name) => name.endsWith(".poster"))
        .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined)),
    );
  } catch {
    return;
  }
}
