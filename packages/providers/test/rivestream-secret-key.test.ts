import { describe, expect, test } from "bun:test";

import { generateSecretKey } from "../src/rivestream/direct";

/**
 * Rotation canary for the Rivestream `secretKey` scheme.
 *
 * `generateSecretKey` is a local port of the site's MurmurHash + `cArray`
 * salt construction. Upstream rotates every constant at once, and a rotation
 * otherwise surfaces as 401 resolve failures, not a failing test (see the
 * `productionGap` in `src/research.ts` and the known failure modes in
 * `.docs/provider-dossiers/rivestream.md`). These pinned vectors fail fast in
 * CI when the salt or hash rotates.
 */
describe("rivestream secretKey generation", () => {
  test("matches the pinned vectors for known TMDB ids", () => {
    expect(generateSecretKey("550")).toBe("NDQzM2UwYzI=");
    expect(generateSecretKey("1396")).toBe("Nzg3ZmU5YTI=");
    expect(generateSecretKey("1423191")).toBe("LTU1MTIzOGEz");
  });

  test("output shape is stable: 12-char base64, never a sentinel", () => {
    // The key is `btoa` of a hex digest: always 12 chars (padding varies —
    // a negative int32 digest stringifies to 9 chars, so the third vector has
    // no `=`), never the `generateSecretKey` fallbacks (`rive` /
    // `topSecret`), which the resolve path refuses to cache.
    for (const tmdbId of ["550", "1396", "1423191"]) {
      const key = generateSecretKey(tmdbId);
      expect(key).toMatch(/^[A-Za-z0-9+/=]{12}$/);
      expect(key.length).toBe(12);
      expect(["rive", "topSecret"]).not.toContain(key);
    }
  });

  test("generation is deterministic per title", () => {
    expect(generateSecretKey("550")).toBe(generateSecretKey("550"));
  });
});
