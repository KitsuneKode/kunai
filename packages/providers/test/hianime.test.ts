import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  chooseHianimeSearchMatch,
  clearHianimeCachesForTest,
  decodeHianimeEmbedPage,
  deobfuscateHianimeEmbedBlob,
  obfuscateHianimeEmbedPayload,
  extractHianimeEmbedBlob,
  HianimeEmbedDecodeError,
  hianimeCurlFailureMessage,
  hianimeEmbedReferer,
  hianimeMalIdFromEmbedUrl,
  hianimeNumericId,
  hianimeProviderModule,
  looksLikeHianimeShowId,
  parseHianimeEpisodesHtml,
  parseHianimeSearchHtml,
  parseHianimeServersHtml,
  splitCurlHttpTrailer,
} from "../src/hianime/direct";
import { HIANIME_PROVIDER_ID, hianimeManifest } from "../src/hianime/manifest";

const NOW = "2026-09-13T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function embedPage(payload: Record<string, unknown>): string {
  const blob = obfuscateHianimeEmbedPayload(JSON.stringify(payload));
  return `<!doctype html><html><body><script>window.__P="${blob}"</script></body></html>`;
}

const SUB_PAYLOAD = {
  src: "https://hls2.aniwatchtv.uk/v/demo/sub/master.m3u8",
  subtitles: [
    {
      lang: "en",
      label: "English",
      default: true,
      src: "https://hls2.aniwatchtv.uk/v/demo/sub/subs/en.vtt",
    },
  ],
  skip: { intro: null, outro: { start: 1280, end: 1369 } },
  download_url: "/download/mal/20/1/sub",
};

const DUB_PAYLOAD = {
  src: "https://hls2.aniwatchtv.uk/v/demo/dub/master.m3u8",
  subtitles: [
    {
      lang: "en",
      label: "English",
      default: true,
      src: "https://hls2.aniwatchtv.uk/v/demo/dub/subs/en.vtt",
    },
  ],
  skip: { intro: { start: 10, end: 90 }, outro: null },
  download_url: "/download/mal/20/1/dub",
};

const MASTER_TWO_VARIANT = [
  "#EXTM3U",
  "#EXT-X-VERSION:4",
  "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360",
  "360/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080",
  "1080/index.m3u8",
].join("\n");

const EPISODES_HTML = [
  '<a title="Episode 1" class="ssl-item ep-item" data-number="1" data-id="22676" href="https://hianime.at/watch/naruto-1335?ep=22676">',
  '<div class="ep-name dynamic-name" data-jname="Enter: Naruto Uzumaki!" title="Enter: Naruto Uzumaki!">Enter</div></a>',
  '<a title="Episode 2" class="ssl-item ep-item" data-number="2" data-id="22677" href="https://hianime.at/watch/naruto-1335?ep=22677">',
  '<div class="ep-name dynamic-name" data-jname="I&#039;m used to it" title="ep2">Ep 2</div></a>',
].join("");

const SERVERS_HTML = [
  '<div class="item server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="aHR0cHM6Ly96b2tvYW5pbWUudmlkZW8vc3RyZWFtL21hbC8yMC8xL3N1Yg==">',
  '<div class="item server-item" data-type="sub" data-server-name="HD-1" data-hash="aHR0cHM6Ly9tZWdhcGxheS5idXp6L3N0cmVhbS9zLTIvMTIzNTIvc3Vi">',
  '<div class="item server-item" data-type="dub" data-server-name="ZokoAnime" data-hash="aHR0cHM6Ly96b2tvYW5pbWUudmlkZW8vc3RyZWFtL21hbC8yMC8xL2R1Yg==">',
  '<div class="item server-item" data-type="dub" data-server-name="VidPlay-1" data-hash="aHR0cHM6Ly92aWR0dWJlLnNpdGUvc3RyZWFtL3Rva2VuL2R1Yg==">',
].join("");

function stubContext(router: (url: string) => Response | string): ProviderRuntimeContext {
  return {
    now: () => NOW,
    fetch: {
      runtime: "direct-http",
      fetch: async (input) => {
        const url = String(input);
        const answer = router(url);
        return typeof answer === "string" ? new Response(answer) : answer;
      },
    },
  };
}

