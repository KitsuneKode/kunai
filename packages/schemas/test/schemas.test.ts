import { expect, test } from "bun:test";

import {
  providerArtworkInfoSchema,
  providerExternalIdsSchema,
  providerFailureSchema,
  providerHealthSchema,
  providerLanguageEvidenceSchema,
  providerReleaseInfoSchema,
  providerSourceCandidateSchema,
  providerSourceInventorySchema,
  providerTraceEventSchema,
  providerVariantCandidateSchema,
  resolveTraceSchema,
  streamCandidateSchema,
} from "../src/index";

const cachePolicy = {
  ttlClass: "stream-manifest",
  ttlMs: 120_000,
  scope: "local",
  keyParts: ["vidking", "movie", "tmdb:1"],
} as const;

test("stream candidate schema accepts serialized cache-safe shape", () => {
  const parsed = streamCandidateSchema.parse({
    id: "stream-1",
    providerId: "vidking",
    url: "https://example.com/master.m3u8",
    protocol: "hls",
    container: "m3u8",
    presentation: "raw",
    subtitleDelivery: "external",
    flavorArchetype: "Cineby flavors",
    flavorLabel: "Neon",
    confidence: 0.92,
    cachePolicy,
  });

  expect(parsed.protocol).toBe("hls");
  expect(parsed.flavorLabel).toBe("Neon");
  expect(parsed.cachePolicy.ttlClass).toBe("stream-manifest");
});

test("provider metadata v2 schemas accept ids release artwork and language evidence", () => {
  const externalIds = providerExternalIdsSchema.parse({
    anilistId: "123",
    malId: "456",
    tmdbId: "789",
  });
  const release = providerReleaseInfoSchema.parse({
    airDate: "2026-05-19",
    availableAt: "2026-05-19T12:30:00.000Z",
    status: "released",
    providerConfirmed: true,
  });
  const artwork = providerArtworkInfoSchema.parse({
    posterUrl: "https://image.example/poster.jpg",
    seekBarVttUrl: "https://cdn.example/thumbs.vtt",
  });
  const languageEvidence = providerLanguageEvidenceSchema.parse({
    role: "audio",
    normalizedLanguage: "ja",
    nativeLabel: "Sub",
    confidence: 0.95,
  });

  const stream = streamCandidateSchema.parse({
    id: "stream-1",
    providerId: "allanime",
    url: "https://example.com/master.m3u8",
    protocol: "hls",
    presentation: "sub",
    languageEvidence: [languageEvidence],
    artwork,
    confidence: 0.92,
    cachePolicy,
  });

  expect(externalIds.malId).toBe("456");
  expect(release.providerConfirmed).toBe(true);
  expect(stream.languageEvidence?.[0]?.nativeLabel).toBe("Sub");
  expect(stream.artwork?.seekBarVttUrl).toContain("thumbs.vtt");
});

test("provider source and variant schemas model mirror inventory without forcing a rigid tree", () => {
  const source = providerSourceCandidateSchema.parse({
    id: "oxygen",
    providerId: "vidking",
    kind: "mirror",
    label: "Oxygen",
    status: "available",
    confidence: 0.88,
    requiresRuntime: "direct-http",
  });

  const variant = providerVariantCandidateSchema.parse({
    id: "oxygen-english-1080p",
    providerId: "vidking",
    sourceId: source.id,
    qualityLabel: "1080p",
    audioLanguages: ["en"],
    presentation: "dub",
    subtitleDelivery: "embedded",
    flavorLabel: "Bee softsub",
    subtitleLanguages: ["en", "es"],
    streamIds: ["stream-1"],
    confidence: 0.86,
  });

  expect(source.kind).toBe("mirror");
  expect(variant.subtitleLanguages).toContain("en");
  expect(variant.subtitleDelivery).toBe("embedded");
});

test("provider source inventory schema validates selected streams subtitles and artwork together", () => {
  const inventory = providerSourceInventorySchema.parse({
    providerId: "miruro",
    selectedStreamId: "stream-1",
    sources: [
      {
        id: "kiwi",
        providerId: "miruro",
        kind: "mirror",
        label: "Kiwi",
        status: "selected",
        confidence: 0.9,
      },
    ],
    streams: [
      {
        id: "stream-1",
        providerId: "miruro",
        sourceId: "kiwi",
        url: "https://example.com/master.m3u8",
        protocol: "hls",
        qualityLabel: "1080p",
        audioLanguages: ["ja"],
        subtitleLanguages: ["en"],
        confidence: 0.92,
        cachePolicy,
      },
    ],
    subtitles: [
      {
        id: "sub-en",
        providerId: "miruro",
        sourceId: "kiwi",
        url: "https://example.com/subs.vtt",
        language: "en",
        source: "provider",
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
      },
    ],
    artwork: { seekBarVttUrl: "https://example.com/seek.vtt" },
  });

  expect(inventory.selectedStreamId).toBe("stream-1");
  expect(inventory.streams[0]?.audioLanguages).toEqual(["ja"]);
  expect(inventory.subtitles[0]?.language).toBe("en");
  expect(inventory.artwork?.seekBarVttUrl).toContain("seek.vtt");
});

test("cache policy schema accepts provider metadata ttl class", () => {
  const parsed = streamCandidateSchema.parse({
    id: "stream-1",
    providerId: "allanime",
    protocol: "hls",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "provider-metadata",
      scope: "local",
      keyParts: ["provider", "allanime", "metadata"],
    },
  });

  expect(parsed.cachePolicy.ttlClass).toBe("provider-metadata");
});

test("provider trace event schema validates live retry and runtime events", () => {
  const event = providerTraceEventSchema.parse({
    type: "retry:scheduled",
    at: "2026-05-01T00:00:00.000Z",
    providerId: "vidking",
    sourceId: "oxygen",
    attempt: 2,
    message: "Retrying after timeout",
    attributes: { timeoutMs: 3000, retryable: true },
  });

  expect(event.type).toBe("retry:scheduled");
  expect(event.attributes?.timeoutMs).toBe(3000);
});

test("stream candidate schema rejects impossible confidence", () => {
  expect(() =>
    streamCandidateSchema.parse({
      id: "stream-1",
      providerId: "vidking",
      protocol: "hls",
      confidence: 2,
      cachePolicy,
    }),
  ).toThrow();
});

test("resolve trace schema validates provider failures", () => {
  const failure = providerFailureSchema.parse({
    providerId: "anikai",
    code: "blocked",
    message: "Cloudflare challenge blocked raw fetch",
    retryable: true,
    at: "2026-04-29T00:00:00.000Z",
  });

  const trace = resolveTraceSchema.parse({
    id: "trace-1",
    startedAt: "2026-04-29T00:00:00.000Z",
    title: {
      id: "anilist:1",
      kind: "anime",
      title: "Example",
    },
    cacheHit: false,
    steps: [],
    failures: [failure],
  });

  expect(trace.failures[0]?.code).toBe("blocked");
});

test("provider health schema keeps rates bounded", () => {
  expect(() =>
    providerHealthSchema.parse({
      providerId: "vidking",
      status: "healthy",
      checkedAt: "2026-04-29T00:00:00.000Z",
      recentFailureRate: 1.4,
    }),
  ).toThrow();
});
