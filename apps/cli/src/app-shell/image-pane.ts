import { deleteAllTerminalImages, deleteKittyImage, renderPoster } from "./poster-renderer";
import { clearPosterSourceCache, fetchPosterSource, resolvePosterUrl } from "./poster-source-cache";
import type { PosterResult } from "./poster-types";

// LRU-style cache keyed by "url:WxH"
const posterCache = new Map<string, PosterResult>();
const posterInflight = new Map<string, Promise<PosterResult>>();
const MAX_CACHE = 12;

export function deleteAllKittyImages(): void {
  deleteAllTerminalImages();
  posterCache.clear();
  posterInflight.clear();
  clearPosterSourceCache();
}

function evictPosterCacheEntry(key: string): void {
  const cached = posterCache.get(key);
  if (cached?.kind === "kitty") {
    deleteKittyImage(cached.imageId);
  }
  posterCache.delete(key);
}

export async function fetchPoster(
  url: string | undefined,
  {
    rows,
    cols,
    variant = "preview",
  }: { rows: number; cols: number; variant?: "preview" | "detail" },
): Promise<PosterResult> {
  if (!url) return { kind: "none" };
  const resolved = resolvePosterUrl(url, { cols, variant });
  const key = `${resolved}:${rows}x${cols}`;

  const cached = posterCache.get(key);
  if (cached) return cached;

  const inflight = posterInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const task = (async (): Promise<PosterResult> => {
    let result: PosterResult;
    try {
      const source = await fetchPosterSource(resolved, { cols, variant });
      result = source ? await renderPoster(source.data, { rows, cols }) : { kind: "none" };
    } catch {
      result = { kind: "none" };
    }

    if (posterCache.size >= MAX_CACHE) {
      const first = posterCache.keys().next().value;
      if (first) evictPosterCacheEntry(first);
    }
    if (result.kind !== "none") {
      posterCache.set(key, result);
    }
    return result;
  })();

  posterInflight.set(key, task);

  try {
    return await task;
  } finally {
    posterInflight.delete(key);
  }
}

export { isChafaAvailable } from "./poster-renderer";
export { resolvePosterUrl } from "./poster-source-cache";
export type { PosterResult } from "./poster-types";
