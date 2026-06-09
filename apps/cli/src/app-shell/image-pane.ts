import { detectImageCapability } from "@/image";
import { useEffect } from "react";

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

export type PlaybackPosterSurfacePhase = "bootstrap" | "playing";

export function playbackPosterSurfacePhase(
  operation: "resolving" | "loading" | "playing",
): PlaybackPosterSurfacePhase {
  return operation === "playing" ? "playing" : "bootstrap";
}

/**
 * Playback bootstrap + Now Playing do not own Kitty placements except the optional
 * wide playing rail. Clear out-of-band images on surface entry and when operation
 * becomes "playing" so poster-bearing surfaces (browse, post-play, pickers) cannot
 * leave ghosts after unmount or in-flight fetches.
 */
export function usePlaybackPosterSurfaceCleanup(
  operation: "resolving" | "loading" | "playing",
): void {
  const phase = playbackPosterSurfacePhase(operation);
  useEffect(() => {
    clearRenderedPosterImages();
  }, [phase]);
}

/** Clears Kitty placements when a short-lived poster surface mounts or unmounts (post-play). */
export function usePosterSurfaceBoundaryCleanup(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    clearRenderedPosterImages();
    return () => {
      clearRenderedPosterImages();
    };
  }, [active]);
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
    inkEmbedded = false,
  }: {
    rows: number;
    cols: number;
    variant?: "preview" | "detail";
    allowKitty?: boolean;
    /** Chafa symbols inside Ink — does not claim Kitty placements. */
    inkEmbedded?: boolean;
  },
): Promise<PosterResult> {
  if (!url) return { kind: "none" };
  if (!inkEmbedded && !allowKitty) return { kind: "none" };
  const capability = runtime.detectImageCapability();
  if (!inkEmbedded && (!capability.available || capability.renderer === "none")) {
    return { kind: "none" };
  }
  const resolved = resolvePosterUrl(url, { cols, variant });
  const rendererKey = inkEmbedded ? "ink-embedded" : capability.renderer;
  const key = `${resolved}:${rows}x${cols}:${rendererKey}`;

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
        ? await renderPoster(source.data, { rows, cols, allowKitty, inkEmbedded })
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
