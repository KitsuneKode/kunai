import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  anidbNumericId,
  anidbProviderModule,
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  fetchAnidbMalId,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  anidbCipherArgs,
  resolveAnidbCurl,
  searchAnidb,
} from "../src/anidb/direct";
import { anidbManifest, ANIDB_PROVIDER_ID } from "../src/anidb/manifest";
import { clearAnimeMetadataCacheForTest } from "../src/shared/anime-metadata";
import { isOfficialAnidbApi } from "./helpers/anidb-urls";

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

  test("strips script blocks behind every legal end-tag form", () => {
    // An end tag's name ends at whitespace, `/`, or `>`; the rest is ignored.
    // Missing any of these leaves "var leaked = 1; Real Title" as the title.
    for (const endTag of ["</script>", "</script >", "</script\t\n bar>", "</script/>"]) {
      const html = `<a href="/anime/scripted-77"><script>var leaked = 1;${endTag}<span>Real Title</span></a>`;
      expect(parseAnidbBrowseHtml(html).map((result) => result.title)).toEqual(["Real Title"]);
    }
  });

  test("does not treat a longer tag name as a script end tag", () => {
    // `</scriptfoo>` closes nothing; over-broad stripping would swallow the title.
    const html = '<a href="/anime/notscript-78"><span>Real Title</span><scriptfoo></scriptfoo></a>';
    expect(parseAnidbBrowseHtml(html).map((result) => result.title)).toEqual(["Real Title"]);
  });

  test("classifies card evidence in linear time on adversarial markup", () => {
    // `<a` repeated with no closing `>` is the quadratic case for a
    // `/<[a-z][^>]*>/` scan. Budget is generous; a regression blows past it.
    const hostile = `<a href="/anime/hostile-9">${"<a".repeat(60_000)}</a>`;
    const startedAt = performance.now();
    expect(parseAnidbBrowseHtml(hostile)).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("strips script blocks in linear time on repeated unterminated end tags", () => {
    // The lazy-body + optional-tail regex this replaced was polynomial here:
    // each `</script\t` repetition re-scanned to end of input.
    const hostile = `<a href="/anime/redos-10" title="T"><script>${"</script\t".repeat(40_000)}</a>`;
    const startedAt = performance.now();
    expect(parseAnidbBrowseHtml(hostile).map((result) => result.title)).toEqual(["T"]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("strips tags in linear time on unclosed angle brackets", () => {
    // `/<[^>]+>/g` restarted a scan to end of input at every `<`.
    const hostile = `<a href="/anime/tagredos-14" title="T">${"<".repeat(200_000)}</a>`;
    const startedAt = performance.now();
    expect(parseAnidbBrowseHtml(hostile).map((result) => result.title)).toEqual(["T"]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("never emits terminal control characters, raw or entity-encoded", () => {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    // These titles are printed to a terminal. ESC drives cursor movement, screen
    // clears, and OSC 52 clipboard writes, so a provider must not be able to put
    // one in a title -- least of all via `&#27;`, which is plain ASCII on the
    // wire and would otherwise be minted into a real ESC by our own decoder.
    const html = [
      `<a href="/anime/raw-11" title="Raw${ESC}[2J${BEL}Title"></a>`,
      '<a href="/anime/entity-12" title="Entity&#27;[2JTitle"></a>',
      '<a href="/anime/hexentity-13" title="Hex&#x1b;[2JTitle"></a>',
    ].join("");

    const titles = parseAnidbBrowseHtml(html).map((result) => result.title);
    expect(titles).toEqual(["Raw[2JTitle", "Entity&#27;[2JTitle", "Hex&#x1b;[2JTitle"]);
    const controlCharacters = titles
      .flatMap((title) => [...title])
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      });
    expect(controlCharacters).toEqual([]);
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

describe("anidb curl selection", () => {
  // Parity with ani-cli v5 `dep_ch_failover`. anidb.app is behind Cloudflare,
  // which fingerprints the TLS handshake, so a browser UA over curl's own
  // handshake still gets challenged -- and a challenge page parses to zero
  // search results, which is a release blocker for the default provider.
  test("prefers the newest curl-impersonate build over plain curl", () => {
    const present = new Set(["curl", "curl_chrome116", "curl_firefox135"]);
    expect(resolveAnidbCurl((cmd) => (present.has(cmd) ? `/usr/bin/${cmd}` : null))).toEqual({
      path: "/usr/bin/curl_firefox135",
      impersonates: true,
    });
  });

  test("falls back through older impersonate builds before plain curl", () => {
    const present = new Set(["curl", "curl_ff117"]);
    expect(resolveAnidbCurl((cmd) => (present.has(cmd) ? `/usr/bin/${cmd}` : null))).toEqual({
      path: "/usr/bin/curl_ff117",
      impersonates: true,
    });
  });

  test("marks plain curl as non-impersonating so cipher flags are applied", () => {
    expect(resolveAnidbCurl((cmd) => (cmd === "curl" ? "/usr/bin/curl" : null))).toEqual({
      path: "/usr/bin/curl",
      impersonates: false,
    });
  });

  test("reports no curl at all so the caller can fall back to fetch", () => {
    expect(resolveAnidbCurl(() => null)).toBeNull();
  });

  // ani-cli sets cipher flags only on Darwin. Windows curl.exe links Schannel,
  // which rejects --tls13-ciphers and OpenSSL cipher names outright, so sending
  // them there fails the request rather than hardening it.
  test("sends ani-cli's cipher flags on macOS only", () => {
    expect(anidbCipherArgs(false, "darwin")).toEqual([
      "--ciphers",
      expect.stringContaining("ECDHE-ECDSA-AES128-GCM-SHA256"),
      "--tls13-ciphers",
      expect.stringContaining("TLS_AES_128_GCM_SHA256"),
    ]);
    expect(anidbCipherArgs(false, "win32")).toEqual([]);
    expect(anidbCipherArgs(false, "linux")).toEqual([]);
  });

  test("never overrides an impersonate build's own handshake", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(anidbCipherArgs(true, platform)).toEqual([]);
    }
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

  test("does not claim audio or subtitle availability before an episode probe", async () => {
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async () =>
        new Response('<a href="/anime/show-1" title="Show"><article></article></a>', {
          status: 200,
        })) as unknown as typeof fetch;

      const search = anidbProviderModule.search;
      if (!search) throw new Error("AniDB search is not configured");
      const result = await search({ query: "Show" }, { now: () => new Date().toISOString() });

      expect(result?.[0]?.availableAudioModes).toBeUndefined();
      expect(result?.[0]?.subtitleAvailability).toBeUndefined();
      expect(result?.[0]?.languageEvidence).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});

describe("anidb direct resolve season routing", () => {
  const CONTEXT: ProviderRuntimeContext = {
    providerId: "anidb",
    now: () => new Date().toISOString(),
  };

  function anidbFetchStub(routes: {
    readonly browse?: string;
    readonly episodesByNumericId: Record<string, { id: number; number: number }[]>;
  }) {
    return (async (input: unknown) => {
      const url = String(
        typeof input === "string" ? input : ((input as { url?: string })?.url ?? input),
      );
      if (url.includes("/browse?")) {
        return new Response(routes.browse ?? "", { status: 200 });
      }
      const episodesMatch = /\/api\/frontend\/anime\/(\d+)\/episodes/.exec(url);
      if (episodesMatch?.[1]) {
        return new Response(
          JSON.stringify({ episodes: routes.episodesByNumericId[episodesMatch[1]] ?? [] }),
          { status: 200 },
        );
      }
      if (/\/api\/frontend\/episode\/\d+\/languages/.test(url)) {
        return new Response(
          JSON.stringify({
            languages: [
              { code: "jpn", name: "Japanese", embed_url: "https://anidb.app/embed/jpn-1" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/embed/")) {
        return new Response("file: 'https://cdn.example/stream.m3u8'", { status: 200 });
      }
      if (url.includes("stream.m3u8")) {
        return new Response("#EXTM3U\n#EXTINF:4,\nseg0.ts\n", { status: 200 });
      }
      throw new Error(`unexpected anidb request: ${url}`);
    }) as unknown as typeof fetch;
  }

  async function resolveWithStub(
    input: Parameters<typeof anidbProviderModule.resolve>[0],
    stub: typeof fetch,
  ) {
    clearAnidbCachesForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = stub;
      return await anidbProviderModule.resolve(input, CONTEXT);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
      clearAnidbCachesForTest();
    }
  }

  test("routes a season-2 request to the sibling title and uses cour numbering", async () => {
    const result = await resolveWithStub(
      {
        title: {
          id: "solo-leveling-19413",
          kind: "anime",
          title: "Solo Leveling",
        },
        episode: { season: 2, episode: 1, absoluteEpisode: 13 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      anidbFetchStub({
        browse: [
          '<a href="/anime/solo-leveling-19413" title="Solo Leveling"><article></article></a>',
          '<a href="/anime/solo-leveling-season-2-19837" title="Solo Leveling Season 2"><article></article></a>',
        ].join(""),
        episodesByNumericId: { "19837": [{ id: 9001, number: 1 }] },
      }),
    );

    expect(result.status).toBe("resolved");
    expect(result.trace.steps).toContainEqual(
      expect.objectContaining({
        message: "Routed AniDB season identity",
        attributes: expect.objectContaining({
          requestedSeason: 2,
          baseShowId: "solo-leveling-19413",
          routedShowId: "solo-leveling-season-2-19837",
          numberingEvidence: "cour",
          numberingEvidenceReason: "routed-season-sibling",
          episodeNumber: 1,
          usedAbsoluteEpisode: false,
        }),
      }),
    );
    expect(result.externalIds?.providerNativeIds?.anidb).toBe("solo-leveling-season-2-19837");
  });

  test("an unlabelled title whose catalog lacks the absolute episode falls back to cour numbering", async () => {
    const result = await resolveWithStub(
      {
        title: { id: "plain-show-700", kind: "anime", title: "Plain Show" },
        episode: { season: 1, episode: 1, absoluteEpisode: 13 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      anidbFetchStub({
        episodesByNumericId: {
          "700": [
            { id: 70001, number: 1 },
            { id: 70002, number: 2 },
          ],
        },
      }),
    );

    expect(result.status).toBe("resolved");
    expect(result.trace.steps).toContainEqual(
      expect.objectContaining({
        message: "Routed AniDB season identity",
        attributes: expect.objectContaining({
          requestedSeason: 1,
          baseShowId: "plain-show-700",
          routedShowId: "plain-show-700",
          numberingEvidence: "cour",
          numberingEvidenceReason: "absolute-episode-not-in-routed-catalog",
          episodeNumber: 1,
          usedAbsoluteEpisode: false,
        }),
      }),
    );
    expect(result.externalIds?.providerNativeIds?.anidb).toBe("plain-show-700");
  });

  test("propagates resolved malId into externalIds when not provided in input", async () => {
    clearAnidbCachesForTest();
    const result = await resolveWithStub(
      {
        title: { id: "onigiri-3942", kind: "anime", title: "Onigiri" },
        episode: { season: 1, episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      (async (input: unknown) => {
        const url = String(
          typeof input === "string" ? input : ((input as { url?: string })?.url ?? input),
        );
        if (url.includes("/anime/onigiri-3942")) {
          return new Response('<a href="https://myanimelist.net/anime/32612/Onigiri">MAL</a>', {
            status: 200,
          });
        }
        if (url.includes("/api/frontend/anime/3942/episodes")) {
          return new Response(JSON.stringify({ episodes: [{ id: 101, number: 1 }] }), {
            status: 200,
          });
        }
        if (/\/api\/frontend\/episode\/101\/languages/.test(url)) {
          return new Response(
            JSON.stringify({
              languages: [
                { code: "jpn", name: "Japanese", embed_url: "https://anidb.app/embed/jpn-1" },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/embed/")) {
          return new Response("file: 'https://cdn.example/stream.m3u8'", { status: 200 });
        }
        if (url.includes("stream.m3u8")) {
          return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p.m3u8", {
            status: 200,
          });
        }
        return new Response("", { status: 404 });
      }) as unknown as typeof fetch,
    );

    expect(result.status).toBe("resolved");
    expect(result.externalIds?.malId).toBe("32612");
    expect(result.externalIds?.providerNativeIds?.anidb).toBe("onigiri-3942");
  });

  test("preserves existing input malId over resolving new malId", async () => {
    clearAnidbCachesForTest();
    const result = await resolveWithStub(
      {
        title: {
          id: "onigiri-3942",
          kind: "anime",
          title: "Onigiri",
          externalIds: { malId: "99999" },
        },
        episode: { season: 1, episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      anidbFetchStub({
        episodesByNumericId: {
          "3942": [{ id: 101, number: 1 }],
        },
      }),
    );

    expect(result.status).toBe("resolved");
    expect(result.externalIds?.malId).toBe("99999");
  });

  test("does not fall back to Japanese when a requested dub is unavailable", async () => {
    const result = await resolveWithStub(
      {
        title: { id: "plain-show-700", kind: "anime", title: "Plain Show" },
        episode: { season: 1, episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "en",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      anidbFetchStub({ episodesByNumericId: { "700": [{ id: 70001, number: 1 }] } }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.message).toContain("No AniDB streams");
  });

  test("does not advertise hardcoded English subs without a subtitle track", async () => {
    const result = await resolveWithStub(
      {
        title: { id: "plain-show-700", kind: "anime", title: "Plain Show" },
        episode: { season: 1, episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      } as Parameters<typeof anidbProviderModule.resolve>[0],
      anidbFetchStub({ episodesByNumericId: { "700": [{ id: 70001, number: 1 }] } }),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved result");
    const stream = result.streams[0];
    expect(stream?.hardSubLanguage).toBeUndefined();
    expect(stream?.subtitleDelivery).toBeUndefined();
    expect(stream?.subtitleLanguages).toBeUndefined();
    expect(stream?.languageEvidence ?? []).not.toContainEqual(
      expect.objectContaining({ role: "hardsub" }),
    );
    expect(result.sources?.[0]?.languageEvidence ?? []).not.toContainEqual(
      expect.objectContaining({ role: "hardsub" }),
    );
    expect(result.subtitles).toEqual([]);
  });
});

describe("anidb episode metadata", () => {
  test("enriches episode titles, air dates, and thumbnails from existing catalog ids", async () => {
    clearAnidbCachesForTest();
    clearAnimeMetadataCacheForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/frontend/anime/700/episodes")) {
          return new Response(
            JSON.stringify({
              episodes: [
                { id: 70001, number: 1 },
                { id: 70002, number: 2 },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/anime/plain-show-700")) {
          return new Response(
            '<a href="https://myanimelist.net/anime/5678/Plain-Show">MAL</a>' +
              '<a href="https://anilist.co/anime/1234">AniList</a>' +
              '<a href="https://anidb.net/anime/9876">AniDB</a>' +
              '<meta property="og:image" content="https://img.example/poster.jpg">',
            { status: 200 },
          );
        }
        if (isOfficialAnidbApi(url)) {
          return new Response(
            `<?xml version="1.0"?>
              <anime id="9876">
                <episode id="1"><epno type="1">2</epno><airdate>2020-01-09</airdate>
                  <title xml:lang="en">Official Journey</title><summary>Official synopsis</summary>
                </episode>
                <episode id="2"><epno type="1">1</epno><airdate>2020-01-02</airdate>
                  <title xml:lang="ja">公式の始まり</title><title xml:lang="x-jat">The Beginning</title>
                </episode>
                <episode id="3"><epno type="2">1</epno><title xml:lang="en">Special</title></episode>
              </anime>`,
            { status: 200 },
          );
        }
        if (url.includes("graphql.anilist.co")) {
          return new Response(
            JSON.stringify({
              data: {
                Media: {
                  streamingEpisodes: [
                    { title: "The Beginning", thumbnail: "https://img.example/ep-1.jpg" },
                    { title: "The Journey", thumbnail: "https://img.example/ep-2.jpg" },
                  ],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("api.jikan.moe")) {
          return new Response(
            JSON.stringify({
              data: [
                { mal_id: 1, title: "The Beginning", aired: "2020-01-02T00:00:00+00:00" },
                { mal_id: 2, title: "The Journey", aired: "2020-01-09T00:00:00+00:00" },
              ],
              pagination: { has_next_page: false },
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;

      const episodes = await anidbProviderModule.listEpisodes?.(
        {
          title: {
            id: "plain-show-700",
            kind: "anime",
            title: "Plain Show",
          },
          preferredAudioLanguage: "ja",
        },
        { now: () => new Date().toISOString(), signal: new AbortController().signal },
      );

      expect(episodes?.[0]).toMatchObject({
        index: 1,
        name: "The Beginning",
        label: "Episode 1 · The Beginning",
        release: { airDate: "2020-01-02" },
        artwork: { thumbnailUrl: "https://img.example/ep-1.jpg" },
      });
      expect(episodes?.[1]).toMatchObject({
        index: 2,
        name: "Official Journey",
        label: "Episode 2 · Official Journey",
        release: { airDate: "2020-01-09" },
        artwork: { thumbnailUrl: "https://img.example/ep-2.jpg" },
        detail: "Official synopsis",
      });
      expect(episodes?.[0]?.externalIds).toEqual({ anilistId: "1234", malId: "5678" });
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
      clearAnidbCachesForTest();
      clearAnimeMetadataCacheForTest();
    }
  });
});

describe("fetchAnidbMalId", () => {
  test("extracts MAL id from anime page and caches result", async () => {
    clearAnidbCachesForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async (url: string) => {
        fetchCalls++;
        if (String(url).includes("/anime/onigiri-3942")) {
          return new Response(
            '<html><body><a href="https://myanimelist.net/anime/32612/Onigiri">MAL</a></body></html>',
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const first = await fetchAnidbMalId("onigiri-3942");
      expect(first).toBe(32612);
      expect(fetchCalls).toBe(1);

      // Second call hits TTL cache
      const second = await fetchAnidbMalId("onigiri-3942");
      expect(second).toBe(32612);
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("returns undefined on missing or invalid MAL URL", async () => {
    clearAnidbCachesForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async () =>
        new Response("<html><body>No links here</body></html>", {
          status: 200,
        })) as unknown as typeof fetch;

      expect(await fetchAnidbMalId("unknown-123")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("caches a genuine absence instead of re-scraping every resolve", async () => {
    // "No MAL link on the page" is an answer, not a miss. Representing it the
    // same way as a cache miss silently disables the cache for every show
    // without a MAL id, which is the population that gets scraped repeatedly.
    clearAnidbCachesForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response("<html><body>No links here</body></html>", { status: 200 });
      }) as unknown as typeof fetch;

      expect(await fetchAnidbMalId("no-mal-1")).toBeUndefined();
      expect(await fetchAnidbMalId("no-mal-1")).toBeUndefined();
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("does not cache a transport failure, so a retry can still succeed", async () => {
    // A Cloudflare block or dropped connection says nothing about the show.
    // Caching it would suppress auto-skip for the full hour-long TTL.
    clearAnidbCachesForTest();
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      globalThis.fetch = (async () => {
        fetchCalls++;
        if (fetchCalls === 1) throw new Error("connection reset");
        return new Response(
          '<html><body><a href="https://myanimelist.net/anime/32612/Onigiri">MAL</a></body></html>',
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      expect(await fetchAnidbMalId("flaky-1")).toBeUndefined();
      expect(await fetchAnidbMalId("flaky-1")).toBe(32612);
      expect(fetchCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});
