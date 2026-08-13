import { afterEach, describe, expect, test } from "bun:test";

import type { PosterSource } from "@/app-shell/poster-source-cache";
import {
  __testing as preparedTesting,
  clearPreparedPosterCache,
  getPreparedPoster,
  MAX_PREPARED_POSTER_CACHE_BYTES,
  MAX_PREPARED_POSTER_CACHE_ENTRIES,
  preparedPosterCacheKey,
} from "@/app-shell/prepared-poster-cache";

import { makeRgbPng } from "../../support/image-fixtures";

afterEach(() => {
  clearPreparedPosterCache();
  preparedTesting.runtime.preparePoster = preparedTesting.realPreparePoster;
});

function gradient(width: number, height: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < width * height; index += 1) {
    out.push((index * 37) % 256, (index * 91) % 256, (index * 17) % 256);
  }
  return out;
}

function source(identity: string, width = 40, height = 20): PosterSource {
  return { identity, bytes: makeRgbPng(width, height, gradient(width, height)) };
}

describe("preparedPosterCacheKey", () => {
  test("includes source identity and both pixel bounds", () => {
    const key = preparedPosterCacheKey("https://cdn/x.jpg", { maxWidthPx: 80, maxHeightPx: 40 });

    expect(key).toContain("https://cdn/x.jpg");
    expect(key).toContain("80");
    expect(key).toContain("40");
  });

  test("separates the same source at different geometries", () => {
    // A poster fitted for a 20-cell rail is not the poster fitted for a 40-cell
    // hero, so one key for both would hand the wrong pixels to a renderer.
    expect(preparedPosterCacheKey("s", { maxWidthPx: 80, maxHeightPx: 40 })).not.toBe(
      preparedPosterCacheKey("s", { maxWidthPx: 160, maxHeightPx: 80 }),
    );
  });

  test("separates different sources at the same geometry", () => {
    expect(preparedPosterCacheKey("a", { maxWidthPx: 80, maxHeightPx: 40 })).not.toBe(
      preparedPosterCacheKey("b", { maxWidthPx: 80, maxHeightPx: 40 }),
    );
  });
});

describe("getPreparedPoster", () => {
  test("prepares once and serves repeats from cache", async () => {
    let prepareCalls = 0;
    preparedTesting.runtime.preparePoster = async (bytes, bounds, signal) => {
      prepareCalls += 1;
      return preparedTesting.realPreparePoster(bytes, bounds, signal);
    };
    const bounds = { maxWidthPx: 20, maxHeightPx: 20 };

    const first = await getPreparedPoster(source("poster-1"), bounds);
    const second = await getPreparedPoster(source("poster-1"), bounds);

    expect(prepareCalls).toBe(1);
    // Identity, not just equality: the renderers key their own caches off these
    // objects, so a fresh copy per call would defeat them.
    expect(second).toBe(first);
  });

  test("prepares again when the target geometry changes", async () => {
    let prepareCalls = 0;
    preparedTesting.runtime.preparePoster = async (bytes, bounds, signal) => {
      prepareCalls += 1;
      return preparedTesting.realPreparePoster(bytes, bounds, signal);
    };

    const small = await getPreparedPoster(source("poster-1"), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });
    const large = await getPreparedPoster(source("poster-1"), {
      maxWidthPx: 40,
      maxHeightPx: 40,
    });

    expect(prepareCalls).toBe(2);
    expect(large?.image.width).toBeGreaterThan(small?.image.width ?? 0);
  });

  test("shares one prepared poster across placement slots", async () => {
    // Two rails showing the same title at the same size is the common case; it
    // must cost one native pass, not one per slot.
    let prepareCalls = 0;
    preparedTesting.runtime.preparePoster = async (bytes, bounds, signal) => {
      prepareCalls += 1;
      return preparedTesting.realPreparePoster(bytes, bounds, signal);
    };
    const bounds = { maxWidthPx: 20, maxHeightPx: 20 };

    await getPreparedPoster(source("shared"), bounds);
    await getPreparedPoster(source("shared"), bounds);

    expect(prepareCalls).toBe(1);
  });

  test("does not cache a failed preparation", async () => {
    preparedTesting.runtime.preparePoster = async () => null;
    const bounds = { maxWidthPx: 20, maxHeightPx: 20 };

    expect(await getPreparedPoster(source("broken"), bounds)).toBeNull();

    preparedTesting.runtime.preparePoster = preparedTesting.realPreparePoster;
    // A cached null would make one transient decode failure permanent.
    expect(await getPreparedPoster(source("broken"), bounds)).not.toBeNull();
  });

  test("does not cache an aborted preparation", async () => {
    const controller = new AbortController();
    const bounds = { maxWidthPx: 20, maxHeightPx: 20 };
    preparedTesting.runtime.preparePoster = async (bytes, targetBounds, signal) => {
      controller.abort();
      return preparedTesting.realPreparePoster(bytes, targetBounds, signal);
    };

    expect(await getPreparedPoster(source("aborted"), bounds, controller.signal)).toBeNull();
    expect(preparedTesting.cacheSize()).toBe(0);
  });

  test("evicts by byte budget, not just entry count", async () => {
    expect(MAX_PREPARED_POSTER_CACHE_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_PREPARED_POSTER_CACHE_ENTRIES).toBe(64);

    for (let index = 0; index < MAX_PREPARED_POSTER_CACHE_ENTRIES + 4; index += 1) {
      await getPreparedPoster(source(`poster-${index}`), { maxWidthPx: 20, maxHeightPx: 20 });
    }

    expect(preparedTesting.cacheSize()).toBeLessThanOrEqual(MAX_PREPARED_POSTER_CACHE_ENTRIES);
    expect(preparedTesting.cacheBytes()).toBeLessThanOrEqual(MAX_PREPARED_POSTER_CACHE_BYTES);
  });

  test("weighs an entry by both the PNG and the decoded RGBA it holds", async () => {
    const prepared = await getPreparedPoster(source("weighed"), {
      maxWidthPx: 20,
      maxHeightPx: 20,
    });

    // Both halves stay resident and both cost memory, so counting only one
    // would under-report the cache by the larger of the two.
    expect(preparedTesting.cacheBytes()).toBe(
      (prepared?.png.byteLength ?? 0) + (prepared?.image.rgba.byteLength ?? 0),
    );
  });
});
