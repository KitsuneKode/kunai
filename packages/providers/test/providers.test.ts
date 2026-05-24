import { expect, test } from "bun:test";

import { createProviderEngine } from "@kunai/core";

import {
  allmangaProviderModule,
  buildAllmangaSourceCandidates,
  buildMiruroCycleCandidates,
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
  createMiruroResultFromPayload,
  getMiruroEpisodesResponse,
  createVidkingResultFromPayload,
  extractQualitiesFromMaster,
  getProviderMigrationQueue,
  getProviderResearchProfile,
  miruroProviderModule,
  normalizeIsoLanguageCode,
  normalizeProviderDisplayLabel,
  normalizeQualityLabel,
  parseSourceHost,
  providerResearchProfiles,
  qualityRankFromLabel,
  resolveVidkingDirect,
  rivestreamProviderModule,
  stableProviderInventoryId,
  VariantTreeBuilder,
  vidkingProviderModule,
} from "../src/index";

const FIXTURE_BASE = new URL("./fixtures/", import.meta.url);

test("provider engine exposes registered modules", () => {
  const engine = createProviderEngine({
    modules: [
      rivestreamProviderModule,
      vidkingProviderModule,
      miruroProviderModule,
      allmangaProviderModule,
    ],
  });

  expect(engine.getProviderIds()).toEqual(["rivestream", "vidking", "miruro", "allanime"]);
  expect(engine.get("rivestream")).toBe(rivestreamProviderModule);
  expect(engine.get("vidking")).toBe(vidkingProviderModule);
  expect(engine.get("miruro")).toBe(miruroProviderModule);
  expect(engine.get("allanime")).toBe(allmangaProviderModule);
});

test("direct provider success paths report health deltas", async () => {
  const files = [
    "src/vidking/direct.ts",
    "src/allmanga/direct.ts",
    "src/rivestream/direct.ts",
    "src/miruro/direct.ts",
  ];

  for (const file of files) {
    const source = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
    expect(source, `${file} should include provider health feedback`).toContain("healthDelta");
  }
});

test("Vidking direct resolver does not keep a write-only source cache", async () => {
  const source = await Bun.file(new URL("../src/vidking/direct.ts", import.meta.url)).text();
  expect(source).not.toContain("sourceCache");
});

test("provider research profiles are dossier-backed and migration ordered", () => {
  const queue = getProviderMigrationQueue();

  expect(queue[0]?.providerId).toBe("vidking");
  expect(queue[1]?.providerId).toBe("allanime");
  expect(queue.every((profile) => profile.dossierPath.startsWith(".docs/provider-dossiers/"))).toBe(
    true,
  );
  expect(providerResearchProfiles.length).toBeGreaterThanOrEqual(7);
});

test("provider research profiles separate direct providers from legacy fallbacks", () => {
  expect(getProviderResearchProfile("vidking")).toMatchObject({
    status: "production",
    migrationAction: "promote-direct-provider",
    runtimeClass: "direct-http Videasy payload decode",
  });

  expect(getProviderResearchProfile("cineby")).toMatchObject({
    status: "research-only",
    migrationAction: "keep-as-fallback",
  });

  expect(getProviderResearchProfile("anikai")).toMatchObject({
    migrationAction: "hold-for-future-runtime",
  });
});

test("vidking direct payload creates selected stream, variants, and subtitle inventory", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      qualityPreference: "1080",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/720/index.m3u8", quality: "720p" },
        { url: "https://cdn.example/1080/index.m3u8", quality: "1080p" },
      ],
      subtitles: [
        {
          url: "https://subs.example/en-sdh.vtt",
          language: "English SDH",
          release: "SDH",
        },
        {
          file: "https://subs.example/en.vtt",
          language: "English",
          release: "Clean",
        },
        {
          href: "https://subs.example/es.vtt",
          lang: "spa",
          label: "Spanish",
        },
      ],
    },
    server: "mb-flix",
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: "1080p",
    protocol: "hls",
    container: "m3u8",
  });
  expect(result?.variants).toHaveLength(2);
  expect(result?.subtitles.map((subtitle) => subtitle.language)).toEqual(["en", "en", "es"]);
  expect(result?.subtitles[0]?.url).toBe("https://subs.example/en.vtt");
  expect(result?.trace.events?.map((event) => event.type)).toContain("variant:selected");
});

