import { describe, expect, test } from "bun:test";

import {
  allmangaProviderModule,
  buildStreamHeaders,
  decodeTobeparsed,
  fetchAllMangaEpisodeCatalog,
  gqlPost,
  resolveAnimeEpisodeString,
  searchAllManga,
} from "../src/index";

const TEST_KEY_RAW = "Xot36i3lK3:v1";
const FIXTURE_BASE = new URL("./fixtures/allmanga/", import.meta.url);

describe("decodeTobeparsed", () => {
  test("decodes the current versioned allmanga blob layout", async () => {
    const plain =
      '{"sourceUrl":"--68656c6c6f","sourceName":"Default"}' +
      '{"sourceUrl":"--776f726c64","sourceName":"Yt-mp4"}';
    const blob = await buildBlob(plain);

    await expect(decodeTobeparsed(blob)).resolves.toEqual([
      { sourceUrl: "68656c6c6f", sourceName: "Default" },
      { sourceUrl: "776f726c64", sourceName: "Yt-mp4" },
    ]);
  });
});

describe("buildStreamHeaders", () => {
  test("prefers the stream-specific referer when one is required", () => {
    expect(buildStreamHeaders("https://cdn.example/ref", "https://allmanga.to", "ua")).toEqual({
      Referer: "https://cdn.example/ref",
      "User-Agent": "ua",
    });
  });

  test("falls back to the provider referer when the stream has no override", () => {
    expect(buildStreamHeaders(undefined, "https://allmanga.to", "ua")).toEqual({
      Referer: "https://allmanga.to",
      "User-Agent": "ua",
    });
  });
});

describe("resolveAnimeEpisodeString", () => {
  test("matches the exact episode number even when the upstream list is reverse ordered", () => {
    expect(
      resolveAnimeEpisodeString(["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"], 1),
    ).toBe("1");
    expect(
      resolveAnimeEpisodeString(
        ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
        12,
      ),
    ).toBe("12");
  });

  test("falls back to positional lookup when an exact numeric match is unavailable", () => {
    expect(resolveAnimeEpisodeString(["special-a", "special-b"], 2)).toBe("special-b");
  });
});