/** Full happy-path router: catalog + servers + embeds + masters. */
function happyRouter(url: string): Response | string {
  if (url.includes("/api/theme/episode/list/")) {
    return jsonResponse({ status: true, totalItems: 1, html: EPISODES_HTML });
  }
  if (url.includes("/api/theme/episode/servers")) {
    return jsonResponse({ status: true, html: SERVERS_HTML });
  }
  if (url.endsWith("/mal/20/1/sub")) return embedPage(SUB_PAYLOAD);
  if (url.endsWith("/mal/20/1/dub")) return embedPage(DUB_PAYLOAD);
  if (url.endsWith("master.m3u8")) return MASTER_TWO_VARIANT;
  throw new Error(`unexpected fetch: ${url}`);
}

describe("hianime id helpers", () => {
  test("accepts slug-numeric show ids", () => {
    expect(looksLikeHianimeShowId("naruto-1335")).toBe(true);
    expect(looksLikeHianimeShowId("solo-leveling-season-2-arise-from-the-shadow-84")).toBe(true);
    expect(looksLikeHianimeShowId("anilist:21")).toBe(false);
    expect(looksLikeHianimeShowId("1335")).toBe(false);
    expect(looksLikeHianimeShowId("bad-0")).toBe(false);
  });

  test("extracts trailing numeric id", () => {
    expect(hianimeNumericId("naruto-1335")).toBe(1335);
    expect(hianimeNumericId("nope")).toBeNull();
    expect(hianimeNumericId("bad-0")).toBeNull();
  });
});

describe("hianime manifest", () => {
  test("is anime-only with search + episode-list + resolve", () => {
    expect(HIANIME_PROVIDER_ID).toBe("hianime");
    expect(hianimeManifest.mediaKinds).toEqual(["anime"]);
    expect(hianimeManifest.catalogIdentity).toBe("provider-native");
    for (const capability of ["search", "episode-list", "source-resolve"] as const) {
      expect(hianimeManifest.capabilities).toContain(capability);
    }
    expect(typeof hianimeProviderModule.search).toBe("function");
    expect(typeof hianimeProviderModule.listEpisodes).toBe("function");
    expect(typeof hianimeProviderModule.resolve).toBe("function");
  });
});

describe("hianime search parsing", () => {
  test("cuts the sidebar, dedupes, and decodes entities", () => {
    const html = [
      '<div class="film-detail"><h3 class="film-name"><a href="https://hianime.at/naruto-1335" title="Naruto">x</a></h3></div>',
      '<div class="film-detail"><h3 class="film-name"><a href="/dont-toy-with-me-miss-nagatoro-546" title="Don&#039;t Toy with Me, Miss Nagatoro">x</a></h3></div>',
      '<div class="film-detail"><h3 class="film-name"><a href="/naruto-1335" title="Naruto">dupe</a></h3></div>',
      '<div id="main-sidebar"><div class="film-detail"><h3 class="film-name"><a href="/sidebar-bait-1" title="Bait">x</a></h3></div></div>',
    ].join("");
    expect(parseHianimeSearchHtml(html)).toEqual([
      { id: "naruto-1335", title: "Naruto" },
      { id: "dont-toy-with-me-miss-nagatoro-546", title: "Don't Toy with Me, Miss Nagatoro" },
    ]);
  });

  test("strips control characters from search titles", () => {
    const html = [
      '<div class="film-detail"><h3 class="film-name"><a href="/ctrl-99" title="FooBar&#27;Baz">x</a></h3></div>',
    ].join("");
    const [entry] = parseHianimeSearchHtml(html);
    expect(entry?.id).toBe("ctrl-99");
    // No C0/C1 bytes may survive into terminal-bound text (asserted via
    // code points: a control-character regex class is itself forbidden here).
    const codes = [...(entry?.title ?? "")].map((c) => c.codePointAt(0) ?? 0);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((cp) => cp >= 0x20 && !(cp >= 0x7f && cp <= 0x9f))).toBe(true);
    expect(entry?.title).toContain("FooBar");
  });

  test("matches exact, then prefix, then first", () => {
    const results = [
      { id: "boruto-naruto-next-generations-650", title: "Boruto: Naruto Next Generations" },
      { id: "naruto-1335", title: "Naruto" },
    ];
    expect(chooseHianimeSearchMatch("naruto", results)?.id).toBe("naruto-1335");
    expect(chooseHianimeSearchMatch("boruto", results)?.id).toBe(
      "boruto-naruto-next-generations-650",
    );
    expect(chooseHianimeSearchMatch("something else", results)?.id).toBe(
      "boruto-naruto-next-generations-650",
    );
    expect(chooseHianimeSearchMatch("naruto", [])).toBeNull();
  });
});

