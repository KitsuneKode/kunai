import { detectImageCapability } from "@/image";

import { deleteAllTerminalImages, deleteKittyImage, renderPoster } from "./poster-renderer";
import { clearPosterSourceCache, fetchPosterSource, resolvePosterUrl } from "./poster-source-cache";
import type { PosterResult } from "./poster-types";

// LRU-style cache keyed by "url:WxH"
const posterCache = new Map<string, PosterResult>();
const posterInflight = new Map<string, Promise<PosterResult>>();
const MAX_CACHE = 12;
const runtime = {
  detectImageCapability,
};

export function deleteAllKittyImages(): void {
  clearRenderedPosterImages();
  clearPosterSourceCache();
}

export function clearRenderedPosterImages(): void {
  deleteAllTerminalImages();
  posterCache.clear();
  posterInflight.clear();
}

export const __testing = {
  runtime,
};

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
    allowKitty = true,
  }: { rows: number; cols: number; variant?: "preview" | "detail"; allowKitty?: boolean },
): Promise<PosterResult> {
  if (!url) return { kind: "none" };
  if (!allowKitty) return { kind: "none" };
  const capability = runtime.detectImageCapability();
  const resolved = resolvePosterUrl(url, { cols, variant });
  const key = `${resolved}:${rows}x${cols}:${allowKitty ? capability.renderer : "none"}`;

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
      result = source
        ? await renderPoster(source.data, { rows, cols, allowKitty })
        : { kind: "none" };
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

export { resolvePosterUrl } from "./poster-source-cache";
export type { PosterResult } from "./poster-types";