test("vidking direct resolver retries a failing source and preserves trace evidence", async () => {
  const events: unknown[] = [];
  let calls = 0;
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 2, backoff: "none" },
      emit: (event) => events.push(event),
      fetch: {
        runtime: "direct-http",
        fetch: async () => {
          calls += 1;
          return new Response("", { status: 504 });
        },
      },
    },
  );

  expect(calls).toBeGreaterThan(1);
  expect(result?.streams).toEqual([]);
  expect(result?.trace.events?.map((event) => event.type)).toContain("retry:scheduled");
  expect(result?.trace.events?.map((event) => event.type)).toContain("provider:exhausted");
  expect(result?.trace.failures[0]).toMatchObject({
    providerId: "vidking",
    code: "timeout",
    retryable: true,
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "retry:scheduled",
      providerId: "vidking",
      attempt: 2,
    }),
  );
});

test("vidking direct resolver can target a flavored endpoint without broad server probing", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: "de",
      preferredPresentation: "raw",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-01T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          requestedUrls.push(String(input));
          return new Response("", { status: 504 });
        },
      },
    },
    {
      serverEndpoint: "meine",
      language: "german",
      flavorLabel: "Killjoy",
      flavorArchetype: "Cineby flavors",
    },
  );

  expect(requestedUrls.every((url) => url.includes("/meine/sources-with-title?"))).toBe(true);
  expect(requestedUrls[0]).toContain("language=german");
  expect(result?.trace.events?.map((event) => event.type)).toEqual(
    expect.arrayContaining(["source:start", "source:failed", "provider:exhausted"]),
  );
  expect(result?.sources?.[0]).toMatchObject({
    id: "source:vidking:videasy:meine",
    label: "Killjoy",
    metadata: { server: "meine", flavorArchetype: "Cineby flavors" },
  });
});

test("vidking payload filtering keeps localized flavored sources explicit", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: "hi",
      preferredPresentation: "raw",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/original.m3u8", quality: "Original 1080p" },
        { url: "https://cdn.example/hindi.m3u8", quality: "Hindi 1080p" },
      ],
    },
    sourceQualityFilter: "Hindi",
    server: "hdmovie",
  });

  expect(result?.streams).toHaveLength(1);
  expect(result?.streams[0]?.url).toBe("https://cdn.example/hindi.m3u8");
  expect(result?.streams[0]?.metadata?.flavorFilter).toBe("Hindi");
});

test("vidking evidence fixture preserves native server labels beside ISO audio language", async () => {
  const payload = await readFixture<
    Parameters<typeof createVidkingResultFromPayload>[0]["payload"]
  >("vidking/source-payload.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly nativeLanguageLabel: string;
    readonly normalizedLanguage: string;
    readonly sourceHost: string;
    readonly quality: string;
  }>("vidking/expected-normalized.json");
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      preferredAudioLanguage: expected.normalizedLanguage,
      preferredPresentation: "raw",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    payload,
    sourceQualityFilter: expected.nativeLanguageLabel,
    server: expected.serverLabel,
  });

  expect(result?.sources?.[0]).toMatchObject({
    label: expected.serverLabel,
    sourceEvidence: [
      expect.objectContaining({
        nativeLabel: expected.serverLabel,
        host: expected.sourceHost,
      }),
    ],
  });
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: normalizeQualityLabel(expected.quality),
    audioLanguages: [expected.normalizedLanguage],
    languageEvidence: [
      expect.objectContaining({
        nativeLabel: expected.nativeLanguageLabel,
        normalizedLanguage: expected.normalizedLanguage,
      }),
    ],
  });
  expect(result?.variants?.[0]?.languageEvidence).toEqual(result?.streams[0]?.languageEvidence);
});

