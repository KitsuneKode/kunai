import { describe, expect, test } from "bun:test";

import {
  ALLMANGA_BOOT_PAYLOAD_FIELDS,
  ALLMANGA_BUILD_ID,
  ALLMANGA_MASK_FRAGMENTS,
  buildAllMangaBootToken,
  deriveMaskKey,
} from "../src/allmanga/crypto";

/**
 * Golden vectors for the mkissa build-166 rotation, extracted from the live
 * crypto chunk (`_app/immutable/chunks/BVxTyUEI.js`, config object `Rf`) and
 * confirmed end to end on 2026-09-08: this boot token is what
 * `GET /client-crypto/v1/bootstrap?buildId=166&k=k7` answered `200` to.
 *
 * The rotation moved every constant at once — salt, fragment mixers, the boot
 * prefix, the join character, and the payload field order — so a partial update
 * still fails with `invalid_boot_token`. These vectors exist to make an
 * accidental edit of any one of them fail loudly instead of silently returning
 * zero streams.
 */
describe("build-166 crypto material", () => {
  test("mask fragments are four 8-byte values", () => {
    expect(ALLMANGA_MASK_FRAGMENTS).toHaveLength(4);
    for (const fragment of ALLMANGA_MASK_FRAGMENTS) {
      expect(Buffer.from(fragment, "base64")).toHaveLength(8);
    }
  });

  test("deriveMaskKey reproduces the live mask key", () => {
    expect(deriveMaskKey().toString("hex")).toBe(
      "93bf9583f597adb57f0823c99532cdc02a359c1a0f04a8a6b935d1e34587a27b",
    );
  });

  test("the boot token matches the value bootstrap accepted", () => {
    const token = buildAllMangaBootToken({
      epoch: 2957,
      keyGroup: "mkissa",
      refererHost: "mkissa.to",
      contentLane: "k7",
    });

    expect(token).toBe("59199a3a63e6c8cb88c9204aa2aa2321401005d5b0852d6a027bb7973d3e5474");
  });

  test("the boot payload is ordered group, lane, epoch, host, buildId", () => {
    // Build 140 hashed group.host.lane.buildId.epoch joined by ".". Both the
    // order and the separator changed, and either alone is enough to be
    // rejected, so the order is asserted rather than left implicit.
    expect(ALLMANGA_BOOT_PAYLOAD_FIELDS).toEqual(["group", "lane", "epoch", "host", "buildId"]);
  });

  test("the pinned buildId is the one the mask fragments belong to", () => {
    expect(ALLMANGA_BUILD_ID).toBe("166");
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