describe("AllManga HTTP helpers", () => {
  test("gqlPost composes caller cancellation with its request timeout", async () => {
    const originalFetch = globalThis.fetch;
    const parent = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      await gqlPost(
        "https://api.example/graphql",
        "https://referer.example",
        "ua",
        "query { ok }",
        {},
        parent.signal,
      );
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).not.toBe(parent.signal);
      expect(capturedSignal?.aborted).toBe(false);
      parent.abort("test-cancel");
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("search and episode catalog helpers pass caller cancellation into fetches", async () => {
    const originalFetch = globalThis.fetch;
    const parent = new AbortController();
    const capturedSignals: AbortSignal[] = [];
    globalThis.fetch = (async (_input, init) => {
      if (init?.signal) capturedSignals.push(init.signal);
      return new Response(
        JSON.stringify({
          data: {
            shows: { edges: [] },
            show: {
              _id: "show-1",
              availableEpisodesDetail: { sub: ["1"], dub: [] },
              availableEpisodes: { sub: 1, dub: 0 },
              episodeCount: 1,
            },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      await searchAllManga(
        "https://api.example/graphql",
        "https://referer.example",
        "ua",
        "Example",
        "sub",
        parent.signal,
      );
      await fetchAllMangaEpisodeCatalog({
        apiUrl: "https://api.example/graphql",
        referer: "https://referer.example",
        ua: "ua",
        showId: "show-1",
        mode: "sub",
        signal: parent.signal,
      });

      expect(capturedSignals.length).toBeGreaterThanOrEqual(2);
      expect(capturedSignals.every((signal) => signal !== parent.signal)).toBe(true);
      parent.abort("test-cancel");
      expect(capturedSignals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AllManga provider evidence fixtures", () => {
  test("search result preserves provider-native ids artwork and language evidence", async () => {
    using fetchMock = await mockAllMangaFetch();

    const results = await allmangaProviderModule.search?.(
      { query: "Evidence Fox", preferredAudioLanguage: "ja" },
      { now: nowFixture, signal: new AbortController().signal },
    );
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    expect(results?.[0]).toMatchObject({
      id: expected.search.id,
      externalIds: expected.search.externalIds,
      artwork: {
        posterUrl: expected.search.artwork.posterUrl,
        backdropUrl: expected.search.artwork.backdropUrl,
      },
      availableAudioModes: expected.search.languageModes,
    });
    expect(results?.[0]?.languageEvidence?.map((evidence) => evidence.nativeLabel)).toContain(
      "sub",
    );
    expect(results?.[0]?.languageEvidence?.map((evidence) => evidence.normalizedLanguage)).toEqual(
      expect.arrayContaining(["ja", "en"]),
    );
    expect(fetchMock.calls.some((url) => url.includes("query="))).toBe(false);
  });

  test("episode catalog carries native ids and artwork without live calls", async () => {
    await using _fetchMock = await mockAllMangaFetch();

    const episodes = await allmangaProviderModule.listEpisodes?.(
      {
        title: {
          id: "allanime:show-allmanga-evidence",
          kind: "anime",
          title: "Evidence Fox",
        },
        preferredAudioLanguage: "ja",
      },
      { now: nowFixture, signal: new AbortController().signal },
    );
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    expect(episodes?.[0]).toMatchObject({
      index: 1,
      label: "Episode 1",
      externalIds: expected.episode.externalIds,
      artwork: {
        thumbnailUrl: expected.episode.thumbnailUrl,
      },
    });
  });

  test("sub and dub source inventory remains distinct and ISO-normalized", async () => {
    await using _fetchMock = await mockAllMangaFetch();
    const expected = await readFixture<ExpectedAllMangaContract>("expected-normalized.json");

    const sub = await allmangaProviderModule.resolve(
      {
        title: {
          id: "allanime:show-allmanga-evidence",
          kind: "anime",
          title: "Evidence Fox",
          externalIds: expected.search.externalIds,
        },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "ja",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      { now: nowFixture, signal: new AbortController().signal },
    );
    const dub = await allmangaProviderModule.resolve(
      {
        title: {
          id: "allanime:show-allmanga-evidence",
          kind: "anime",
          title: "Evidence Fox",
          externalIds: expected.search.externalIds,
        },
        episode: { episode: 1 },
        mediaKind: "anime",
        preferredAudioLanguage: "en",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      { now: nowFixture, signal: new AbortController().signal },
    );

    expect(sub.status).toBe("resolved");
    expect(dub.status).toBe("resolved");
    expect(sub.streams[0]).toMatchObject({
      audioLanguages: [expected.subResolve.audioLanguage],
      hardSubLanguage: expected.subResolve.hardSubLanguage,
      presentation: expected.subResolve.presentation,
    });
    expect(dub.streams[0]).toMatchObject({
      audioLanguages: [expected.dubResolve.audioLanguage],
      presentation: expected.dubResolve.presentation,
    });
    expect(sub.streams[0]?.languageEvidence?.[0]).toMatchObject({
      nativeLabel: expected.subResolve.nativeLabel,
      normalizedLanguage: expected.subResolve.audioLanguage,
    });
    expect(dub.streams[0]?.languageEvidence?.[0]).toMatchObject({
      nativeLabel: expected.dubResolve.nativeLabel,
      normalizedLanguage: expected.dubResolve.audioLanguage,
    });
    expect(sub.sources?.[0]?.metadata?.sourceFamily).toBe("fm-hls");
    expect(dub.streams[0]?.url).toContain("/dub/");
    expect(sub.externalIds).toEqual(expected.search.externalIds);
    expect(dub.externalIds).toEqual(expected.search.externalIds);
  });
});

async function buildBlob(plain: string): Promise<string> {
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const footer = Uint8Array.from({ length: 16 }, (_, index) => 200 + index);
  const version = new Uint8Array([1]);
  const counter = new Uint8Array(16);
  counter.set(iv, 0);
  counter[15] = 2;

  const keyBytes = new TextEncoder().encode(TEST_KEY_RAW);
  const hashBuf = await crypto.subtle.digest("SHA-256", keyBytes);
  const key = await crypto.subtle.importKey("raw", hashBuf, { name: "AES-CTR" }, false, [
    "encrypt",
  ]);

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CTR", counter, length: 64 },
      key,
      new TextEncoder().encode(plain),
    ),
  );

  const bytes = new Uint8Array(version.length + iv.length + encrypted.length + footer.length);
  bytes.set(version, 0);
  bytes.set(iv, version.length);
  bytes.set(encrypted, version.length + iv.length);
  bytes.set(footer, version.length + iv.length + encrypted.length);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type ExpectedAllMangaContract = {
  readonly search: {
    readonly id: string;
    readonly externalIds: { readonly anilistId: string; readonly malId: string };
    readonly artwork: { readonly posterUrl: string; readonly backdropUrl: string };
    readonly languageModes: readonly ("sub" | "dub")[];
  };
  readonly episode: {
    readonly externalIds: { readonly anilistId: string; readonly malId: string };
    readonly thumbnailUrl: string;
  };
  readonly subResolve: {
    readonly audioLanguage: string;
    readonly hardSubLanguage: string;
    readonly presentation: string;
    readonly nativeLabel: string;
  };
  readonly dubResolve: {
    readonly audioLanguage: string;
    readonly presentation: string;
    readonly nativeLabel: string;
  };
};

async function mockAllMangaFetch(): Promise<Disposable & { readonly calls: readonly string[] }> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const fixtures = {
    search: await readFixture<unknown>("search-response.json"),
    catalog: await readFixture<unknown>("catalog-response.json"),
    sub: await readFixture<unknown>("sub-source-response.json"),
    dub: await readFixture<unknown>("dub-source-response.json"),
  };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    if (url.includes("variables=")) {
      const variablesMatch = /variables=([^&]+)/.exec(url);
      const variables = variablesMatch?.[1]
        ? (JSON.parse(decodeURIComponent(variablesMatch[1])) as { translationType?: string })
        : {};
      return jsonResponse(variables.translationType === "dub" ? fixtures.dub : fixtures.sub);
    }
    if (bodyText.includes("shows(search:")) {
      return jsonResponse(fixtures.search);
    }
    if (bodyText.includes("show(_id:$id)")) {
      return jsonResponse(fixtures.catalog);
    }
    if (bodyText.includes("episode(showId:$showId")) {
      const body = JSON.parse(bodyText) as { variables?: { translationType?: string } };
      return jsonResponse(body.variables?.translationType === "dub" ? fixtures.dub : fixtures.sub);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  return {
    calls,
    [Symbol.dispose]() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(await Bun.file(new URL(name, FIXTURE_BASE)).text()) as T;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function nowFixture(): string {
  return "2026-05-19T00:00:00.000Z";
}
