import { describe, expect, test } from "bun:test";

import { clearMiruroCachesForTest, MIRURO_CACHE_LIMITS } from "../src/miruro/direct";
import {
  buildRivestreamCycleCandidates,
  clearRivestreamCachesForTest,
} from "../src/rivestream/direct";

describe("provider cache bounds", () => {
  test("miruro cache limits are finite and modest", () => {
    expect(MIRURO_CACHE_LIMITS.episodeEntries).toBeGreaterThan(0);
    expect(MIRURO_CACHE_LIMITS.episodeEntries).toBeLessThanOrEqual(1024);
    expect(MIRURO_CACHE_LIMITS.sourceEntries).toBeGreaterThan(0);
    expect(MIRURO_CACHE_LIMITS.sourceEntries).toBeLessThanOrEqual(1024);
  });

  test("clearMiruroCachesForTest is callable and idempotent", () => {
    // The test seam the smoke relies on must exist and not throw on a cold cache.
    expect(() => {
      clearMiruroCachesForTest();
      clearMiruroCachesForTest();
    }).not.toThrow();
  });

  test("clearRivestreamCachesForTest is callable and idempotent", () => {
    expect(() => {
      clearRivestreamCachesForTest();
      clearRivestreamCachesForTest();
    }).not.toThrow();
  });

  test("the rivestream cycle builder still resolves (smoke that the module loads)", () => {
    // Guards against the secret-key cache refactor breaking module load.
    const candidates = buildRivestreamCycleCandidates(["flowcast"], undefined, undefined);
    expect(candidates.length).toBe(1);
  });
});
