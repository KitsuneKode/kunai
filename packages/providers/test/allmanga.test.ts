import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderResolveResult } from "@kunai/types";

import {
  allmangaProviderModule,
  buildAllmangaCycleCandidates,
  buildStreamHeaders,
  clearAllMangaProviderCachesForTest,
  decodeTobeparsed,
  fetchAllMangaEpisodeCatalog,
  gqlPost,
  resolveAllMangaAkDeferredLocator,
  resolveAnimeEpisodeString,
  searchAllManga,
  collectAllMangaLinksForStartup,
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

    const sub = await resolveEvidenceEpisode({
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        externalIds: expected.search.externalIds,
      },
      preferredAudioLanguage: "ja",
    });
    const dub = await resolveEvidenceEpisode({
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        externalIds: expected.search.externalIds,
      },
      preferredAudioLanguage: "en",
    });

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
    expect(sub.sources?.[0]).toMatchObject({
      label: "FM HLS",
      host: expect.any(String),
      metadata: expect.objectContaining({
        qualityLabels: expect.any(String),
      }),
    });
    expect(sub.sources?.[0]?.languageEvidence?.[0]).toMatchObject({
      normalizedLanguage: expected.subResolve.audioLanguage,
    });
    expect(sub.sources?.[0]?.sourceEvidence?.[0]).toMatchObject({
      nativeLabel: "FM HLS",
    });
    expect(dub.streams[0]?.url).toContain("/dub/");
    expect(sub.externalIds).toEqual(expected.search.externalIds);
    expect(dub.externalIds).toEqual(expected.search.externalIds);
    expect(sub.trace.events?.some((event) => event.type === "source:start")).toBe(true);
    expect(sub.trace.events?.some((event) => event.type === "variant:selected")).toBe(true);
    const audioModesEvent = sub.trace.events?.find(
      (event) => event.type === "inventory:audio-modes",
    );
    expect(audioModesEvent?.attributes?.modes).toBe("sub,dub");
  });

  test("normal playback does not request Ak when a baseline stream is playable", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "sub-source-response",
      akDelayMs: 100,
    });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.protocol).toBe("hls");
    expect(fetchMock.calls.some((url) => url.includes("/ak-source"))).toBe(false);
  });

  test("quality-first startup includes prompt Ak response", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
    });

    const result = await resolveEvidenceEpisode({ startupPriority: "quality-first" });

    expect(result.status).toBe("resolved");
    expect(result.streams.some((stream) => stream.sourceId === "source:allanime:ak")).toBe(true);
    expect(result.selectionDecision?.startupPriority).toBe("quality-first");
    expect(result.selectionDecision?.reason).toBe("quality-first");
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("quality-first startup returns baseline when optional Ak exceeds the bounded wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
      akDelayMs: 100,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 5 },
    );

    expect(result.requiredAkFallback).toBe(false);
    expect(result.links.some((link) => link.deferredLocator?.startsWith("allmanga-ak:"))).toBe(
      false,
    );
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("quality-first startup aborts optional Ak after the bounded wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "baseline-ak",
      akDelayMs: 100,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 5 },
    );

    expect(result.requiredAkFallback).toBe(false);
    expect(fetchMock.abortedAkRequests).toBe(1);
  });

  test("result cache policy includes startup priority in key parts", async () => {
    await using _fetchMock = await mockAllMangaFetch();

    const fast = await resolveEvidenceEpisode({ startupPriority: "fast" });
    const qualityFirst = await resolveEvidenceEpisode({ startupPriority: "quality-first" });

    expect(fast.status).toBe("resolved");
    expect(qualityFirst.status).toBe("resolved");
    expect(fast.cachePolicy?.keyParts).toContain("fast");
    expect(qualityFirst.cachePolicy?.keyParts).toContain("quality-first");
    expect(fast.cachePolicy?.keyParts).not.toEqual(qualityFirst.cachePolicy?.keyParts);
  });

  test("normal playback requests Ak as required fallback when baseline is empty", async () => {
    using fetchMock = await mockAllMangaFetch({ subSourceFixture: "ak-episode-response" });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("normal playback requests Ak when baseline sources are not selectable", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "mixed-unselectable-baseline-ak",
    });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.filter((url) => url.includes("/broken-source"))).toHaveLength(1);
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("selection stays tied to the provider-cycle validated stream", async () => {
    await using _fetchMock = await mockAllMangaFetch({
      subSourceFixture: "cycle-hls-720-mp4-1080",
    });

    const result = await resolveEvidenceEpisode({ intent: "play", startupPriority: "balanced" });
    const selectedStream = result.streams.find((stream) => stream.id === result.selectedStreamId);

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => [stream.protocol, stream.qualityRank])).toEqual([
      ["mp4", 1080],
      ["hls", 720],
    ]);
    expect(selectedStream).toMatchObject({
      protocol: "hls",
      qualityRank: 720,
    });
    expect(result.selectionDecision?.selectedQualityRank).toBe(720);
  });

  test("quality-first baseline-empty required Ak is not bounded by the optional wait", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "ak-episode-response",
      akDelayMs: 25,
    });

    const result = await collectEvidenceLinksForStartup(
      { startupPriority: "quality-first" },
      { qualityFirstWaitMs: 1 },
    );

    expect(result.requiredAkFallback).toBe(true);
    expect(result.links.some((link) => link.deferredLocator?.startsWith("allmanga-ak:"))).toBe(
      true,
    );
    expect(fetchMock.abortedAkRequests).toBe(0);
  });

  test("explicit Ak source selection skips baseline and requests Ak once", async () => {
    using fetchMock = await mockAllMangaFetch({
      subSourceFixture: "mixed-unselectable-baseline-ak",
    });

    const result = await resolveEvidenceEpisode({
      intent: "play",
      preferredSourceId: "source:allanime:ak",
    });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.sourceId).toBe("source:allanime:ak");
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(fetchMock.calls.some((url) => url.includes("/broken-source"))).toBe(false);
    expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
  });

  test("Ak DASH source resolves as an opaque deferred stream with subtitles", async () => {
    await using _fetchMock = await mockAllMangaFetch({ subSourceFixture: "ak-episode-response" });

    const result = await resolveEvidenceEpisode({ intent: "play" });

    expect(result.status).toBe("resolved");
    expect(result.streams[0]).toMatchObject({
      protocol: "dash",
      container: "mpd",
      presentation: "sub",
      qualityLabel: "1080p",
      audioLanguages: ["ja"],
    });
    expect(result.streams[0]?.url).toBeUndefined();
    expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
    expect(result.streams[0]?.deferredLocator).not.toContain("redacted-video");
    expect(result.subtitles[0]).toMatchObject({
      language: "en",
      format: "ass",
      source: "embedded",
    });

    const descriptor = resolveAllMangaAkDeferredLocator(result.streams[0]?.deferredLocator ?? "");
    expect(descriptor?.video.url).toContain("redacted-video-1080");
    expect(descriptor?.audio.url).toContain("redacted-audio");
    expect(descriptor?.duration).toBe(1440);
  });

  test("source cycle candidates preserve native labels separately from normalized language", () => {
    const candidates = buildAllmangaCycleCandidates(
      [
        {
          id: "stream:allmanga:hls",
          providerId: "allanime",
          sourceId: "source:allanime:fm-hls",
          variantId: "variant:allanime:fm-hls:1080",
          url: "https://cdn.example/sub/1080.m3u8",
          protocol: "hls",
          container: "m3u8",
          audioLanguages: ["ja"],
          hardSubLanguage: "en",
          presentation: "sub",
          qualityLabel: "1080p",
          qualityRank: 1080,
          cachePolicy: {
            ttlClass: "stream-manifest",
            scope: "local",
            keyParts: ["provider", "allmanga", "cycle-candidate"],
          },
          sourceEvidence: [
            {
              sourceId: "source:allanime:fm-hls",
              nativeLabel: "FM-HLS",
              host: "cdn.example",
              confidence: 0.95,
            },
          ],
          confidence: 0.95,
        },
      ],
      "1080",
    );

    expect(candidates[0]).toMatchObject({
      sourceId: "source:allanime:fm-hls",
      streamId: "stream:allmanga:hls",
      nativeLabel: "FM-HLS",
      normalizedAudioLanguage: "ja",
      normalizedSubtitleLanguage: "en",
      presentation: "sub",
    });
  });

  test("source cycle candidates prioritize exact selected stream hints", () => {
    const streams = [
      {
        id: "stream:allmanga:default-1080",
        providerId: "allanime",
        sourceId: "source:allanime:fm-hls",
        variantId: "variant:allanime:fm-hls:1080",
        url: "https://cdn.example/default/1080.m3u8",
        protocol: "hls",
        container: "m3u8",
        qualityLabel: "1080p",
        qualityRank: 1080,
        confidence: 0.95,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "allmanga", "cycle-candidate"],
        },
      },
      {
        id: "stream:allmanga:selected-720",
        providerId: "allanime",
        sourceId: "source:allanime:vid-mp4",
        variantId: "variant:allanime:vid-mp4:720",
        url: "https://cdn.example/selected/720.mp4",
        protocol: "mp4",
        container: "mp4",
        qualityLabel: "720p",
        qualityRank: 720,
        confidence: 0.85,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: ["provider", "allmanga", "cycle-candidate"],
        },
      },
    ] as const;

    const candidates = buildAllmangaCycleCandidates(streams, undefined, {
      preferredSourceId: "source:allanime:vid-mp4",
      preferredStreamId: "stream:allmanga:selected-720",
    });

    expect([...candidates].sort((left, right) => left.priority - right.priority)[0]?.streamId).toBe(
      "stream:allmanga:selected-720",
    );
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

