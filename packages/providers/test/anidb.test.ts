import { describe, expect, test } from "bun:test";

import {
  anidbNumericId,
  looksLikeAnidbShowId,
  searchAnidb,
  clearAnidbCachesForTest,
} from "../src/anidb/direct";
import { anidbManifest, ANIDB_PROVIDER_ID } from "../src/anidb/manifest";

describe("anidb id helpers", () => {
  test("accepts slug-numeric show ids", () => {
    expect(looksLikeAnidbShowId("onigiri-3942")).toBe(true);
    expect(looksLikeAnidbShowId("demon-slayer-kimetsu-no-yaiba-21")).toBe(true);
    expect(looksLikeAnidbShowId("anilist:21")).toBe(false);
    expect(looksLikeAnidbShowId("3942")).toBe(false);
  });

  test("extracts trailing numeric id", () => {
    expect(anidbNumericId("onigiri-3942")).toBe(3942);
    expect(anidbNumericId("nope")).toBeNull();
  });
});

describe("anidb manifest", () => {
  test("is anime-only with search + resolve capabilities", () => {
    expect(ANIDB_PROVIDER_ID).toBe("anidb");
    expect(anidbManifest.mediaKinds).toEqual(["anime"]);
    expect(anidbManifest.capabilities).toContain("search");
    expect(anidbManifest.capabilities).toContain("source-resolve");
  });
});

describe("anidb search parsing", () => {
  test("parses browse HTML fixtures", async () => {
    clearAnidbCachesForTest();
    const originalWhich = Bun.which.bind(Bun);
    Bun.which = ((_cmd: string) => null) as typeof Bun.which;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        `<a href="/anime/onigiri-3942" alt="Onigiri"><a href="/anime/demo-21" alt="Demo Title">`,
        { status: 200 },
      )) as unknown as typeof fetch;

    try {
      const results = await searchAnidb("onigiri");
      expect(results).toEqual([
        { id: "onigiri-3942", title: "Onigiri", numericId: 3942 },
        { id: "demo-21", title: "Demo Title", numericId: 21 },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});