describe("hianime episode parsing", () => {
  test("reads number, episodeId, and entity-decoded titles with slug guard", () => {
    const entries = parseHianimeEpisodesHtml(EPISODES_HTML, "naruto-1335");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ episodeId: "22676", number: 1 });
    expect(entries[0]?.title).toContain("Naruto Uzumaki");
    expect(entries[1]).toMatchObject({ episodeId: "22677", number: 2 });
    expect(entries[1]?.title).toBe("I'm used to it");
  });

  test("reads the first ep-name title and ignores other divs", () => {
    const html = [
      '<a class="ssl-item ep-item" data-number="1" data-id="11" href="https://hianime.at/watch/show-9?ep=11">',
      '<div class="other" title="Wrong">x</div>',
      '<div class="ep-name" title="Right">x</div></a>',
    ].join("");
    expect(parseHianimeEpisodesHtml(html, "show-9")).toMatchObject([{ title: "Right" }]);
  });

  test("drops rows from a foreign slug and rows without episodeId", () => {
    const html = [
      '<a class="ssl-item ep-item" data-number="1" data-id="11" href="https://hianime.at/watch/other-9?ep=11">x</a>',
      '<a class="ssl-item ep-item" data-number="3" href="https://hianime.at/watch/naruto-1335?ep=">x</a>',
      '<a class="ssl-item ep-item" data-number="4" data-id="14" href="https://hianime.at/watch/naruto-1335?ep=14">x</a>',
    ].join("");
    expect(parseHianimeEpisodesHtml(html, "naruto-1335").map((entry) => entry.episodeId)).toEqual([
      "14",
    ]);
  });
});

describe("hianime servers parsing", () => {
  test("matches server-item as an exact class token", () => {
    const html = [
      '<div class="item not-server-item" data-type="sub" data-server-name="Fake" data-hash="aHR0cHM6Ly9leGFtcGxlLmNvbS94">',
      '<div class="item server-item active" data-type="sub" data-server-name="ZokoAnime" data-hash="aHR0cHM6Ly96b2tvYW5pbWUudmlkZW8vc3RyZWFtL21hbC8yMC8xL3N1Yg==">',
    ].join("");
    expect(parseHianimeServersHtml(html)).toEqual([
      {
        audioMode: "sub",
        serverName: "ZokoAnime",
        embedUrl: "https://zokoanime.video/stream/mal/20/1/sub",
      },
    ]);
  });
  test("builds the sub/dub matrix and drops undecodable hashes", () => {
    const html = `${SERVERS_HTML}<div class="item server-item" data-type="sub" data-server-name="Broken" data-hash="!!!">`;
    const entries = parseHianimeServersHtml(html);
    expect(entries).toEqual([
      {
        audioMode: "sub",
        serverName: "ZokoAnime",
        embedUrl: "https://zokoanime.video/stream/mal/20/1/sub",
      },
      {
        audioMode: "sub",
        serverName: "HD-1",
        embedUrl: "https://megaplay.buzz/stream/s-2/12352/sub",
      },
      {
        audioMode: "dub",
        serverName: "ZokoAnime",
        embedUrl: "https://zokoanime.video/stream/mal/20/1/dub",
      },
      {
        audioMode: "dub",
        serverName: "VidPlay-1",
        embedUrl: "https://vidtube.site/stream/token/dub",
      },
    ]);
  });
});

