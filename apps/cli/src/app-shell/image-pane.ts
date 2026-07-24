import { detectImageCapability } from "@/image";
import { useEffect, useRef } from "react";

import { recordPosterFetch } from "./diagnostics/render-trace";
import {
  getKittyPlacement,
  releaseKittyImageId,
  releaseKittySlot,
  setKittyPlacementEvictFn,
  type KittyPlacementSlot,
} from "./kitty-placement-registry";
import { deleteAllTerminalImages, deleteKittyImage, renderPoster } from "./poster-renderer";
import { clearPosterSourceCache, fetchPosterSource, resolvePosterUrl } from "./poster-source-cache";
import type { PosterResult } from "./poster-types";

// LRU-style cache keyed by "url:WxH"
const posterCache = new Map<string, PosterResult>();
const posterInflight = new Map<string, Promise<PosterResult>>();
// Sized for navigation: stepping through a calendar/search list and back must not
// constantly evict + re-spawn chafa for rows just visited. 12 was small enough that
// a single screen of scrolling thrashed the cache; 64 keeps a comfortable window
// of recently-rendered posters resident.
const MAX_CACHE = 64;
const runtime = {
  detectImageCapability,
};

function evictKittyCacheEntries(imageId: number): void {
  for (const [key, value] of posterCache) {
    if (value.kind === "kitty" && value.imageId === imageId) {
      posterCache.delete(key);
    }
  }
}

setKittyPlacementEvictFn(evictKittyCacheEntries);

function dropAllKittyCacheEntries(): void {
  for (const [key, value] of posterCache) {
    if (value.kind === "kitty") {
      posterCache.delete(key);
    }
  }
}

export function deleteAllKittyImages(): void {
  clearRenderedPosterImages();
  clearPosterSourceCache();
}

/** Global wipe — surface exit / resize only. Prefer releasePosterPlacement for slots. */
export function undisplayRenderedPosterImages(): void {
  deleteAllTerminalImages();
  dropAllKittyCacheEntries();
}

/** Drop only this slot's Kitty placement; siblings stay on screen. */
export function releasePosterPlacement(slot: KittyPlacementSlot): void {
  releaseKittySlot(slot);
}

/**
 * Clear terminal Kitty placements but keep source bytes and chafa text cache.
 * Kitty cache entries are dropped so the next fetch re-uploads (d=A invalidated them).
 */
export function undisplayPlacementsKeepCache(): void {
  deleteAllTerminalImages();
  dropAllKittyCacheEntries();
}

export function clearRenderedPosterImages(): void {
  undisplayRenderedPosterImages();
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
  const sawBootstrapRef = useRef(false);
  useEffect(() => {
    if (phase === "bootstrap") {
      sawBootstrapRef.current = true;
      clearRenderedPosterImages();
      return;
    }
    if (phase === "playing") {
      if (sawBootstrapRef.current) {
        // Loading → playing keeps the same poster in cache; clearing here caused flicker.
        sawBootstrapRef.current = false;
        return;
      }
      clearRenderedPosterImages();
    }
  }, [phase]);
}

/**
 * Short-lived poster surfaces (post-play): on mount, clear placements only so
 * cached PNG/chafa bytes stay warm; on unmount, full clear including caches.
 */
export function usePosterSurfaceBoundaryCleanup(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    undisplayPlacementsKeepCache();
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
    releaseKittyImageId(cached.imageId);
  }
  posterCache.delete(key);
}

export type PosterFetchOptions = {
  rows: number;
  cols: number;
  variant?: "preview" | "detail";
  allowKitty?: boolean;
  /** Chafa symbols inside Ink — does not claim Kitty placements. */
  inkEmbedded?: boolean;
  placementSlot?: KittyPlacementSlot;
  signal?: AbortSignal;
};

/**
 * Cache identity for one poster render. Extracted so the synchronous probe
 * (`isPosterCached`) and `fetchPoster` can never drift: a probe computing its
 * own key would silently report misses and make every render spin.
 */
