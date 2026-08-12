import { describe, expect, test } from "bun:test";

import {
  anidbNumericId,
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  searchAnidb,
} from "../src/anidb/direct";
import { anidbManifest, ANIDB_PROVIDER_ID } from "../src/anidb/manifest";

const fixture = (name: string) =>
  Bun.file(new URL(`./fixtures/anidb/${name}`, import.meta.url)).text();

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

  test("rejects a non-positive numeric suffix", () => {
    expect(looksLikeAnidbShowId("bad-0")).toBe(false);
    expect(anidbNumericId("bad-0")).toBeNull();
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

describe("anidb browse parsing", () => {
  test("parses legacy relative links whose title lives in image alt", async () => {
    expect(parseAnidbBrowseHtml(await fixture("browse-legacy.html"))).toEqual([
      {
        id: "onigiri-3942",
        title: "Onigiri & Friends",
        numericId: 3942,
        seasonEvidence: {
          seasonNumber: null,
          label: null,
          normalizedBaseTitle: "onigiri friends",
        },
      },
    ]);
  });

  test("captures the complete opening tag so title after href wins over image alt and nested text", async () => {
    expect(parseAnidbBrowseHtml(await fixture("browse-current.html"))).toEqual([
      {
        id: "solo-leveling-19413",
        title: "Solo Leveling",
        numericId: 19413,
        seasonEvidence: {
          seasonNumber: null,
          label: null,
          normalizedBaseTitle: "solo leveling",
        },
      },
      {
        id: "solo-leveling-season-2-19837",
        title: "Solo Leveling Season 2",
        numericId: 19837,
        seasonEvidence: {
          seasonNumber: 2,
          label: "Season 2",
          normalizedBaseTitle: "solo leveling",
        },
      },
    ]);
  });

  test("decodes numeric entities and rejects non-positive suffixes", () => {
    const html = [
      '<a href="/anime/rock-and-roll-42"><img alt="Rock &#39;n&#x20;Roll"></a>',
      '<a href="/anime/zero-0"><img alt="Zero"></a>',
      '<a href="/anime/plain-identifier"><img alt="Plain"></a>',
    ].join("");
    expect(parseAnidbBrowseHtml(html).map((result) => result.title)).toEqual(["Rock 'n Roll"]);
  });

  test("never lets a prefixed attribute shadow href or title", () => {
    const html = [
      '<a data-href="/anime/hostile-666" href="/anime/real-123" title="Real Show"></a>',
      '<a xlink:href="/anime/hostile-777" href="/anime/other-124"><img alt="Other Show"></a>',
      '<a href="/anime/third-125" data-original-title="Tooltip junk" title="Third Show"></a>',
    ].join("");
    expect(parseAnidbBrowseHtml(html).map((result) => [result.id, result.title])).toEqual([
      ["real-123", "Real Show"],
      ["other-124", "Other Show"],
      ["third-125", "Third Show"],
    ]);
  });

  test("accepts protocol-relative anidb hrefs", () => {
    expect(
      parseAnidbBrowseHtml('<a href="//anidb.app/anime/relative-88" title="Relative"></a>'),
    ).toEqual([
      {
        id: "relative-88",
        title: "Relative",
        numericId: 88,
        seasonEvidence: { seasonNumber: null, label: null, normalizedBaseTitle: "relative" },
      },
    ]);
  });

  test("decodes each entity exactly once and rejects lone surrogates", () => {
    const html = [
      '<a href="/anime/escaped-1" title="Literal &amp;lt;tag&amp;gt; &amp; &amp;#39;quote&amp;#39;"></a>',
      '<a href="/anime/surrogate-2" title="Lone &#xD800; surrogate"></a>',
    ].join("");
    expect(parseAnidbBrowseHtml(html).map((result) => result.title)).toEqual([
      "Literal &lt;tag&gt; & &#39;quote&#39;",
      "Lone &#xD800; surrogate",
    ]);
  });

  test("ignores nav, breadcrumb, related and footer anime links around the result grid", async () => {
    const results = parseAnidbBrowseHtml(await fixture("browse-with-page-chrome.html"));
    expect(results.map((result) => result.id)).toEqual(["onigiri-3942", "onigiri-tabetai-4501"]);
    expect(results[0]?.id).toBe("onigiri-3942");
  });

  test("extracts deterministic season evidence", () => {
    expect(parseAnidbSeasonEvidence("Mob Psycho 100 3rd Season")).toEqual({
      seasonNumber: 3,
      label: "3rd Season",
      normalizedBaseTitle: "mob psycho 100",
    });
    expect(parseAnidbSeasonEvidence("Demon Slayer S2")).toEqual({
      seasonNumber: 2,
      label: "S2",
      normalizedBaseTitle: "demon slayer",
    });
  });
});

describe("chooseAnidbSearchMatch", () => {
  const parse = (html: string) => parseAnidbBrowseHtml(html);
  const card = (id: string, title: string) =>
    `<a href="/anime/${id}" title="${title}"><article></article></a>`;

  test("prefers an exact normalized title match over document order", () => {
    const results = parse(
      [card("wrong-first-1", "Onigiri Tabetai"), card("onigiri-3942", "Onigiri!")].join(""),
    );
    expect(chooseAnidbSearchMatch("onigiri", results)?.id).toBe("onigiri-3942");
  });

  test("falls back to a prefix match when nothing matches exactly", () => {
    const results = parse(
      [card("unrelated-9", "Bleach"), card("solo-19413", "Solo Leveling Origins")].join(""),
    );
    expect(chooseAnidbSearchMatch("solo leveling", results)?.id).toBe("solo-19413");
  });

  test("falls back to the first result when no title evidence matches", () => {
    const results = parse([card("first-1", "Alpha"), card("second-2", "Beta")].join(""));
    expect(chooseAnidbSearchMatch("nothing comparable", results)?.id).toBe("first-1");
  });

  test("returns null for an empty result set", () => {
    expect(chooseAnidbSearchMatch("anything", [])).toBeNull();
  });
});

describe("anidb search delegation", () => {
  test("searchAnidb returns the shared browse parser contract", async () => {
    clearAnidbCachesForTest();
    const page = await fixture("browse-current.html");
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async () =>
        new Response(page, { status: 200 })) as unknown as typeof fetch;
      expect(await searchAnidb("solo leveling")).toEqual(parseAnidbBrowseHtml(page));
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});