describe("hianime embed decoding", () => {
  test("round-trips the XOR obfuscation and parses the payload", () => {
    const page = embedPage(SUB_PAYLOAD);
    const blob = extractHianimeEmbedBlob(page);
    expect(blob).toBeTruthy();
    expect(JSON.parse(deobfuscateHianimeEmbedBlob(blob ?? ""))).toMatchObject({
      src: SUB_PAYLOAD.src,
    });
    const { default: _ignored, ...subTrack } = SUB_PAYLOAD.subtitles[0] as Record<string, unknown>;
    expect(decodeHianimeEmbedPage(page)).toMatchObject({
      src: SUB_PAYLOAD.src,
      subtitles: [{ ...subTrack, isDefault: true }],
      outro: { start: 1280, end: 1369 },
      downloadUrl: "/download/mal/20/1/sub",
    });
  });

  test("stage-codes every failure", () => {
    expect(() => decodeHianimeEmbedPage("<html>no blob</html>")).toThrowError(
      new HianimeEmbedDecodeError("embed-blob-missing"),
    );
    expect(() => decodeHianimeEmbedPage('<script>window.__P="***"</script>')).toThrowError(
      new HianimeEmbedDecodeError("embed-base64-invalid"),
    );
    const badJson = obfuscateHianimeEmbedPayload("{oops");
    expect(() => decodeHianimeEmbedPage(`<script>window.__P="${badJson}"</script>`)).toThrowError(
      new HianimeEmbedDecodeError("embed-json-syntax-invalid"),
    );
    const badShape = obfuscateHianimeEmbedPayload(JSON.stringify({ nope: true }));
    expect(() => decodeHianimeEmbedPage(`<script>window.__P="${badShape}"</script>`)).toThrowError(
      new HianimeEmbedDecodeError("embed-json-shape-invalid"),
    );
  });

  test("reads MAL id and referer from the embed URL", () => {
    expect(hianimeMalIdFromEmbedUrl("https://zokoanime.video/stream/mal/20/1/sub")).toBe("20");
    expect(hianimeMalIdFromEmbedUrl("https://zokoanime.video/stream/other/1/sub")).toBeUndefined();
    expect(hianimeEmbedReferer("https://zokoanime.video/stream/mal/20/1/sub")).toBe(
      "https://zokoanime.video/",
    );
  });
});

describe("hianime module resolve", () => {
  test("resolves sub with ladder, subtitles, timing, and dual-mode inventory", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext(happyRouter),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.streams.map((stream) => stream.qualityLabel)).toEqual(["1080p", "360p"]);
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected).toMatchObject({
      qualityLabel: "1080p",
      protocol: "hls",
      container: "m3u8",
      presentation: "sub",
      audioLanguages: ["ja"],
      headers: expect.objectContaining({ Referer: "https://zokoanime.video/" }),
    });
    expect(selected?.url).toBe("https://hls2.aniwatchtv.uk/v/demo/sub/1080/index.m3u8");
    expect(selected?.metadata).toMatchObject({ outro: { start: 1280, end: 1369 } });
    expect(result.subtitles).toHaveLength(1);
    expect(result.subtitles[0]).toMatchObject({
      language: "en",
      format: "vtt",
      source: "provider",
    });
    expect(result.externalIds).toMatchObject({
      malId: "20",
      providerNativeIds: { [HIANIME_PROVIDER_ID]: "naruto-1335" },
    });
    const byId = new Map((result.sources ?? []).map((source) => [source.id, source]));
    expect(byId.get("source:hianime:sub")?.status).toBe("selected");
    // The dub row is confirmed by the servers listing but unprobed: `skipped`
    // rows stay switchable (manual re-resolve) from the Tracks panel.
    expect(byId.get("source:hianime:dub")?.status).toBe("skipped");
    expect(result.trace.events?.map((event) => event.type)).toEqual(
      expect.arrayContaining(["inventory:audio-modes", "source:success", "provider:success"]),
    );
  });

  test("resolves dub through its own embed", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "en",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext(happyRouter),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.presentation).toBe("dub");
    expect(selected?.audioLanguages).toEqual(["en"]);
    expect(selected?.url).toBe("https://hls2.aniwatchtv.uk/v/demo/dub/1080/index.m3u8");
    expect(selected?.metadata).toMatchObject({ intro: { start: 10, end: 90 } });
  });

  test("honors an explicit quality preference over ladder order", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        qualityPreference: "360p",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext(happyRouter),
    );
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.qualityLabel).toBe("360p");
    expect(selected?.url).toBe("https://hls2.aniwatchtv.uk/v/demo/sub/360/index.m3u8");
  });

  test("fails closed on unknown episodes and stale episode identities", async () => {
    clearHianimeCachesForTest();
    const context = stubContext(happyRouter);
    const missing = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 999 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      context,
    );
    expect(missing.status).toBe("exhausted");
    expect(missing.failures[0]).toMatchObject({ code: "not-found", retryable: false });

    const stale = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: {
          episode: 1,
          providerEpisodeIdentity: { providerId: HIANIME_PROVIDER_ID, value: "00000" },
        },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      context,
    );
    expect(stale.status).toBe("exhausted");
    expect(stale.failures[0]?.message).toContain("no longer in the catalog");
  });

  test("reports a missing dub mode instead of silently swapping audio", async () => {
    clearHianimeCachesForTest();
    const subOnlyServers = SERVERS_HTML.split('<div class="item server-item" data-type="dub"')[0];
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "dub",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        if (url.includes("/api/theme/episode/servers")) {
          return jsonResponse({ status: true, html: subOnlyServers });
        }
        return happyRouter(url);
      }),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({ code: "not-found", retryable: false });
    expect(result.failures[0]?.message).toContain("dub");
  });

  test("rejects non-anime titles", async () => {
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "438631", kind: "movie", title: "Dune" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext(happyRouter),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({ code: "unsupported-title" });
  });
});

