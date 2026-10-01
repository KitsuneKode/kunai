import { describe, expect, test } from "bun:test";

import type { LooseJsonValue, ProviderRuntimeContext } from "@kunai/types";

import {
  chooseHianimeSearchMatch,
  clearHianimeCachesForTest,
  cloudflareBlockMessage,
  decodeHianimeEmbedPage,
  deobfuscateHianimeEmbedBlob,
  obfuscateHianimeEmbedPayload,
  extractHianimeEmbedBlob,
  HianimeEmbedDecodeError,
  hianimeCurlFailureMessage,
  hianimeEmbedReferer,
  hianimeServerKind,
  hianimeUrlLabel,
  hianimeMalIdFromEmbedUrl,
  hianimeNumericId,
  hianimeProviderModule,
  looksLikeHianimeShowId,
  parseHianimeEpisodesHtml,
  parseHianimeSearchHtml,
  parseHianimeServersHtml,
  resolveHianimeEpisodeStreams,
  resolveHianimeShow,
  fetchHianimeEpisodeCatalog,
  hianimeFetchText,
  splitCurlHttpTrailer,
} from "../src/hianime/direct";
import { HIANIME_PROVIDER_ID, hianimeManifest } from "../src/hianime/manifest";

const NOW = "2026-09-13T00:00:00.000Z";

function jsonResponse(body: LooseJsonValue, status = 200): Response {
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
  poster: "https://hls2.aniwatchtv.uk/v/demo/sub/poster.jpg",
  sprite_vtt: "https://hls2.aniwatchtv.uk/v/demo/sub/sprite.vtt",
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

const MEGAPLAY_MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:4",
  "#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080",
  "1080/index.m3u8",
].join("\n");

/**
 * A megaplay.buzz player page. Real pages can carry two ids — `data-mediaid`
 * is the getSources key on dual-id deployments while `data-id` decrypts to
 * `{}`; both parse for the walk.
 */
function megaplayEmbedPage(dataId: string, mediaId?: string): string {
  const mediaAttr = mediaId === undefined ? "" : ` data-mediaid="${mediaId}"`;
  return `<!doctype html><html><body><div id="player" data-id="${dataId}"${mediaAttr}></div></body></html>`;
}

/**
 * Fixture encrypted with the same constants the embed ships: key
 * "i?LMTAx0Q6,:}50U" zero-padded to 32 bytes, iv "W0;27ToaUpl_P%'c".
 */
async function encryptMegaplayFixture(json: string): Promise<string> {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode("i?LMTAx0Q6,:}50U"));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
  ]);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode("W0;27ToaUpl_P%'c") },
    key,
    new TextEncoder().encode(json),
  );
  return Buffer.from(cipher).toString("base64url");
}

async function megaplaySourcesJson(masterUrl: string): Promise<LooseJsonValue> {
  return {
    enc: await encryptMegaplayFixture(JSON.stringify({ file: masterUrl })),
    tracks: [
      {
        file: "https://subs.example/eng-2.vtt",
        label: "English",
        kind: "captions",
        default: true,
      },
    ],
    intro: { start: 0, end: 83 },
    outro: { start: 1280, end: 1369 },
    server: 4,
  };
}

/** The live trap: decrypts fine but carries no playlist (wrong getSources id). */
async function megaplayEmptySourcesJson(): Promise<LooseJsonValue> {
  return { enc: await encryptMegaplayFixture("{}") };
}

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

