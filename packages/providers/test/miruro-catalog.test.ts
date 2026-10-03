import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  decodeMiruroCatalogBody,
  fetchMiruroPlay,
  listMiruroCatalogEpisodes,
  lookupMiruroAnimeByAnilist,
  MiruroCatalogError,
  searchMiruroCatalog,
} from "../src/miruro/catalog";
import { mapMiruroCatalogAnime } from "../src/miruro/direct";
import { __testing as mirrorsTesting } from "../src/miruro/mirrors";

const CATALOG_KEY = "miruro/catalog";
const CATALOG_ID = "q9k1BcVSC-_RZOwRbIy6xvndxAXIt3Tb";

/** The wire body the site actually serves: gzip JSON, XORed with the key. */
async function encodeCatalog(value: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const gzipped = new Uint8Array(
    await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const key = new TextEncoder().encode(CATALOG_KEY);
  for (let index = 0; index < gzipped.length; index += 1) {
    gzipped[index] = gzipped[index]! ^ key[index % key.length]!;
  }
  return gzipped;
}

const catalogResponse = async (value: unknown, status = 200) =>
  new Response(await encodeCatalog(value), {
    status,
    headers: { "content-type": "application/octet-stream" },
  });

type SeenRequest = { url: string; headers: Record<string, string> };

function contextWithFetch(handler: (url: URL) => Promise<Response> | Response): {
  context: ProviderRuntimeContext;
  requests: SeenRequest[];
} {
  const requests: SeenRequest[] = [];
  const context = {
    providerId: "miruro",
    fetch: {
      runtime: "direct-http" as const,
      async fetch(input: string | URL | Request, init?: RequestInit) {
        const url = new URL(String(input));
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
          headers[key] = value;
        });
        requests.push({ url: url.toString(), headers });
        return handler(url);
      },
    },
  } as unknown as ProviderRuntimeContext;
  return { context, requests };
}

describe("decodeMiruroCatalogBody", () => {
  test("XOR + gunzip decodes an octet-stream catalog body", async () => {
    const encoded = await encodeCatalog({ data: [{ id: "a1" }], has_more: false });
    const parsed = await decodeMiruroCatalogBody(encoded, "application/octet-stream");
    expect(parsed).toEqual({ data: [{ id: "a1" }], has_more: false });
  });

  test("a plain problem+json body parses without the XOR step", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ type: "about:blank", status: 400, detail: "Unsupported catalog request." }),
    );
    const parsed = await decodeMiruroCatalogBody(body, "application/problem+json");
    expect(parsed).toMatchObject({ status: 400, detail: "Unsupported catalog request." });
  });

  test("an octet-stream body that is not XORed JSON fails loudly", async () => {
    await expect(
      decodeMiruroCatalogBody(new TextEncoder().encode("garbage"), "application/octet-stream"),
    ).rejects.toThrow();
  });
});