describe("hianime curl http trailer", () => {
  test("splits the status trailer from the body", () => {
    expect(splitCurlHttpTrailer("hello\n200")).toEqual({ body: "hello", httpCode: 200 });
    expect(splitCurlHttpTrailer("")).toEqual({ body: "", httpCode: null });
    expect(splitCurlHttpTrailer("no trailer here")).toEqual({
      body: "no trailer here",
      httpCode: null,
    });
    // Only one trailer line is ever cut: a body that naturally ends in
    // digits keeps its bytes.
    expect(splitCurlHttpTrailer("ends in 200\n404")).toEqual({
      body: "ends in 200",
      httpCode: 404,
    });
    // curl prints `000` when no HTTP response arrived: missing status, not
    // status zero (verified: connection-refused stdout is exactly "\n000").
    expect(splitCurlHttpTrailer("\n000")).toEqual({ body: "", httpCode: null });
    expect(splitCurlHttpTrailer("partial\n000")).toEqual({ body: "partial", httpCode: null });
  });

  test("curl failure names the transport layer before the HTTP layer", () => {
    // ani-cli 5.1.2 parity: "no HTTP response" (DNS/TCP/TLS) vs "HTTP NNN".
    expect(hianimeCurlFailureMessage("", "", 7)).toBe(
      "hianime fetch connection error (no HTTP response; curl exit 7)",
    );
    expect(hianimeCurlFailureMessage("\n000", "", 7)).toBe(
      "hianime fetch connection error (no HTTP response; curl exit 7)",
    );
    expect(hianimeCurlFailureMessage("partial page\n403", "", 18)).toBe(
      "hianime fetch connection error (HTTP 403; curl exit 18)",
    );
    expect(hianimeCurlFailureMessage("", "gnutls handshake failed", 35)).toBe(
      "hianime fetch connection error (no HTTP response; curl exit 35): gnutls handshake failed",
    );
  });
});

describe("hianime module search and episodes", () => {
  test("search maps slugs and returns null on transport failure", async () => {
    const ok = await hianimeProviderModule.search?.(
      { query: "naruto" },
      stubContext((url) => {
        if (url.includes("/search?")) {
          return '<div class="film-detail"><h3 class="film-name"><a href="/naruto-1335" title="Naruto">x</a></h3></div>';
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    expect(ok?.[0]).toMatchObject({
      id: "naruto-1335",
      type: "series",
      title: "Naruto",
      externalIds: { providerNativeIds: { [HIANIME_PROVIDER_ID]: "naruto-1335" } },
    });

    const failed = await (async () => {
      // No fetch port and no curl: the client must surface transport failure
      // without touching the live network (mirrors the anidb search seams).
      const originalWhich = Bun.which;
      const originalFetch = globalThis.fetch;
      try {
        Bun.which = ((_cmd: string) => null) as typeof Bun.which;
        globalThis.fetch = (async () => {
          throw new Error("boom");
        }) as unknown as typeof fetch;
        return await hianimeProviderModule.search?.({ query: "naruto" }, { now: () => NOW });
      } finally {
        globalThis.fetch = originalFetch;
        Bun.which = originalWhich;
      }
    })();
    expect(failed).toBeNull();
  });

  test("listEpisodes carries provider episode identity", async () => {
    clearHianimeCachesForTest();
    const options = await hianimeProviderModule.listEpisodes?.(
      { title: { id: "naruto-1335", kind: "anime", title: "Naruto" } },
      stubContext(happyRouter),
    );
    expect(options).toHaveLength(2);
    expect(options?.[0]).toMatchObject({
      index: 1,
      totalEpisodeCount: 2,
      providerEpisodeIdentity: { providerId: HIANIME_PROVIDER_ID, value: "22676" },
    });
    expect(options?.[0]?.label).toContain("Episode 1");
  });
});