test("rivestream evidence fixture preserves provider server label and normalized language", async () => {
  const services = await readFixture<unknown>("rivestream/services-response.json");
  const source = await readFixture<unknown>("rivestream/source-response.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly nativeLanguageLabel: string;
    readonly normalizedLanguage: string;
    readonly subtitleLanguage: string;
    readonly sourceHost: string;
    readonly quality: string;
  }>("rivestream/expected-normalized.json");
  const requests: string[] = [];
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
        year: 2021,
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          requests.push(url);
          return jsonResponse(url.includes("VideoProviderServices") ? services : source);
        },
      },
    },
  );

  expect(requests.some((url) => url.includes("VideoProviderServices"))).toBe(true);
  expect(result.status).toBe("resolved");
  expect(result.trace.events?.map((event) => event.type)).toEqual(
    expect.arrayContaining(["source:start", "source:success", "provider:success"]),
  );
  expect(result.sources?.[0]).toMatchObject({
    label: expected.serverLabel,
    sourceEvidence: [
      expect.objectContaining({
        nativeLabel: expected.serverLabel,
        host: expected.sourceHost,
      }),
    ],
  });
  expect(result.streams[0]).toMatchObject({
    qualityLabel: normalizeQualityLabel(expected.quality),
    audioLanguages: [expected.normalizedLanguage],
    languageEvidence: [
      expect.objectContaining({
        nativeLabel: expected.nativeLanguageLabel,
        normalizedLanguage: expected.normalizedLanguage,
      }),
    ],
  });
  expect(result.subtitles[0]?.language).toBe(expected.subtitleLanguage);
});

test("miruro evidence fixture preserves server evidence subtitles and seek thumbnails", async () => {
  const sourceData = await readFixture<
    Parameters<typeof createMiruroResultFromPayload>[0]["sourceData"]
  >("miruro/source-response.json");
  const expected = await readFixture<{
    readonly serverLabel: string;
    readonly serverId: "kiwi" | "bee";
    readonly audioLanguage: string;
    readonly hardSubLanguage: string;
    readonly presentation: "sub" | "dub";
    readonly subtitleLanguage: string;
    readonly seekBarVttUrl: string;
  }>("miruro/expected-normalized.json");

  const result = createMiruroResultFromPayload({
    input: {
      title: {
        id: "anilist:999",
        anilistId: "999",
        kind: "anime",
        title: "Evidence Fox",
      },
      episode: { episode: 1 },
      mediaKind: "anime",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    sourceData,
    audioCategory: expected.presentation,
    serverProfile: {
      id: expected.serverId,
      label: expected.serverLabel,
      subtitleDelivery: "hardcoded",
      hardSubLanguage: expected.hardSubLanguage,
    },
    context: { now: () => "2026-05-19T00:00:00.000Z" },
  });

  expect(result?.status).toBe("resolved");
  expect(result?.artwork?.seekBarVttUrl).toBe(expected.seekBarVttUrl);
  expect(result?.sources?.[0]).toMatchObject({
    label: expect.stringContaining(expected.serverLabel),
    artwork: { seekBarVttUrl: expected.seekBarVttUrl },
    sourceEvidence: [
      expect.objectContaining({
        serverId: expected.serverId,
        nativeLabel: expected.serverLabel,
      }),
    ],
  });
  expect(result?.streams[0]).toMatchObject({
    audioLanguages: [expected.audioLanguage],
    hardSubLanguage: expected.hardSubLanguage,
    presentation: expected.presentation,
    artwork: { seekBarVttUrl: expected.seekBarVttUrl },
  });
  expect(result?.subtitles[0]?.language).toBe(expected.subtitleLanguage);
});

test("miruro source cycling orders preferred subtitle delivery before fallback audio", () => {
  const candidates = buildMiruroCycleCandidates({
    episodes: {
      sub: [{ id: "sub-1", number: 1 }],
      dub: [{ id: "dub-1", number: 1 }],
    },
    episodeNum: 1,
    targetAudio: "dub",
    fallbackAudio: "sub",
    preferredSubtitleDelivery: "embedded",
  });

  expect(candidates.map((candidate) => candidate.label)).toEqual([
    "Dub · Bee softsub · soft sub",
    "Dub · Kiwi hardsub · hard sub",
    "Sub · Bee softsub · soft sub",
    "Sub · Kiwi hardsub · hard sub",
  ]);
  expect(candidates.map((candidate) => candidate.normalizedAudioLanguage)).toEqual([
    "en",
    "en",
    "ja",
    "ja",
  ]);
});

test("miruro episode lookup preserves network failures as provider evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("ConnectionRefused");
  }) as unknown as typeof fetch;

  try {
    await expect(getMiruroEpisodesResponse("999001")).rejects.toThrow(
      "Miruro pipe network request failed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("negative fixture maps blocked vidking host to structured failure", async () => {
  const blocked = await readFixture<{ readonly status: number; readonly body: unknown }>(
    "negative/vidking-blocked.json",
  );
  const result = await resolveVidkingDirect(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      retryPolicy: { maxAttempts: 1, backoff: "none" },
      fetch: {
        runtime: "direct-http",
        fetch: async () => jsonResponse(blocked.body, blocked.status),
      },
    },
    { serverEndpoint: "blocked" },
  );

  expect(result?.status).toBe("exhausted");
  expect(result?.failures[0]).toMatchObject({
    code: "blocked",
    retryable: false,
  });
  expect(result?.trace.events?.map((event) => event.type)).toContain("provider:exhausted");
});