function stubContext(
  router: (url: string) => Response | string | Promise<Response | string>,
): ProviderRuntimeContext {
  return {
    now: () => NOW,
    fetch: {
      runtime: "direct-http",
      fetch: async (input) => {
        const url = String(input);
        const answer = await router(url);
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

  test("reads anchors regardless of attribute order or quote style", () => {
    const html = [
      // title-first, single quotes, extra attributes: mirrors reorder freely.
      `<div class="film-detail"><h3 class="film-name"><a title='Naruto' data-x="1" href='/naruto-1335'>x</a></h3></div>`,
      `<div class="film-detail"><H3 CLASS="film-name"><A HREF="/one-piece-100" TITLE="One Piece">x</A></H3></div>`,
      // Missing title carries no usable result.
      '<div class="film-detail"><h3 class="film-name"><a href="/no-title-2">x</a></h3></div>',
    ].join("");
    expect(parseHianimeSearchHtml(html)).toEqual([
      { id: "naruto-1335", title: "Naruto" },
      { id: "one-piece-100", title: "One Piece" },
    ]);
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
    const badPayload = obfuscateHianimeEmbedPayload(JSON.stringify({ nope: true }));
    expect(() =>
      decodeHianimeEmbedPage(`<script>window.__P="${badPayload}"</script>`),
    ).toThrowError(new HianimeEmbedDecodeError("embed-json-shape-invalid"));
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
    // Embed poster + sprite VTT ride the standard artwork slot — the inventory
    // projection turns seekBarVttUrl into the "seek thumbnails" capability.
    for (const stream of result.streams) {
      expect(stream.artwork).toEqual({
        posterUrl: "https://hls2.aniwatchtv.uk/v/demo/sub/poster.jpg",
        thumbnailUrl: "https://hls2.aniwatchtv.uk/v/demo/sub/poster.jpg",
        seekBarVttUrl: "https://hls2.aniwatchtv.uk/v/demo/sub/sprite.vtt",
      });
    }
    expect(result.variants?.[0]?.artwork?.seekBarVttUrl).toBe(
      "https://hls2.aniwatchtv.uk/v/demo/sub/sprite.vtt",
    );
    expect(result.externalIds).toMatchObject({
      malId: "20",
      providerNativeIds: { [HIANIME_PROVIDER_ID]: "naruto-1335" },
    });
    const byId = new Map((result.sources ?? []).map((source) => [source.id, source]));
    expect(byId.get("source:hianime:sub:0")?.status).toBe("selected");
    // HD-1 is the second sub lane — offered but unprobed (`skipped` rows stay
    // switchable from the Tracks panel), same as the dub lane.
    expect(byId.get("source:hianime:sub:1")?.status).toBe("skipped");
    expect(byId.get("source:hianime:dub:0")?.status).toBe("skipped");
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

  /**
   * Router adding the HD-1 megaplay lane's fixture on top of the happy path.
   * `zokoanimeSubBroken` serves a 200 embed page with no `__P` blob — a
   * deterministic decode failure. Unstubbed getSources ids answer the empty
   * payload rather than throwing: stubbed fetch failures on these hosts do
   * not stay failed (hianimeFetchText falls through to real curl), but a
   * decrypt-to-`{}` payload fails inside the sandbox.
   */
  function megaplayRouter(
    url: string,
    options: {
      readonly zokoanimeSubBroken?: boolean;
      readonly pageIds?: { readonly dataId: string; readonly mediaId?: string };
      readonly sources?: Readonly<Record<string, () => Promise<LooseJsonValue>>>;
    } = {},
  ): Response | string | Promise<Response | string> {
    if (options.zokoanimeSubBroken && url.endsWith("/mal/20/1/sub")) {
      return "<!doctype html><html><body>no blob</body></html>";
    }
    const pageIds = options.pageIds ?? { dataId: "104103", mediaId: "104104" };
    if (url.endsWith("/s-2/12352/sub")) {
      return megaplayEmbedPage(pageIds.dataId, pageIds.mediaId);
    }
    const sourcesId = /[?&]id=(\d+)/.exec(url)?.[1];
    if (url.includes("/stream/getSources") && sourcesId) {
      const source =
        options.sources?.[sourcesId] ??
        (sourcesId === "104104"
          ? () => megaplaySourcesJson("https://megap.norami.top/anime/mega/master.m3u8")
          : megaplayEmptySourcesJson);
      return source().then((body) => jsonResponse(body));
    }
    if (url.endsWith("/anime/mega/master.m3u8")) return MEGAPLAY_MASTER;
    return happyRouter(url);
  }

  test("falls through a dead ZokoAnime lane to the HD-1 megaplay lane", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => megaplayRouter(url, { zokoanimeSubBroken: true })),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.serverName).toBe("HD-1");
    expect(selected?.sourceId).toBe("source:hianime:sub:1");
    expect(selected?.url).toBe("https://megap.norami.top/anime/mega/1080/index.m3u8");
    expect(selected?.headers).toMatchObject({ Referer: "https://megaplay.buzz/" });
    // The megaplay getSources payload carries its own subs and skip data.
    expect(selected?.metadata).toMatchObject({
      intro: { start: 0, end: 83 },
      outro: { start: 1280, end: 1369 },
    });
    expect(result.subtitles[0]).toMatchObject({ label: "English", format: "vtt" });
    // The inventory names the dead lane's row, not just the survivor's.
    const byId = new Map((result.sources ?? []).map((source) => [source.id, source]));
    expect(byId.get("source:hianime:sub:0")?.label).toContain("ZokoAnime");
    expect(byId.get("source:hianime:sub:1")?.status).toBe("selected");
  });

  test("a pinned lane source id resolves only that megaplay lane", async () => {
    clearHianimeCachesForTest();
    const fetched: string[] = [];
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredSourceId: "source:hianime:sub:1",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        fetched.push(url);
        return megaplayRouter(url);
      }),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    // The pin skips the ZokoAnime embed entirely — no fetch of its URL.
    expect(fetched.some((url) => url.includes("zokoanime.video"))).toBe(false);
    expect(fetched.some((url) => url.includes("/s-2/12352/sub"))).toBe(true);
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.serverName).toBe("HD-1");
    expect(selected?.sourceId).toBe("source:hianime:sub:1");
  });

  test("a getSources id that decrypts empty falls through to the next advertised id", async () => {
    clearHianimeCachesForTest();
    const fetched: string[] = [];
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredSourceId: "source:hianime:sub:1",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        fetched.push(url);
        // Page carries a bogus mediaid alongside the working data-id: the
        // walk tries mediaid first (decrypts to `{}`), then data-id (real).
        return megaplayRouter(url, { pageIds: { dataId: "104104", mediaId: "999" } });
      }),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(
      fetched
        .filter((url) => url.includes("/stream/getSources"))
        .map((url) => /[?&]id=(\d+)/.exec(url)?.[1]),
    ).toEqual(["999", "104104"]);
  });

  test("a legacy mode-only pin still resolves the lead lane", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredSourceId: "source:hianime:sub",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext(megaplayRouter),
    );

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.serverName).toBe("ZokoAnime");
    expect(selected?.sourceId).toBe("source:hianime:sub:0");
  });

  test("classifies embed hosts and server names into lane kinds", () => {
    const lane = (serverName: string, embedUrl: string) =>
      hianimeServerKind({ serverName, embedUrl, audioMode: "sub" });
    expect(lane("ZokoAnime", "https://zokoanime.video/stream/mal/20/1/sub")).toBe("zokoanime");
    // Megaplay embeds classify by host — the exact server name does not matter.
    expect(lane("HD-1", "https://megaplay.buzz/stream/s-2/12352/sub")).toBe("megaplay");
    expect(lane("Vidstream-2", "https://megaplay.buzz/stream/s-2/12352/sub")).toBe("megaplay");
    expect(lane("Whatever", "https://megaplay.buzz/stream/x/1/sub")).toBe("megaplay");
    // TLD rotation on either family still resolves its contract.
    expect(lane("ZokoAnime", "https://zokoanime.io/stream/mal/20/1/sub")).toBe("zokoanime");
    expect(lane("HD-1", "https://megaplay.mom/stream/s-2/12352/sub")).toBe("megaplay");
    // Name fallback covers a domain the host list has not caught yet.
    expect(lane("HD-1", "https://newhost.example/stream/x/1/sub")).toBe("megaplay");
    // vidtube.site (VidPlay-1) is a different player page — unsupported.
    expect(lane("VidPlay-1", "https://vidtube.site/stream/token/sub")).toBeNull();
    expect(lane("Mystery", "https://unknown.example/x")).toBeNull();
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

  test("a 503 ladder fetch fails provider-unavailable instead of attesting a dead auto stream", async () => {
    clearHianimeCachesForTest();
    // hls.aniwatch.al broke its TLS chain / served errors while the embed page
    // still resolved: the old ladder swallowed the failure into a fake "auto"
    // row and the stream died in mpv instead of failing the candidate.
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        if (url.endsWith("master.m3u8")) {
          return new Response("Under Maintenance", { status: 503 });
        }
        return happyRouter(url);
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({
      code: "provider-unavailable",
      retryable: true,
    });
  });

  test("a thrown transport error in the ladder keeps its classification", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        if (url.endsWith("master.m3u8")) {
          return new Response("gone", { status: 404 });
        }
        return happyRouter(url);
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({ code: "not-found", retryable: false });
  });

  test("flags a collapsed ladder in the trace", async () => {
    clearHianimeCachesForTest();
    const result = await hianimeProviderModule.resolve(
      {
        title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
        episode: { episode: 1 },
        mediaKind: "anime",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      stubContext((url) => {
        if (url.endsWith("master.m3u8")) return "this is not a playlist";
        return happyRouter(url);
      }),
    );
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.streams.map((stream) => stream.qualityLabel)).toEqual(["auto"]);
    expect(result.trace.events?.map((event) => event.type)).toContain("ladder:fallback");
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

  test("curl failure names the failed URL without leaking its query", () => {
    // A /search URL carries the user's title query — errors land in logs.txt,
    // so the label keeps origin + pathname only (upstream #1902 names the URL).
    expect(
      hianimeCurlFailureMessage("", "", 7, "https://hianime.at/search?keyword=oni%20girls&type=1"),
    ).toBe(
      "hianime fetch connection error (no HTTP response; curl exit 7) from https://hianime.at/search",
    );
  });

  test("cloudflare advice depends on the binary that ran", () => {
    expect(cloudflareBlockMessage(false)).toBe(
      "hianime blocked by Cloudflare (try curl-impersonate)",
    );
    expect(cloudflareBlockMessage(true)).toBe(
      "hianime blocked by Cloudflare (curl-impersonate was already used; retry later or from another network)",
    );
  });

  test("url labels drop queries and survive malformed input", () => {
    expect(hianimeUrlLabel("https://hianime.at/ajax/search?q=x&page=2")).toBe(
      "https://hianime.at/ajax/search",
    );
    expect(hianimeUrlLabel("not a url")).toBe("not a url");
  });
});

describe("hianime http failures", () => {
  const httpStatus = (status: number) => async () => new Response(`error ${status}`, { status });

  async function withoutCurl<T>(
    fetchImpl: () => Promise<Response>,
    run: () => Promise<T>,
  ): Promise<T> {
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
      globalThis.fetch = fetchImpl as unknown as typeof fetch;
      return await run();
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  }

  test("maps 404/410 to not-found at the stream layer", async () => {
    const resolution = await withoutCurl(httpStatus(404), () =>
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      resolveHianimeEpisodeStreams({
        context: { now: () => NOW },
        episodeId: "22676",
        requestedMode: "sub",
      } as never),
    );
    expect(resolution.requested.status).toBe("failed");
    if (resolution.requested.status !== "failed") throw new Error("expected failed");
    expect(resolution.requested.failure).toMatchObject({ code: "not-found" });
  });

  test("catalog 404 exhausts as non-retryable not-found", async () => {
    clearHianimeCachesForTest();
    const result = await withoutCurl(httpStatus(410), () =>
      hianimeProviderModule.resolve(
        {
          title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
          episode: { episode: 1 },
          mediaKind: "anime",
          intent: "play",
          allowedRuntimes: ["direct-http"],
        },
        { now: () => NOW },
      ),
    );
    expect(result.status).toBe("exhausted");
    if (result.status !== "exhausted") throw new Error("expected exhausted");
    expect(result.failures[0]).toMatchObject({ code: "not-found", retryable: false });
  });

  test("embed 404 stays non-retryable through the failed branch", async () => {
    clearHianimeCachesForTest();
    const result = await withoutCurl(httpStatus(404), () =>
      hianimeProviderModule.resolve(
        {
          title: { id: "naruto-1335", kind: "anime", title: "Naruto" },
          episode: { episode: 1 },
          mediaKind: "anime",
          intent: "play",
          allowedRuntimes: ["direct-http"],
        },
        stubContext((url) => {
          if (url.includes("/api/theme/episode/list/")) {
            return jsonResponse({ status: true, totalItems: 1, html: EPISODES_HTML });
          }
          if (url.includes("/api/theme/episode/servers")) {
            return jsonResponse({ status: true, html: SERVERS_HTML });
          }
          return new Response("gone", { status: 404 });
        }),
      ),
    );
    expect(result.status).toBe("exhausted");
    if (result.status !== "exhausted") throw new Error("expected exhausted");
    expect(result.failures[0]).toMatchObject({ code: "not-found", retryable: false });
  });

  test("search returns null on http errors without curl", async () => {
    const search = hianimeProviderModule.search;
    if (!search) throw new Error("expected search");
    const failed = await withoutCurl(
      async () => new Response("err", { status: 500 }),
      () => search({ query: "naruto" }, { now: () => NOW }),
    );
    expect(failed).toBeNull();
  });

  test("episode catalog honors the persistent cache without network", async () => {
    clearHianimeCachesForTest();
    const cached = [{ episodeId: "99001", number: 1, title: "Cached Premiere" }];
    let writes = 0;
    const context = {
      ...stubContext(() => {
        throw new Error("network must not be touched on a persistent hit");
      }),
      cache: {
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- unknown hop required: cast target is an unresolved generic
        read: async <T>(): Promise<T | null> => [...cached] as unknown as T,
        write: async (): Promise<void> => {
          writes += 1;
        },
      },
    };
    const entries = await fetchHianimeEpisodeCatalog("cached-show-99", undefined, context);
    expect(entries).toEqual(cached);
    expect(writes).toBe(0);
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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        Bun.which = ((_cmd: string) => null) as typeof Bun.which;
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
        globalThis.fetch = (async () => {
          throw new Error("boom");
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
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

  test("caches title-query show slugs across resolves", async () => {
    clearHianimeCachesForTest();
    let searchHits = 0;
    const context = stubContext((url) => {
      if (url.includes("/search?")) {
        searchHits += 1;
        return '<div class="film-detail"><h3 class="film-name"><a href="/naruto-1335" title="Naruto">x</a></h3></div>';
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const input = { title: { id: "anilist:20", kind: "anime" as const, title: "Naruto" } };
    expect(await resolveHianimeShow(input, undefined, context)).toMatchObject({
      id: "naruto-1335",
    });
    expect(await resolveHianimeShow(input, undefined, context)).toMatchObject({
      id: "naruto-1335",
    });
    expect(searchHits).toBe(1);
  });
});

describe("hianime relay routing (#460)", () => {
  test("a relayed response is final — the client must not re-ask upstream direct", async () => {
    // Without the marker check, a relayed 403 fell through to a direct
    // fetch/curl — silently bypassing the relay a geo-gated user deployed.
    const context = {
      now: () => NOW,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async () =>
          new Response("upstream says no", {
            status: 403,
            headers: { "X-Kunai-Relayed": "1" },
          }),
      },
    } satisfies ProviderRuntimeContext;

    // If the code falls through anyway it reaches plain fetch next; make that
    // path a loud sentinel instead of a real network call. Bun.which = null
    // keeps resolveCurlCandidate() empty so fetch is the only fallback.
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    Bun.which = (() => null) as typeof Bun.which;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async () => {
      throw new Error("SENTINEL: direct upstream request happened");
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    }) as unknown as typeof fetch;
    try {
      const thrown = await hianimeFetchText("https://hianime.at/search?keyword=x", {
        context,
      }).then(
        () => null,
        (error) => (error instanceof Error ? error.message : String(error)),
      );
      expect(thrown).toContain("via relay");
      expect(thrown).not.toContain("SENTINEL");
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("a relayed Cloudflare challenge reports the block instead of bypassing", async () => {
    const context = {
      now: () => NOW,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async () =>
          new Response("<html>Just a moment...</html>", {
            headers: { "X-Kunai-Relayed": "1" },
          }),
      },
    } satisfies ProviderRuntimeContext;

    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    Bun.which = (() => null) as typeof Bun.which;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async () => {
      throw new Error("SENTINEL: direct upstream request happened");
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    }) as unknown as typeof fetch;
    try {
      const thrown = await hianimeFetchText("https://hianime.at/search?keyword=x", {
        context,
      }).then(
        () => null,
        (error) => (error instanceof Error ? error.message : String(error)),
      );
      expect(thrown).toContain("Cloudflare");
      expect(thrown).not.toContain("SENTINEL");
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("an unmarked response still falls through to the local transport", async () => {
    // Relay off / relay-unchecked: the direct-port response may legitimately
    // fall through to local curl (or plain fetch) — that bypass is the whole
    // point of the non-relay path.
    const context = {
      now: () => NOW,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async () => new Response("nope", { status: 403 }),
      },
    } satisfies ProviderRuntimeContext;

    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    Bun.which = (() => null) as typeof Bun.which;
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    globalThis.fetch = (async () => new Response("direct answer")) as unknown as typeof fetch;
    try {
      const text = await hianimeFetchText("https://hianime.at/search?keyword=x", { context });
      expect(text).toBe("direct answer");
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});
