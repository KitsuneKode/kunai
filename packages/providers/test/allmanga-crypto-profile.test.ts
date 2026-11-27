import { describe, expect, test } from "bun:test";

import {
  ALLMANGA_BUILD_ID,
  ALLMANGA_CRYPTO_PROFILE,
  ALLMANGA_MASK_FRAGMENTS,
  buildAllMangaBootToken,
  currentAllMangaEpochCandidates,
  getEffectiveAllMangaEpochMs,
} from "../src/allmanga/crypto";
import type { AllMangaBootPart } from "../src/allmanga/crypto";
import { setActiveProviderHotfixManifest } from "../src/shared/hotfix-runtime";

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
      // SAFETY: the literal list is the assertion's ground truth for the boot-part set.
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
  test("a hotfix rotation profile carries its epoch scale into candidate selection", () => {
    setActiveProviderHotfixManifest({
      schemaVersion: 1,
      revision: 1,
      generatedAt: "2026-11-27T00:00:00.000Z",
      expiresAt: "2026-11-28T00:00:00.000Z",
      providers: {
        allanime: {
          cryptoOverrides: {
            buildId: "205",
            saltMul: "17",
            saltAdd: "23",
            fragMul: "11",
            fragAdd: "3",
            bootPrefix: "PRE:",
            bootJoin: "|",
            bootParts: "group,host,lane,buildId,epoch",
            maskFragments: "AAAAAAAAAAA=,BBBBBBBBBBB=,CCCCCCCCCCC=,DDDDDDDDDDD=",
            epochMs: "120000",
            epochGraceMs: "10000",
          },
        },
      },
    });
    try {
      expect(getEffectiveAllMangaEpochMs()).toBe(120_000);
      expect(currentAllMangaEpochCandidates(5 * 120_000 + 1_000)).toEqual([4, 5]);
      expect(currentAllMangaEpochCandidates(5 * 120_000 + 11_000)).toEqual([5]);
    } finally {
      setActiveProviderHotfixManifest(null);
    }
  });
});