test("negative fixture keeps rivestream parse failures inspectable", async () => {
  const services = await readFixture<unknown>("negative/rivestream-services-response.json");
  const malformed = await readTextFixture("negative/rivestream-parse-missing.txt");
  const result = await rivestreamProviderModule.resolve(
    {
      title: {
        id: "438631",
        tmdbId: "438631",
        kind: "movie",
        title: "Dune",
      },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("VideoProviderServices")) return jsonResponse(services);
          return new Response(malformed, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    },
  );

  expect(result.status).toBe("exhausted");
  expect(result.failures[0]).toMatchObject({
    code: "parse-failed",
    retryable: false,
  });
  expect(result.trace.failures[0]?.code).toBe("parse-failed");
});

test("m3u8 quality extraction exposes sorted playable variants", async () => {
  const streams = await extractQualitiesFromMaster(
    {
      runtime: "direct-http",
      fetch: async () =>
        new Response(
          [
            "#EXTM3U",
            '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,NAME="720p"',
            "720/index.m3u8",
            "#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1920x1080",
            "https://cdn.example/1080/index.m3u8",
          ].join("\n"),
        ),
    },
    "https://cdn.example/master.m3u8",
    {
      providerId: "vidking",
      protocol: "hls",
      container: "m3u8",
      confidence: 0.9,
      cachePolicy: {
        ttlClass: "stream-manifest",
        scope: "local",
        keyParts: ["provider", "vidking", "qualities"],
      },
    },
  );

  expect(streams.map((stream) => stream.qualityLabel)).toEqual(["1080p", "720p"]);
  expect(streams[1]?.url).toBe("https://cdn.example/720/index.m3u8");
});

test("variant tree builder creates stable grouped variant ordering", () => {
  const variants = new VariantTreeBuilder({
    providerId: "miruro",
    sourceId: "source:miruro:pipe",
  })
    .addVariant({
      label: "Dub 720p",
      presentation: "dub",
      subtitleDelivery: "embedded",
      qualityLabel: "720p",
      qualityRank: 720,
      streamIds: ["stream-dub-720"],
      confidence: 0.8,
    })
    .addVariant({
      label: "Sub 1080p",
      presentation: "sub",
      subtitleDelivery: "hardcoded",
      qualityLabel: "1080p",
      qualityRank: 1080,
      streamIds: ["stream-sub-1080"],
      confidence: 0.9,
    })
    .build();

  expect(variants.map((variant) => variant.label)).toEqual(["Sub 1080p", "Dub 720p"]);
  expect(variants[0]?.id.startsWith("var_")).toBe(true);
});

test("source inventory helpers create stable ids and provider evidence", () => {
  const first = stableProviderInventoryId({
    prefix: "source",
    parts: ["vidking", "Kiwi", "https://cdn.example/1080/index.m3u8"],
  });
  const second = stableProviderInventoryId({
    prefix: "source",
    parts: ["vidking", "Kiwi", "https://cdn.example/1080/index.m3u8"],
  });

  expect(first).toBe(second);
  expect(first.startsWith("source_")).toBe(true);
  expect(
    createStreamId("vidking", ["https://cdn.example/1080/index.m3u8"]).startsWith("stream_"),
  ).toBe(true);
  expect(parseSourceHost("https://cdn.example/1080/index.m3u8")).toBe("cdn.example");
  expect(parseSourceHost("not a url")).toBeUndefined();
  expect(normalizeQualityLabel("Full HD")).toBe("1080p");
  expect(normalizeQualityLabel("4K")).toBe("2160p");
  expect(qualityRankFromLabel("720p")).toBe(720);
  expect(qualityRankFromLabel("auto")).toBeUndefined();
  expect(normalizeProviderDisplayLabel("mb-flix")).toBe("MB Flix");
  expect(normalizeProviderDisplayLabel("primevids")).toBe("PrimeVids");
  expect(normalizeProviderDisplayLabel("flow_cast")).toBe("Flow Cast");

  expect(
    createProviderSourceEvidence({
      sourceId: "source:vidking:kiwi",
      serverId: "kiwi",
      nativeLabel: "kiwi",
      url: "https://kiwi.example/master.m3u8",
    }),
  ).toMatchObject({
    sourceId: "source:vidking:kiwi",
    serverId: "kiwi",
    nativeLabel: "kiwi",
    host: "kiwi.example",
  });

  const providerAliasEvidence = createProviderLanguageEvidence({
    role: "audio",
    nativeLabel: "HindiCast",
    sourceId: "source:vidking:hindi",
  });
  expect(providerAliasEvidence).toMatchObject({
    role: "audio",
    nativeLabel: "HindiCast",
    sourceId: "source:vidking:hindi",
  });
  expect(providerAliasEvidence.normalizedLanguage).toBeUndefined();
});

