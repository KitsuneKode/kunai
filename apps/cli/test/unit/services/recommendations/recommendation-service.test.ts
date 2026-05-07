import { describe, expect, test } from "bun:test";

import {
  buildRecommendCacheKey,
  isCacheExpired,
} from "@/services/recommendations/RecommendationServiceImpl";

describe("recommendation cache", () => {
  test("buildRecommendCacheKey includes id and type", () => {
    const key = buildRecommendCacheKey("438631", "movie");
    expect(key).toBe("recommend:movie:438631");
  });

  test("buildRecommendCacheKey uses 'trending' for trending section", () => {
    const key = buildRecommendCacheKey("trending", "trending");
    expect(key).toBe("recommend:trending:trending");
  });

  test("isCacheExpired returns true when cachedAt is older than ttl", () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    expect(isCacheExpired(old, 24 * 60 * 60 * 1000)).toBe(true);
  });

  test("isCacheExpired returns false when cachedAt is within ttl", () => {
    const recent = Date.now() - 1 * 60 * 60 * 1000;
    expect(isCacheExpired(recent, 24 * 60 * 60 * 1000)).toBe(false);
  });
});
