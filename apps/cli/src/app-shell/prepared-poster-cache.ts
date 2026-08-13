// =============================================================================
// prepared-poster-cache.ts — one native preparation per source and geometry.
//
// Preparation is the expensive step (decode + resize + PNG bridge), and the same
// poster is routinely wanted at the same size by more than one surface: two rails
// showing the same title, a details pane revisited during navigation. Keying by
// source identity *and* target pixel bounds is what makes that cost once —
// keying by identity alone would hand a rail-sized poster to a hero.
//
// Both halves of a PreparedPoster stay resident, so the cache weighs the PNG and
// the decoded RGBA together; counting one would under-report by the larger.
// =============================================================================

import { preparePoster, type PosterPixelBounds, type PreparedPoster } from "@/image/native-image";

import { ByteBudgetLruCache } from "./poster-byte-cache";
import type { PosterSource } from "./poster-source-cache";

export const MAX_PREPARED_POSTER_CACHE_ENTRIES = 64;
export const MAX_PREPARED_POSTER_CACHE_BYTES = 32 * 1024 * 1024;

const runtime = {
  preparePoster,
};

const preparedCache = new ByteBudgetLruCache<string, PreparedPoster>({
  maxEntries: MAX_PREPARED_POSTER_CACHE_ENTRIES,
  maxBytes: MAX_PREPARED_POSTER_CACHE_BYTES,
  weight: (poster) => poster.png.byteLength + poster.image.rgba.byteLength,
});

export function preparedPosterCacheKey(sourceIdentity: string, bounds: PosterPixelBounds): string {
  return `${sourceIdentity}@${bounds.maxWidthPx}x${bounds.maxHeightPx}`;
}

export function clearPreparedPosterCache(): void {
  preparedCache.clear();
}

/**
 * The prepared poster for this source at these bounds, preparing it if needed.
 *
 * Returns the identical object on a hit, because renderer-side caches key off it.
 * Failed and aborted preparations are not cached: a cached null would turn one
 * transient decode failure into a permanent missing poster for the process.
 */
export async function getPreparedPoster(
  source: PosterSource,
  bounds: PosterPixelBounds,
  signal?: AbortSignal,
): Promise<PreparedPoster | null> {
  const key = preparedPosterCacheKey(source.identity, bounds);
  const cached = preparedCache.get(key);
  if (cached) return cached;
  if (signal?.aborted) return null;

  const prepared = await runtime.preparePoster(source.bytes, bounds, signal);
  if (!prepared || signal?.aborted) return null;

  preparedCache.set(key, prepared);
  return prepared;
}

export const __testing = {
  runtime,
  realPreparePoster: preparePoster,
  cacheSize: () => preparedCache.size,
  cacheBytes: () => preparedCache.byteLength,
};
