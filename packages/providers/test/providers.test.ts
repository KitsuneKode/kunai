import { expect, test } from "bun:test";

import { createProviderEngine } from "@kunai/core";

import {
  allmangaProviderModule,
  buildAllmangaSourceCandidates,
  createVidkingResultFromPayload,
  extractQualitiesFromMaster,
  getProviderMigrationQueue,
  getProviderResearchProfile,
  miruroProviderModule,
  providerResearchProfiles,
  resolveVidkingDirect,
  rivestreamProviderModule,
  VariantTreeBuilder,
  vidkingProviderModule,
} from "../src/index";

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
