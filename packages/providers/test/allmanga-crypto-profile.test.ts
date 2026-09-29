import { describe, expect, test } from "bun:test";

import {
  ALLMANGA_BUILD_ID,
  ALLMANGA_CRYPTO_PROFILE,
  ALLMANGA_MASK_FRAGMENTS,
  buildAllMangaBootToken,
} from "../src/allmanga/crypto";
import type { AllMangaBootPart } from "../src/allmanga/crypto";

/**
 * Conformance for the pinned mkissa crypto profile. Per-build golden vectors
 * (the boot token bootstrap actually answered 200 to) live in
 * `allmanga.test.ts`; this file pins the *shape* invariants that hold across
 * rotations, so a partial profile update fails loudly instead of returning
 * zero streams.
 */
describe("allmanga crypto profile", () => {
  test("mask fragments are four 8-byte values", () => {
    expect(ALLMANGA_MASK_FRAGMENTS).toHaveLength(4);
    for (const fragment of ALLMANGA_MASK_FRAGMENTS) {
      expect(Buffer.from(fragment, "base64")).toHaveLength(8);
    }
  });

  test("boot parts name every signed field exactly once", () => {
    // Both the order and the separator rotate; a missing or duplicated part is
    // `invalid_boot_token` either way, so the set is asserted, not implied.
    expect([...ALLMANGA_CRYPTO_PROFILE.bootParts].sort()).toEqual(
      (["buildId", "epoch", "group", "host", "lane"] as AllMangaBootPart[]).sort(),
    );
  });

  test("the pinned buildId is the profile's", () => {
    expect(ALLMANGA_BUILD_ID).toBe(ALLMANGA_CRYPTO_PROFILE.buildId);
  });

  test("a www. referer host is normalised before signing", () => {
    expect(
      buildAllMangaBootToken({
        epoch: 2957,
        keyGroup: "mkissa",
        refererHost: "www.mkissa.to",
        contentLane: "k7",
      }),
    ).toBe(
      buildAllMangaBootToken({
        epoch: 2957,
        keyGroup: "mkissa",
        refererHost: "mkissa.to",
        contentLane: "k7",
      }),
    );
  });
});