type ResolveEvidenceEpisodeOverrides = Partial<ProviderResolveInput> & {
  readonly title?: Partial<ProviderResolveInput["title"]>;
};

async function collectEvidenceLinksForStartup(
  overrides: ResolveEvidenceEpisodeOverrides = {},
  options: { readonly qualityFirstWaitMs?: number } = {},
) {
  return collectAllMangaLinksForStartup(
    {
      episode: { episode: 1 },
      mediaKind: "anime",
      preferredAudioLanguage: "ja",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      ...overrides,
      title: {
        id: "allanime:show-allmanga-evidence",
        kind: "anime",
        title: "Evidence Fox",
        ...overrides.title,
      },
    },
    {
      apiUrl: "https://api.allanime.day/api",
      referer: "https://youtu-chan.com",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      showId: "show-allmanga-evidence",
      epStr: "1",
      mode: "sub",
      signal: new AbortController().signal,
    },
    options,
  );
}

async function resolveEvidenceEpisode(
  overrides: ResolveEvidenceEpisodeOverrides = {},
): Promise<ProviderResolveResult> {
  const title = {
    id: "allanime:show-allmanga-evidence",
    kind: "anime" as const,
    title: "Evidence Fox",
    ...overrides.title,
  };
  return allmangaProviderModule.resolve(
    {
      episode: { episode: 1 },
      mediaKind: "anime",
      preferredAudioLanguage: "ja",
      intent: "play",
      allowedRuntimes: ["direct-http"],
      ...overrides,
      title,
    },
    { now: nowFixture, signal: new AbortController().signal },
  );
}

