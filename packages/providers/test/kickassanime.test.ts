import { afterEach, describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  __testing,
  discoverKaaBase,
  kaaStreamHeaders,
  kickassanimeProviderModule,
  matchKaaShow,
  resolveKaaSlug,
  selectKaaAudio,
} from "../src/kickassanime/direct";
import {
  decodeAstroProp,
  kaaEpisodeNumbers,
  kaaPageForEpisode,
  parseKaaEpisodePage,
  parseKaaPlayerPage,
  parseKaaSearchResults,
  parseKaaServers,
} from "../src/kickassanime/site";
import { parseHlsMasterAudioRenditions } from "../src/shared/hls-ladder";

/** Trimmed from POST https://kaa.lt/api/fsearch {"query":"frieren"} on 2026-09-12. */
const SEARCH_BODY = {
  result: [
    {
      episode_count: 0,
      locales: ["ja-JP", "en-US", "es-419", "es-ES"],
      slug: "sousou-no-frieren-2d15",
      status: "finished_airing",
      title: "Sousou no Frieren",
      type: "tv",
      year: 2023,
      poster: { formats: ["jpeg", "webp"], hq: "sousou-no-frieren-f6d4-hq" },
      title_en: "Frieren: Beyond Journey's End",
      watch_uri: "/sousou-no-frieren-2d15/ep-1-f897b3",
    },
    {
      episode_count: 0,
      locales: [],
      slug: "sousou-no-frieren-no-mahou-561b",
      status: "currently_airing",
      title: "Sousou no Frieren: ●● no Mahou",
      type: "ona",
      year: 2023,
      watch_uri: null,
    },
    {
      episode_count: 0,
      locales: ["ja-JP"],
      slug: "frieren-beyond-journeys-end-season-2-7dcd",
      title: "Sousou no Frieren 2nd Season",
      title_en: "Frieren: Beyond Journey's End Season 2",
      type: "tv",
      year: 2026,
      watch_uri: "/frieren-beyond-journeys-end-season-2-7dcd/ep-1-8777f8",
    },
  ],
  maxPage: 1,
};

function episodePageBody(
  pages: readonly { number: number; eps: number[] }[],
  rows: readonly { slug: string; episode_number: number; title?: string }[],
) {
  return {
    current_page: 1,
    pages: pages.map((page) => ({ ...page, from: "01", to: "99" })),
    result: rows.map((row) => ({
      ...row,
      episode_string: String(row.episode_number),
      thumbnail: { hq: `642602549d33f3e832425f22/ep-${row.episode_number}-ad5b-hq` },
    })),
  };
}

/** Trimmed from GET /api/show/sousou-no-frieren-2d15/episode/ep-1-f897b3. */
const SERVERS_BODY = {
  servers: [
    {
      name: "VidStreaming",
      shortName: "Vid",
      src: "https://krussdomi.com/cat-player/player?id=67d0c079169c31976b8d7970&source=vidstream&ln=ja-JP",
    },
    {
      name: "BirdStream",
      shortName: "Bird",
      src: "https://krussdomi.com/cat-player/player?id=NmUz&type=dash",
    },
  ],
};

/** Trimmed from the real master: one audio group, three video renditions. */
const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",LANGUAGE="eng",CHANNELS="2",URI="a-eng/playlist.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Japanese",DEFAULT=YES,LANGUAGE="jpn",CHANNELS="2",URI="a-jpn/playlist.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=13298235,CODECS="avc1.4D4828,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="stereo"
v-1080/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1764061,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,AUDIO="stereo"
v-360/playlist.m3u8
`;

/** A sub-only release: the file carries Japanese audio and nothing else. */
const SUB_ONLY_PLAYLIST = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Japanese",DEFAULT=YES,LANGUAGE="jpn",URI="a-jpn/playlist.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1764061,RESOLUTION=640x360,AUDIO="stereo"
v-360/playlist.m3u8
`;