test("strict language normalizer keeps provider aliases out of public language fields", () => {
  expect(normalizeIsoLanguageCode("English CC")).toBe("en");
  expect(normalizeIsoLanguageCode("Portuguese (BR)")).toBe("pt");
  expect(normalizeIsoLanguageCode("pt-br")).toBe("pt");
  expect(normalizeIsoLanguageCode("Vietnamese")).toBe("vi");
  expect(normalizeIsoLanguageCode("Vietsub")).toBeUndefined();
  expect(normalizeIsoLanguageCode("HindiCast")).toBeUndefined();
  expect(normalizeIsoLanguageCode("killjoy")).toBeUndefined();
  expect(normalizeIsoLanguageCode("FlowCast")).toBeUndefined();
});

test("source inventory helpers project streams into source and variant candidates", () => {
  const stream = {
    id: "stream:vidking:1080",
    providerId: "vidking",
    sourceId: "source:vidking:kiwi",
    url: "https://kiwi.example/master.m3u8",
    protocol: "hls",
    container: "m3u8",
    presentation: "dub",
    audioLanguages: ["en"],
    qualityLabel: "1080p",
    qualityRank: 1080,
    serverName: "Kiwi",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: ["vidking", "kiwi"],
    },
    sourceEvidence: [
      createProviderSourceEvidence({
        sourceId: "source:vidking:kiwi",
        nativeLabel: "kiwi",
        url: "https://kiwi.example/master.m3u8",
      }),
    ],
    languageEvidence: [
      createProviderLanguageEvidence({
        role: "audio",
        value: "English",
        nativeLabel: "English",
      }),
    ],
  } as const;

  const source = createSourceCandidateFromStream({
    providerId: "vidking",
    stream,
    selected: true,
  });
  const variant = createVariantCandidateFromStream({
    providerId: "vidking",
    stream,
    selected: true,
  });

  expect(source).toMatchObject({
    id: "source:vidking:kiwi",
    label: "Kiwi",
    host: "kiwi.example",
    status: "selected",
  });
  expect(variant).toMatchObject({
    sourceId: "source:vidking:kiwi",
    label: "Dub 1080p",
    qualityRank: 1080,
    selected: true,
    streamIds: ["stream:vidking:1080"],
  });
});

test("allmanga source candidates preserve separate source families", () => {
  const sources = buildAllmangaSourceCandidates(
    [
      {
        id: "stream:hls:1080",
        providerId: "allanime",
        sourceId: "source:allanime:fm-hls",
        url: "https://cdn.example/hls.m3u8",
        protocol: "hls",
        confidence: 0.95,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
      {
        id: "stream:mp4:720",
        providerId: "allanime",
        sourceId: "source:allanime:vid-mp4",
        url: "https://cdn.example/720.mp4",
        protocol: "mp4",
        confidence: 0.85,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    "source:allanime:fm-hls",
    {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [],
    },
  );

  expect(sources.map((source) => source.id)).toEqual([
    "source:allanime:fm-hls",
    "source:allanime:vid-mp4",
  ]);
  expect(sources.map((source) => source.status)).toEqual(["selected", "available"]);
  expect(sources[0]?.metadata?.streamIds).toBe("stream:hls:1080");
});

async function readFixture<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(new URL(path, FIXTURE_BASE)).text()) as T;
}

async function readTextFixture(path: string): Promise<string> {
  return Bun.file(new URL(path, FIXTURE_BASE)).text();
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