async function mockAllMangaFetch(
  options: {
    readonly subSourceFixture?:
      | "sub-source-response"
      | "ak-episode-response"
      | "mixed-unselectable-baseline-ak"
      | "baseline-ak"
      | "cycle-hls-720-mp4-1080";
    readonly akDelayMs?: number;
  } = {},
): Promise<Disposable & { readonly calls: readonly string[]; readonly abortedAkRequests: number }> {
  clearAllMangaProviderCachesForTest();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let abortedAkRequests = 0;
  const subFixture =
    options.subSourceFixture === "mixed-unselectable-baseline-ak" ||
    options.subSourceFixture === "baseline-ak" ||
    options.subSourceFixture === "cycle-hls-720-mp4-1080"
      ? {
          data: {
            episode: {
              episodeString: "1",
              sourceUrls:
                options.subSourceFixture === "cycle-hls-720-mp4-1080"
                  ? [
                      {
                        sourceName: "1080p",
                        sourceUrl: "--https://cdn.allmanga.example/sub/1080/video.mp4?token=x",
                      },
                      {
                        sourceName: "720p",
                        sourceUrl: "--https://cdn.allmanga.example/sub/720/master.m3u8",
                      },
                    ]
                  : [
                      {
                        sourceName: "Default",
                        sourceUrl:
                          options.subSourceFixture === "baseline-ak"
                            ? "--https://cdn.allmanga.example/sub//1080/master.m3u8"
                            : "--/broken-source",
                      },
                      {
                        sourceName: "Ak",
                        sourceUrl: "--/ak-source",
                      },
                    ],
            },
          },
        }
      : await readFixture<unknown>(`${options.subSourceFixture ?? "sub-source-response"}.json`);
  const fixtures = {
    search: await readFixture<unknown>("search-response.json"),
    catalog: await readFixture<unknown>("catalog-response.json"),
    sub: subFixture,
    dub: await readFixture<unknown>("dub-source-response.json"),
    ak: await readFixture<unknown>("ak-source-response.json"),
  };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/ak-source")) {
      if (init?.signal?.aborted) {
        abortedAkRequests += 1;
        throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      init?.signal?.addEventListener(
        "abort",
        () => {
          abortedAkRequests += 1;
        },
        { once: true },
      );
      if (options.akDelayMs) {
        await Bun.sleep(options.akDelayMs);
        if (init?.signal?.aborted) {
          throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
        }
      }
      return jsonResponse(fixtures.ak);
    }
    if (url.includes("/broken-source")) {
      return jsonResponse({ links: [{ link: "", resolutionStr: "1080p" }] });
    }
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
    get abortedAkRequests() {
      return abortedAkRequests;
    },
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