/** The player page's island, trimmed to two of its subtitle tracks. */
function playerHtml(
  manifest = "https://hls.krussdomi.com/manifest/67d0c079169c31976b8d7970/master.m3u8",
) {
  const props = JSON.stringify({
    manifest: [0, manifest],
    subtitles: [
      1,
      [
        [
          0,
          {
            language: [0, "en"],
            name: [0, "English"],
            src: [
              0,
              "https://subst.krussdomi.com/67d0c079169c31976b8d7970/67e0fa641967208e6c20882f.vtt",
            ],
          },
        ],
        [
          0,
          {
            language: [0, "de"],
            name: [0, "German"],
            src: [
              0,
              "https://subst.krussdomi.com/67d0c079169c31976b8d7970/67e0fa646fdb7bb73dce13bc.vtt",
            ],
          },
        ],
      ],
    ],
  }).replace(/"/g, "&quot;");
  return `<html><body><astro-island uid="Z1AjcGt" component-url="/_astro/VidstackPlayer.DeJTdSbW.js" component-export="default" props="${props}" ssr client="only"></astro-island></body></html>`;
}

describe("parseKaaSearchResults", () => {
  test("reads the fields a search row exposes", () => {
    const [frieren] = parseKaaSearchResults(SEARCH_BODY);
    expect(frieren).toEqual({
      slug: "sousou-no-frieren-2d15",
      title: "Sousou no Frieren",
      englishTitle: "Frieren: Beyond Journey's End",
      type: "tv",
      year: 2023,
      locales: ["ja-JP", "en-US", "es-419", "es-ES"],
      posterKey: "sousou-no-frieren-f6d4-hq",
    });
  });

  test("a zero episode_count is the site not counting, not an empty show", () => {
    expect(parseKaaSearchResults(SEARCH_BODY)[0]?.episodeCount).toBeUndefined();
  });

  test("drops an announced show with no audio and nowhere to watch", () => {
    expect(parseKaaSearchResults(SEARCH_BODY).map((row) => row.slug)).toEqual([
      "sousou-no-frieren-2d15",
      "frieren-beyond-journeys-end-season-2-7dcd",
    ]);
  });

  test("an unexpected body yields nothing rather than throwing", () => {
    expect(parseKaaSearchResults(null)).toEqual([]);
    expect(parseKaaSearchResults({ result: "nope" })).toEqual([]);
    expect(parseKaaSearchResults({ result: [{ title: "no slug" }] })).toEqual([]);
  });
});

describe("parseKaaEpisodePage", () => {
  const body = episodePageBody(
    [
      { number: 1, eps: [1, 2, 3] },
      { number: 2, eps: [4, 5] },
    ],
    [
      { slug: "f897b3", episode_number: 1, title: "The Journey's End" },
      { slug: "764d98", episode_number: 2 },
      { slug: "half", episode_number: 2.5 },
    ],
  );

  test("lists the whole run from the page index, not just this page's rows", () => {
    expect(kaaEpisodeNumbers(parseKaaEpisodePage(body))).toEqual([1, 2, 3, 4, 5]);
  });

  test("finds which listing page holds an episode", () => {
    const page = parseKaaEpisodePage(body);
    expect(kaaPageForEpisode(page, 2)).toBe(1);
    expect(kaaPageForEpisode(page, 5)).toBe(2);
    expect(kaaPageForEpisode(page, 6)).toBeUndefined();
  });

  test("keeps each row's slug, title and still, and skips a fractional special", () => {
    expect(parseKaaEpisodePage(body).episodes).toEqual([
      {
        slug: "f897b3",
        number: 1,
        title: "The Journey's End",
        thumbnailKey: "642602549d33f3e832425f22/ep-1-ad5b-hq",
      },
      { slug: "764d98", number: 2, thumbnailKey: "642602549d33f3e832425f22/ep-2-ad5b-hq" },
    ]);
  });
});

describe("parseKaaServers", () => {
  test("reads every https server", () => {
    expect(parseKaaServers(SERVERS_BODY).map((server) => server.name)).toEqual([
      "VidStreaming",
      "BirdStream",
    ]);
  });

  test("refuses a server that is not https", () => {
    expect(parseKaaServers({ servers: [{ name: "X", src: "javascript:alert(1)" }] })).toEqual([]);
  });
});

describe("decodeAstroProp", () => {
  test("unwraps values, arrays, and the tagged fields inside objects", () => {
    expect(decodeAstroProp([0, "a"])).toBe("a");
    expect(
      decodeAstroProp([
        1,
        [
          [0, 1],
          [0, 2],
        ],
      ]),
    ).toEqual([1, 2]);
    expect(decodeAstroProp([0, { name: [0, "English"] }])).toEqual({ name: "English" });
  });

  test("does not claim a tag it cannot read", () => {
    expect(decodeAstroProp([7, "?"])).toBeUndefined();
  });
});

describe("parseKaaPlayerPage", () => {
  test("reads the manifest and its subtitle tracks from the island props", () => {
    expect(parseKaaPlayerPage(playerHtml())).toEqual({
      manifest: "https://hls.krussdomi.com/manifest/67d0c079169c31976b8d7970/master.m3u8",
      subtitles: [
        {
          language: "en",
          name: "English",
          src: "https://subst.krussdomi.com/67d0c079169c31976b8d7970/67e0fa641967208e6c20882f.vtt",
        },
        {
          language: "de",
          name: "German",
          src: "https://subst.krussdomi.com/67d0c079169c31976b8d7970/67e0fa646fdb7bb73dce13bc.vtt",
        },
      ],
    });
  });

  test("repairs the doubled slash some servers write after the scheme", () => {
    expect(
      parseKaaPlayerPage(playerHtml("https:////bl.krussdomi.com/x/manifest.mpd"))?.manifest,
    ).toBe("https://bl.krussdomi.com/x/manifest.mpd");
  });

  test("refuses a manifest that is not https", () => {
    expect(parseKaaPlayerPage(playerHtml("http://hls.krussdomi.com/m.m3u8"))).toBeNull();
  });

  test("a page with no player island is no stream", () => {
    expect(parseKaaPlayerPage("<html><body>Episode not available</body></html>")).toBeNull();
  });
});

describe("resolveKaaSlug", () => {
  const title = (id: string, native?: string) => ({
    id,
    kind: "anime" as const,
    title: "Frieren",
    ...(native ? { externalIds: { providerNativeIds: { kickassanime: native } } } : {}),
  });

  test("prefers the stored provider-native slug", () => {
    expect(resolveKaaSlug(title("154587", "sousou-no-frieren-2d15"))).toBe(
      "sousou-no-frieren-2d15",
    );
  });

  test("accepts a bare slug as the title id", () => {
    expect(resolveKaaSlug(title("sousou-no-frieren-2d15"))).toBe("sousou-no-frieren-2d15");
  });

  test("never sends another catalog's id as a slug", () => {
    // An AniList id, and AnimeGG's slug for the same kind of show.
    expect(resolveKaaSlug(title("154587"))).toBeNull();
    expect(resolveKaaSlug(title("one-piece"))).toBeNull();
    expect(resolveKaaSlug(title("Sousou no Frieren"))).toBeNull();
    expect(resolveKaaSlug(title("../api"))).toBeNull();
  });
});

describe("matchKaaShow", () => {
  const rows = parseKaaSearchResults(SEARCH_BODY);

  test("matches the English title a Miruro search carries", () => {
    expect(matchKaaShow(rows, { title: "Frieren: Beyond Journey's End", year: 2023 })).toBe(
      "sousou-no-frieren-2d15",
    );
  });

  test("matches the romaji title, ignoring case and punctuation", () => {
    expect(matchKaaShow(rows, { title: "sousou no frieren", year: 2023 })).toBe(
      "sousou-no-frieren-2d15",
    );
    expect(matchKaaShow(rows, { title: "Frieren - Beyond Journeys End" })).toBe(
      "sousou-no-frieren-2d15",
    );
  });

  test("a sequel is not its first season", () => {
    expect(
      matchKaaShow(rows, { title: "Frieren: Beyond Journey's End Season 2", year: 2026 }),
    ).toBe("frieren-beyond-journeys-end-season-2-7dcd");
  });

  test("the same name in another year is another show", () => {
    expect(matchKaaShow(rows, { title: "Sousou no Frieren", year: 2031 })).toBeNull();
  });

  test("two rows with the name is no match, not the first of them", () => {
    const twins = [...rows, { ...rows[0]!, slug: "sousou-no-frieren-9999" }];
    expect(matchKaaShow(twins, { title: "Sousou no Frieren" })).toBeNull();
  });

  test("a partial name is no match", () => {
    expect(matchKaaShow(rows, { title: "Frieren" })).toBeNull();
  });
});

describe("selectKaaAudio", () => {
  const renditions = parseHlsMasterAudioRenditions(MASTER_PLAYLIST);

  test("reads every audio rendition the master declares", () => {
    expect(renditions).toEqual([
      { language: "eng", name: "English", isDefault: false },
      { language: "jpn", name: "Japanese", isDefault: true },
    ]);
  });

  test("a dub plays the English rendition, named as the file names it", () => {
    expect(selectKaaAudio(renditions, "dub")).toEqual({
      presentation: "dub",
      language: "en",
      nativeLabel: "English",
    });
  });

  test("a sub plays the default rendition, which is what --alang=orig picks", () => {
    expect(selectKaaAudio(renditions, "sub")).toEqual({
      presentation: "sub",
      language: "ja",
      nativeLabel: "Japanese",
    });
  });

  test("a file with no English track is a sub however it was asked for", () => {
    expect(selectKaaAudio(parseHlsMasterAudioRenditions(SUB_ONLY_PLAYLIST), "dub")).toMatchObject({
      presentation: "sub",
      language: "ja",
    });
  });

  test("ASSOC-LANGUAGE is not mistaken for the track's own LANGUAGE", () => {
    const [track] = parseHlsMasterAudioRenditions(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",ASSOC-LANGUAGE="ja",LANGUAGE="en",NAME="English",URI="a.m3u8"',
    );
    expect(track).toEqual({ language: "en", name: "English", isDefault: false });
    expect(selectKaaAudio(track ? [track] : [], "dub").presentation).toBe("dub");
  });

  test("an unreadable master still plays, labelled as the sub it usually is", () => {
    expect(selectKaaAudio([], "dub")).toEqual({ presentation: "sub", language: "ja" });
  });
});

describe("kaaStreamHeaders", () => {
  test("derives referer and Origin from the player, which is what each hop checks", () => {
    expect(kaaStreamHeaders("https://krussdomi.com/cat-player/player?id=1")).toMatchObject({
      referer: "https://krussdomi.com/",
      origin: "https://krussdomi.com",
    });
  });
});

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function contextWith(route: Route, requests: string[] = []): ProviderRuntimeContext {
  return {
    providerId: "kickassanime",
    now: () => "2026-09-12T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      async fetch(input, init) {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        return route(url, init);
      },
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A show with a full sub run and a two-episode dub, like much of the catalog. */
function catalogRoute(
  options: { readonly servers?: unknown; readonly master?: string | null } = {},
): Route {
  return (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/fsearch") return json(SEARCH_BODY);
    if (parsed.pathname === "/api/show/sousou-no-frieren-2d15/episodes") {
      const dub = parsed.searchParams.get("lang") === "en-US";
      const page = parsed.searchParams.get("ep");
      const pages = dub
        ? [{ number: 1, eps: [1, 2] }]
        : [
            { number: 1, eps: [1, 2] },
            { number: 2, eps: [3] },
          ];
      const rows =
        page === "2"
          ? [{ slug: "c0ffee", episode_number: 3 }]
          : [
              { slug: dub ? "aa83b7" : "f897b3", episode_number: 1, title: "The Journey's End" },
              { slug: dub ? "7bbf4f" : "764d98", episode_number: 2 },
            ];
      return json(episodePageBody(pages, rows));
    }
    if (parsed.pathname.startsWith("/api/show/sousou-no-frieren-2d15/episode/")) {
      return json(options.servers ?? SERVERS_BODY);
    }
    if (parsed.hostname === "krussdomi.com") return new Response(playerHtml());
    if (parsed.hostname === "hls.krussdomi.com") {
      if (options.master === null) return new Response("gone", { status: 404 });
      return new Response(options.master ?? MASTER_PLAYLIST);
    }
    return new Response("not found", { status: 404 });
  };
}

function resolveInput(overrides: Partial<ProviderResolveInput> = {}): ProviderResolveInput {
  return {
    title: {
      id: "sousou-no-frieren-2d15",
      kind: "anime",
      title: "Sousou no Frieren",
    },
    episode: { season: 1, episode: 1 },
    mediaKind: "anime",
    intent: "play",
    allowedRuntimes: ["direct-http"],
    ...overrides,
  };
}

describe("kickassanimeProviderModule", () => {
  afterEach(() => __testing.reset());

  test("search keeps the slug as the provider-native id and reports its audio", async () => {
    const results = await kickassanimeProviderModule.search?.(
      { query: "frieren" },
      contextWith(catalogRoute()),
    );
    expect(results?.[0]).toMatchObject({
      id: "sousou-no-frieren-2d15",
      title: "Sousou no Frieren",
      englishTitle: "Frieren: Beyond Journey's End",
      year: "2023",
      metadataSource: "KickAssAnime",
      availableAudioModes: ["sub", "dub"],
      posterPath: "https://kaa.lt/image/poster/sousou-no-frieren-f6d4-hq.webp",
      externalIds: { providerNativeIds: { kickassanime: "sousou-no-frieren-2d15" } },
    });
    expect(results?.[1]?.availableAudioModes).toEqual(["sub"]);
  });

  test("an empty query asks nothing", async () => {
    const requests: string[] = [];
    expect(
      await kickassanimeProviderModule.search?.(
        { query: "  " },
        contextWith(catalogRoute(), requests),
      ),
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  test("lists the whole run, with titles and stills where the first page has them", async () => {
    const episodes = await kickassanimeProviderModule.listEpisodes?.(
      { title: resolveInput().title },
      contextWith(catalogRoute()),
    );
    expect(episodes?.map((episode) => episode.index)).toEqual([1, 2, 3]);
    expect(episodes?.[0]).toMatchObject({
      name: "The Journey's End",
      totalEpisodeCount: 3,
      artwork: {
        thumbnailUrl: "https://kaa.lt/image/thumbnail/642602549d33f3e832425f22/ep-1-ad5b-hq.webp",
      },
    });
    expect(episodes?.[2]?.name).toBeUndefined();
  });

  test("resolves sub to the HLS manifest with the headers each hop needs, and its tracks", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput(),
      contextWith(catalogRoute()),
    );

    expect(result.status).toBe("resolved");
    const [stream] = result.streams;
    expect(stream).toMatchObject({
      url: "https://hls.krussdomi.com/manifest/67d0c079169c31976b8d7970/master.m3u8",
      protocol: "hls",
      presentation: "sub",
      audioLanguages: ["ja"],
      serverName: "VidStreaming",
      subtitleDelivery: "external",
      headers: { referer: "https://krussdomi.com/", origin: "https://krussdomi.com" },
    });
    expect(result.selectedStreamId).toBe(stream?.id);
    expect(result.subtitles.map((track) => [track.language, track.format])).toEqual([
      ["en", "vtt"],
      ["de", "vtt"],
    ]);
    expect(result.subtitles.every((track) => track.sourceId === stream?.sourceId)).toBe(true);
    expect(result.externalIds?.providerNativeIds).toEqual({
      kickassanime: "sousou-no-frieren-2d15",
    });
  });

  test("asks the dub listing for a dub, and plays the dub episode's own slug", async () => {
    const requests: string[] = [];
    const result = await kickassanimeProviderModule.resolve(
      resolveInput({ preferredAudioLanguage: "en" }),
      contextWith(catalogRoute(), requests),
    );
    expect(result.streams[0]?.presentation).toBe("dub");
    expect(result.streams[0]?.audioLanguages).toEqual(["en"]);
    expect(result.streams[0]?.languageEvidence).toEqual([
      { role: "audio", normalizedLanguage: "en", nativeLabel: "English" },
    ]);
    expect(requests).toContain(
      "GET https://kaa.lt/api/show/sousou-no-frieren-2d15/episode/ep-1-aa83b7",
    );
    expect(result.trace.events?.some((event) => event.type === "audio:fallback")).toBe(false);
  });

  test("a dub the file lacks plays the sub, and says that it did", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput({ preferredAudioLanguage: "en" }),
      contextWith(catalogRoute({ master: SUB_ONLY_PLAYLIST })),
    );
    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.presentation).toBe("sub");
    expect(
      result.trace.events?.find((event) => event.type === "audio:fallback")?.message,
    ).toContain("no dub for episode 1");
  });

  test("a master that cannot be read still plays, rather than failing the episode", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput(),
      contextWith(catalogRoute({ master: null })),
    );
    expect(result.status).toBe("resolved");
    expect(result.streams[0]).toMatchObject({ presentation: "sub", qualityLabel: "auto" });
  });

  test("hands mpv the master, never a video-only rendition", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput(),
      contextWith(catalogRoute()),
    );
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]?.url).toContain("master.m3u8");
    expect(result.streams[0]?.qualityRank).toBe(0);
  });

  test("fetches the listing page that holds a later episode", async () => {
    const requests: string[] = [];
    await kickassanimeProviderModule.resolve(
      resolveInput({ episode: { season: 1, episode: 3 } }),
      contextWith(catalogRoute(), requests),
    );
    expect(requests).toContain(
      "GET https://kaa.lt/api/show/sousou-no-frieren-2d15/episodes?ep=2&lang=ja-JP",
    );
    expect(requests).toContain(
      "GET https://kaa.lt/api/show/sousou-no-frieren-2d15/episode/ep-3-c0ffee",
    );
  });

  test("an episode past the run is not found, not a guess", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput({ episode: { season: 1, episode: 9 } }),
      contextWith(catalogRoute()),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("not-found");
  });

  test("no VidStreaming server is no stream — the others are not played blind", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput(),
      contextWith(catalogRoute({ servers: { servers: [SERVERS_BODY.servers[1]] } })),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("not-found");
  });

  test("plays a title found in another catalog, and remembers the match", async () => {
    const remembered = new Map<string, string>();
    const context = {
      ...contextWith(catalogRoute()),
      titleBridge: {
        get: (key: { catalogId: string }) => remembered.get(key.catalogId),
        set: (key: { catalogId: string; nativeId: string }) =>
          void remembered.set(key.catalogId, key.nativeId),
      },
    };
    const fromMiruro = {
      id: "154587",
      kind: "anime" as const,
      title: "Frieren: Beyond Journey's End",
      year: 2023,
      externalIds: { anilistId: "154587" },
    };

    const result = await kickassanimeProviderModule.resolve(
      resolveInput({ title: fromMiruro }),
      context,
    );

    expect(result.status).toBe("resolved");
    expect(result.externalIds?.providerNativeIds).toEqual({
      kickassanime: "sousou-no-frieren-2d15",
    });
    expect(remembered.get("154587")).toBe("sousou-no-frieren-2d15");
    expect(
      result.trace.events?.find((event) => event.type === "source:success")?.message,
    ).toContain("sousou-no-frieren-2d15");

    const requests: string[] = [];
    await kickassanimeProviderModule.resolve(resolveInput({ title: fromMiruro }), {
      ...context,
      ...contextWith(catalogRoute(), requests),
      titleBridge: context.titleBridge,
    });
    expect(requests.some((request) => request.includes("/api/fsearch"))).toBe(false);
  });

  test("a title with no clear match falls through rather than playing a guess", async () => {
    const result = await kickassanimeProviderModule.resolve(
      resolveInput({
        title: { id: "1", kind: "anime", title: "Frieren", externalIds: { anilistId: "1" } },
      }),
      contextWith(catalogRoute()),
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({ code: "not-found" });
    expect(result.failures[0]?.message).toContain('"Frieren"');
  });

  test("an HTTP error is retryable and does not go looking for a new domain", async () => {
    const requests: string[] = [];
    const result = await kickassanimeProviderModule.resolve(
      resolveInput(),
      contextWith(() => json({ message: "down" }, 503), requests),
    );
    expect(result.failures[0]).toMatchObject({ code: "network-error", retryable: true });
    expect(requests.some((request) => request.includes("kickass-anime.ro"))).toBe(false);
  });

  test("a dead domain is replaced by where the old alias redirects", async () => {
    const requests: string[] = [];
    const moved = catalogRoute();
    const route: Route = (url, init) => {
      if (url.startsWith("https://kaa.lt/")) throw new TypeError("fetch failed");
      if (url === "https://kickass-anime.ro/") return redirectTo("https://kaa.new/");
      return moved(url.replace("https://kaa.new/", "https://kaa.lt/"), init);
    };

    const results = await kickassanimeProviderModule.search?.(
      { query: "frieren" },
      contextWith(route, requests),
    );

    expect(results?.[0]?.posterPath).toBe(
      "https://kaa.new/image/poster/sousou-no-frieren-f6d4-hq.webp",
    );
    expect(requests).toEqual([
      "POST https://kaa.lt/api/fsearch",
      "GET https://kickass-anime.ro/",
      "POST https://kaa.new/api/fsearch",
    ]);
  });

  test("an alias that answers without redirecting is no new domain", async () => {
    const route: Route = (url) => {
      if (url.startsWith("https://kaa.lt/")) throw new TypeError("fetch failed");
      return new Response("<html></html>");
    };
    await expect(
      kickassanimeProviderModule.search?.({ query: "frieren" }, contextWith(route)),
    ).rejects.toThrow("fetch failed");
  });
});

function redirectTo(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

describe("discoverKaaBase", () => {
  const discover = (location: string) => discoverKaaBase(contextWith(() => redirectTo(location)));

  test("reads the one hop by hand rather than following it", async () => {
    let redirectMode: RequestInit["redirect"];
    await discoverKaaBase(
      contextWith((_url, init) => {
        redirectMode = init?.redirect;
        return redirectTo("https://kaa.lt/");
      }),
    );
    expect(redirectMode).toBe("manual");
  });

  test("takes a target shaped like every rotation so far", async () => {
    expect(await discover("https://kaa.lt/")).toBe("https://kaa.lt");
    expect(await discover("https://www.kickassanime.io/x")).toBe("https://www.kickassanime.io");
  });

  test("refuses a lapsed alias pointing somewhere else entirely", async () => {
    expect(await discover("https://evil.example/")).toBeNull();
    expect(await discover("https://kaa.lt.evil.example/")).toBeNull();
  });

  test("refuses a cleartext target", async () => {
    expect(await discover("http://kaa.lt/")).toBeNull();
  });

  test("a redirect back to the alias itself is no answer", async () => {
    expect(await discover("/")).toBeNull();
  });
});
