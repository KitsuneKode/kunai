import { detectImageCapability } from "@/image";
import { useEffect, useRef } from "react";

import { recordPosterFetch } from "./diagnostics/render-trace";
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

export function deleteAllKittyImages(): void {
  clearRenderedPosterImages();
  clearPosterSourceCache();
}

export function undisplayRenderedPosterImages(): void {
  deleteAllTerminalImages();
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
  if (cached) {
    recordPosterFetch({ cacheHit: true, renderer: rendererKey });
    return cached;
  }

  const inflight = posterInflight.get(key);
  if (inflight) {
    // Deduped against an in-flight render — no new subprocess is spawned.
    recordPosterFetch({ cacheHit: true, renderer: rendererKey });
    return inflight;
  }

  recordPosterFetch({ cacheHit: false, spawned: true, renderer: rendererKey });
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
