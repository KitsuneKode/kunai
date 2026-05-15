import { expect, test } from "bun:test";

import {
  providerFailureSchema,
  providerHealthSchema,
  providerSourceCandidateSchema,
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
