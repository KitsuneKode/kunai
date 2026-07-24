type PosterSourceEntry = {
  readonly url: string;
  readonly data: ArrayBuffer;
};

const sourceCache = new Map<string, PosterSourceEntry>();
const sourceInflight = new Map<string, Promise<PosterSourceEntry | null>>();
const MAX_SOURCE_CACHE = 24;

import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import { observeOnlineIfBound } from "@/services/network/network-observation";

function getTmdbSize(cols: number, variant: "preview" | "detail"): string {
  if (variant === "detail") return cols <= 28 ? "w500" : "w780";
  if (cols <= 18) return "w342";
  if (cols <= 28) return "w500";
  // Never "original": a terminal pane tops out near 40 cells (~400px), so
  // multi-megabyte originals only add fetch latency, decode time, and RAM in
  // the source cache (raw ArrayBuffers) without changing a single output cell.
  return "w780";
}

export function resolvePosterUrl(
  url: string,
  { cols = 18, variant = "preview" }: { cols?: number; variant?: "preview" | "detail" } = {},
): string {
  if (isLocalImagePath(url)) return url.startsWith("file://") ? url.slice("file://".length) : url;
  const resolved = resolveCatalogPosterUrl(url, { tmdbSize: getTmdbSize(cols, variant) });
  return resolved ?? url;
}

export function clearPosterSourceCache(): void {
  sourceCache.clear();
  sourceInflight.clear();
}

function evictSourceCacheEntry(key: string): void {
  sourceCache.delete(key);
}

export async function fetchPosterSource(
  url: string | undefined,
  {
    cols = 18,
    variant = "preview",
    signal,
  }: { cols?: number; variant?: "preview" | "detail"; signal?: AbortSignal } = {},
): Promise<PosterSourceEntry | null> {
  if (!url) return null;
  if (signal?.aborted) return null;
  const resolved = resolvePosterUrl(url, { cols, variant });
  const cached = sourceCache.get(resolved);
  if (cached) return cached;

  // Don't join an aborted-capable leader — same rule as fetchPoster.
  const inflight = sourceInflight.get(resolved);
  if (inflight && !signal) return inflight;

  const task = (async (): Promise<PosterSourceEntry | null> => {
    try {
      if (signal?.aborted) return null;
      if (isLocalImagePath(resolved)) {
        const file = Bun.file(resolved);
        if (!(await file.exists())) return null;
        const entry = {
          url: resolved,
          data: await file.arrayBuffer(),
        } satisfies PosterSourceEntry;
        if (signal?.aborted) return null;
        if (sourceCache.size >= MAX_SOURCE_CACHE) {
          const first = sourceCache.keys().next().value;
          if (first) evictSourceCacheEntry(first);
        }
        sourceCache.set(resolved, entry);
        return entry;
      }
      const timeout = AbortSignal.timeout(5000);
      const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const res = await observeOnlineIfBound("poster-error", () =>
        fetch(resolved, { signal: fetchSignal }),
      );
      if (signal?.aborted) return null;
      if (!res.ok) return null;
      const entry = {
        url: resolved,
        data: await res.arrayBuffer(),
      } satisfies PosterSourceEntry;
      if (signal?.aborted) return null;
      if (sourceCache.size >= MAX_SOURCE_CACHE) {
        const first = sourceCache.keys().next().value;
        if (first) evictSourceCacheEntry(first);
      }
      sourceCache.set(resolved, entry);
      return entry;
    } catch {
      return null;
    }
  })();

  sourceInflight.set(resolved, task);
  try {
    return await task;
  } finally {
    sourceInflight.delete(resolved);
  }
}

function isLocalImagePath(url: string): boolean {
  if (url.startsWith("file://")) return true;
  return url.startsWith("/") && url.slice(1).includes("/");
}
