import { describe, expect, test } from "bun:test";

import {
  allMangaCryptoRemedy,
  diagnoseAllMangaBootstrap,
} from "../../live/allmanga-crypto-freshness";

/**
 * Response shapes observed live on 2026-09-08 while recovering the 140 -> 166
 * rotation. Each one points at a different fix, and telling them apart is what
 * makes the next rotation cheap.
 */
describe("diagnoseAllMangaBootstrap", () => {
  test("a 200 means the pinned constants still work", () => {
    expect(diagnoseAllMangaBootstrap(200, '{"epoch":2957,"partB":"..."}')).toBe("current");
  });

  test("unknown_build_id means the build id rotated out", () => {
    expect(diagnoseAllMangaBootstrap(404, '{"error":"unknown_build_id"}')).toBe("build-id-rotated");
  });

  test("invalid_boot_token means the build id is current but the constants moved", () => {
    // This is the distinction that matters: the id is fine, so bumping it alone
    // would change nothing and look like the recovery had failed.
    expect(diagnoseAllMangaBootstrap(403, '{"error":"invalid_boot_token"}')).toBe(
      "derivation-constants-rotated",
    );
  });

  test("a missing param is our request, not upstream drift", () => {
    expect(diagnoseAllMangaBootstrap(400, '{"error":"missing_build_id"}')).toBe("request-shape");
    expect(diagnoseAllMangaBootstrap(400, '{"error":"missing_or_invalid_lane"}')).toBe(
      "request-shape",
    );
  });

  test("an HTML body is a Cloudflare challenge, not an API answer", () => {
    expect(diagnoseAllMangaBootstrap(403, "<!DOCTYPE html><html>Just a moment")).toBe("blocked");
  });

  test("anything else is unreachable rather than a guess", () => {
    expect(diagnoseAllMangaBootstrap(0, "fetch failed")).toBe("unreachable");
  });
});

describe("allMangaCryptoRemedy", () => {
  test("each rotation diagnosis names its own fix", () => {
    expect(allMangaCryptoRemedy("build-id-rotated", 0)).toContain("Scan build ids");
    expect(allMangaCryptoRemedy("derivation-constants-rotated", 0)).toContain("re-extract Rf");
  });

  test("a working bootstrap with stale bundled material still asks for a refresh", () => {
    // The bundled fallback expires on its own: the epoch is a 7-day bucket, so
    // a resolve can quietly run on material two epochs old and look like a dead
    // provider.
    expect(allMangaCryptoRemedy("current", 2)).toContain("stale");
    expect(allMangaCryptoRemedy("current", 0)).toBeUndefined();
  });
});