function posterCacheKey(
  url: string,
  { rows, cols, variant = "preview", inkEmbedded = false, placementSlot }: PosterFetchOptions,
): { readonly key: string; readonly resolved: string; readonly rendererKey: string } {
  const resolved = resolvePosterUrl(url, { cols, variant });
  const rendererKey = inkEmbedded ? "ink-embedded" : runtime.detectImageCapability().renderer;
  // Slot in the key so concurrent Kitty placements of the same URL get distinct imageIds.
  const slotKey = placementSlot && !inkEmbedded ? `:${placementSlot}` : "";
  return { key: `${resolved}:${rows}x${cols}:${rendererKey}${slotKey}`, resolved, rendererKey };
}

/**
 * Synchronous "will this render without I/O?" probe.
 *
 * Only the spinner policy uses this: a poster already in cache paints on the
 * very next frame, so arming a spinner for it would flash rose for one frame on
 * every revisit. Deliberately conservative — an in-flight entry counts as a miss
 * (it has not painted yet), and a stale slotted Kitty id counts as a miss for
 * the same reason `fetchPoster` re-uploads it.
 */
export function isPosterCached(url: string | undefined, options: PosterFetchOptions): boolean {
  if (!url) return false;
  const { key } = posterCacheKey(url, options);
  const cached = posterCache.get(key);
  if (!cached) return false;
  if (cached.kind === "kitty" && options.placementSlot) {
    return getKittyPlacement(options.placementSlot) === cached.imageId;
  }
  return true;
}

export async function fetchPoster(
  url: string | undefined,
  {
    rows,
    cols,
    variant = "preview",
    allowKitty = true,
    inkEmbedded = false,
    placementSlot,
    signal,
  }: PosterFetchOptions,
): Promise<PosterResult> {
  if (!url) return { kind: "none" };
  if (signal?.aborted) return { kind: "none" };
  if (!inkEmbedded && !allowKitty) return { kind: "none" };
  const capability = runtime.detectImageCapability();
  if (!inkEmbedded && (!capability.available || capability.renderer === "none")) {
    return { kind: "none" };
  }
  const { key, resolved, rendererKey } = posterCacheKey(url, {
    rows,
    cols,
    variant,
    inkEmbedded,
    placementSlot,
  });

  const cached = posterCache.get(key);
  if (cached) {
    // Slotted Kitty cache is only valid while the registry still owns that imageId.
    // Per-slot deletes / d=A otherwise leave dead ids that look like hits.
    // Unslotted Kitty entries are dropped wholesale on global wipe, so a remaining
    // cache hit is still live for this process.
    if (cached.kind === "kitty" && placementSlot) {
      const liveId = getKittyPlacement(placementSlot);
      if (liveId !== cached.imageId) {
        posterCache.delete(key);
      } else {
        recordPosterFetch({ cacheHit: true, renderer: rendererKey });
        return cached;
      }
    } else {
      recordPosterFetch({ cacheHit: true, renderer: rendererKey });
      return cached;
    }
  }

  // Never join an in-flight task when this caller has an AbortSignal — the leader
  // may abort to `{ kind: "none" }` and blank a remount that should still render.
  const inflight = posterInflight.get(key);
  if (inflight && !signal) {
    recordPosterFetch({ cacheHit: true, renderer: rendererKey });
    return inflight;
  }

  recordPosterFetch({ cacheHit: false, spawned: true, renderer: rendererKey });
  const task = (async (): Promise<PosterResult> => {
    let result: PosterResult;
    try {
      if (signal?.aborted) return { kind: "none" };
      const source = await fetchPosterSource(resolved, { cols, variant, signal });
      if (signal?.aborted) return { kind: "none" };
      result = source
        ? await renderPoster(source.data, {
            rows,
            cols,
            allowKitty,
            inkEmbedded,
            placementSlot,
            signal,
          })
        : { kind: "none" };
    } catch {
      result = { kind: "none" };
    }

    if (signal?.aborted) return { kind: "none" };

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
export type { KittyPlacementSlot } from "./kitty-placement-registry";

export { deleteKittyImage };