describe("miruro catalog requests", () => {
  test("the browser header set rides every catalog call", async () => {
    const { context, requests } = contextWithFetch(() => catalogResponse({ data: [] }));
    mirrorsTesting.reset();
    await searchMiruroCatalog(context, "one piece");
    mirrorsTesting.reset();

    const api = requests.find((request) => request.url.includes("/api/v1/anime"));
    expect(api).toBeDefined();
    expect(api?.headers["user-agent"]).toContain("Mozilla/5.0");
    expect(api?.headers["accept-language"]).toBe("en-US,en;q=0.9");
    expect(api?.headers["referer"]).toContain("/search?sort=POPULARITY_DESC");
  });

  test("search sends the allowlisted navbar query shape", async () => {
    const { context, requests } = contextWithFetch(() => catalogResponse({ data: [] }));
    mirrorsTesting.reset();
    await searchMiruroCatalog(context, "one piece");
    mirrorsTesting.reset();

    const url = new URL(requests.find((request) => request.url.includes("/api/v1/anime"))!.url);
    expect(url.searchParams.get("q")).toBe("one piece");
    // The backend 400s any page size the site's own code does not send.
    expect(url.searchParams.get("limit")).toBe("15");
    expect(url.searchParams.get("sort")).toBe("-popularity");
  });

  test("the AniList bridge uses the allowlisted lookup shape", async () => {
    const { context, requests } = contextWithFetch(() =>
      catalogResponse({ data: [{ id: CATALOG_ID, external_ids: { anilist: ["21"] } }] }),
    );
    mirrorsTesting.reset();
    const anime = await lookupMiruroAnimeByAnilist(context, "21");
    mirrorsTesting.reset();

    const url = new URL(requests.find((request) => request.url.includes("/api/v1/anime"))!.url);
    expect(url.searchParams.get("anilist_id_in")).toBe("21");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(anime?.id).toBe(CATALOG_ID);
  });

  test("episodes carries kind + the allowlisted page size", async () => {
    const { context, requests } = contextWithFetch(() =>
      catalogResponse({ data: [{ episode_number: 1 }] }),
    );
    mirrorsTesting.reset();
    await listMiruroCatalogEpisodes(context, CATALOG_ID);
    mirrorsTesting.reset();

    const url = new URL(
      requests.find((request) => request.url.endsWith("/episodes?kind=regular&limit=10000"))!.url,
    );
    expect(url.pathname).toBe(`/api/v1/anime/${CATALOG_ID}/episodes`);
    expect(url.searchParams.get("kind")).toBe("regular");
    expect(url.searchParams.get("limit")).toBe("10000");
  });

  test("play asks for the whole matrix with no query at all", async () => {
    const { context, requests } = contextWithFetch(() =>
      catalogResponse({ episode_number: 1, tracks: [] }),
    );
    mirrorsTesting.reset();
    const play = await fetchMiruroPlay(context, CATALOG_ID, 1);
    mirrorsTesting.reset();

    const url = new URL(requests.find((request) => request.url.includes("/play"))!.url);
    expect(url.pathname).toBe(`/api/v1/anime/${CATALOG_ID}/episodes/1/play`);
    expect(url.search).toBe("");
    expect(play.episode_number).toBe(1);
  });

  test("a problem+json error surfaces as MiruroCatalogError with the detail", async () => {
    const { context } = contextWithFetch(
      () =>
        new Response(JSON.stringify({ status: 400, detail: "Unsupported catalog request." }), {
          status: 400,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    mirrorsTesting.reset();
    try {
      await searchMiruroCatalog(context, "x");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MiruroCatalogError);
      expect((error as MiruroCatalogError).status).toBe(400);
      expect((error as MiruroCatalogError).detail).toBe("Unsupported catalog request.");
    } finally {
      mirrorsTesting.reset();
    }
  });

  test("the next mirror is tried when the first fails", async () => {
    let apiCalls = 0;
    const { context, requests } = contextWithFetch((url) => {
      if (url.pathname === "/api/v1/anime") {
        apiCalls += 1;
        if (apiCalls === 1) throw new TypeError("fetch failed");
      }
      return catalogResponse({ data: [{ id: CATALOG_ID, external_ids: { anilist: ["21"] } }] });
    });
    mirrorsTesting.reset();
    const anime = await lookupMiruroAnimeByAnilist(context, "21");
    mirrorsTesting.reset();

    expect(anime?.id).toBe(CATALOG_ID);
    expect(requests.filter((request) => request.url.includes("/api/v1/anime")).length).toBe(2);
  });
});

describe("mapMiruroCatalogAnime", () => {
  const ROW = {
    id: CATALOG_ID,
    external_ids: { anilist: ["21"], mal: ["21"], kitsu: ["12"] },
    title: { romaji: "One Piece", english: "One Piece", native: "ONE PIECE" },
    format: "TV",
    status: "RELEASING",
    episode_count: 1100,
    episode_duration_minutes: 24,
    average_score: 87,
    popularity: 250000,
    season_year: 1999,
    is_adult: false,
    description: "Follows <b>Luffy</b> &amp; crew.",
    cover_image: { large: "https://img/large.jpg", extra_large: "https://img/xl.jpg" },
    banner_image: "https://img/banner.jpg",
  };

  test("maps the catalog row onto the AniList-shaped result", () => {
    const result = mapMiruroCatalogAnime(ROW);
    expect(result?.id).toBe("21");
    expect(result?.externalIds).toEqual({ anilistId: "21", malId: "21" });
    expect(result?.title).toBe("One Piece");
    expect(result?.type).toBe("series");
    expect(result?.year).toBe("1999");
    expect(result?.episodeCount).toBe(1100);
    expect(result?.durationSeconds).toBe(1440);
    expect(result?.rating).toBeCloseTo(8.7);
    expect(result?.metadataSource).toBe("AniList");
    expect(result?.posterPath).toBe("https://img/xl.jpg");
    expect(result?.artwork?.backdropUrl).toBe("https://img/banner.jpg");
    expect(result?.overview).toBe("Follows Luffy & crew.");
  });

  test("a row without an AniList id is dropped — resolve could never name it again", () => {
    expect(mapMiruroCatalogAnime({ ...ROW, external_ids: { mal: ["21"] } })).toBeNull();
    expect(mapMiruroCatalogAnime({ ...ROW, external_ids: undefined })).toBeNull();
  });

  test("adult and unreleased rows are excluded like the AniList query does", () => {
    expect(mapMiruroCatalogAnime({ ...ROW, is_adult: true })).toBeNull();
    expect(mapMiruroCatalogAnime({ ...ROW, status: "NOT_YET_RELEASED" })).toBeNull();
  });

  test("romaji leads when english is absent, and becomes an alias", () => {
    const result = mapMiruroCatalogAnime({
      ...ROW,
      title: { romaji: "Hoshi no Samidare", english: null, native: "惑星のさみだれ" },
    });
    expect(result?.title).toBe("Hoshi no Samidare");
    expect(result?.nativeTitle).toBe("惑星のさみだれ");
  });

  test("one-shot formats classify as movie the way the CLI's rule does", () => {
    expect(mapMiruroCatalogAnime({ ...ROW, format: "MOVIE", episode_count: 1 })?.type).toBe(
      "movie",
    );
    expect(mapMiruroCatalogAnime({ ...ROW, format: "OVA", episode_count: 1 })?.type).toBe("movie");
    expect(mapMiruroCatalogAnime({ ...ROW, format: "TV", episode_count: 1 })?.type).toBe("series");
  });
});
