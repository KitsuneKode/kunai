import { expect, test } from "bun:test";

import {
  allanimeManifest,
  adaptCliStreamResult,
  assertManifestHasRuntimePort,
  bitcineManifest,
  braflixManifest,
  cinebyAnimeManifest,
  cinebyManifest,
  createProviderCachePolicy,
  resolveWithFallback,
  vidkingManifest,
} from "../src/index";

test("vidking manifest declares capability, cache, and runtime boundaries", () => {
  expect(vidkingManifest.id).toBe("vidking");
  expect(vidkingManifest.mediaKinds).toContain("movie");
  expect(vidkingManifest.mediaKinds).toContain("series");
  expect(vidkingManifest.capabilities).toContain("source-resolve");
  expect(vidkingManifest.cachePolicy.ttlClass).toBe("stream-manifest");

  const port = assertManifestHasRuntimePort(vidkingManifest, "playwright-lease");
  expect(port.localOnly).toBe(true);
  expect(port.browserSafe).toBe(false);
});

test("all production providers declare cache and runtime boundaries", () => {
  const manifests = [
    vidkingManifest,
    cinebyManifest,
    bitcineManifest,
    braflixManifest,
    allanimeManifest,
    cinebyAnimeManifest,
  ];

  expect(manifests.map((manifest) => manifest.id)).toEqual([
    "vidking",
    "cineby",
    "bitcine",
    "braflix",
    "allanime",
    "cineby-anime",
  ]);

  for (const manifest of manifests) {
    expect(manifest.cachePolicy.ttlClass).toBe("stream-manifest");
    expect(manifest.cachePolicy.keyParts).toContain("provider");
    expect(manifest.runtimePorts.length).toBeGreaterThan(0);
    expect(manifest.browserSafe).toBe(false);
  }
});

test("anime manifests stay visible to CLI series mode while marked as anime-capable", () => {
  expect(allanimeManifest.mediaKinds).toContain("anime");
  expect(allanimeManifest.mediaKinds).toContain("series");
  expect(cinebyAnimeManifest.mediaKinds).toContain("anime");
  expect(cinebyAnimeManifest.mediaKinds).toContain("series");
});

test("provider cache policy normalizes deterministic key parts", () => {
  const policy = createProviderCachePolicy({
    providerId: "VidKing",
    title: { id: "TMDB 438631", kind: "movie" },
    subtitleLanguage: "English",
    qualityPreference: "1080p",
  });

  expect(policy.keyParts).toEqual([
    "provider",
    "vidking",
    "movie",
    "tmdb-438631",
    "none",
    "none",
    "none",
    "english",
    "1080p",
  ]);
  expect(policy.allowStale).toBe(true);
});

test("cli stream adapter returns shared provider resolve result with trace evidence", () => {
  const cachePolicy = createProviderCachePolicy({
    providerId: "vidking",
    title: { id: "438631", kind: "movie" },
  });

  const result = adaptCliStreamResult({
    providerId: "vidking",
    title: { id: "438631", kind: "movie", title: "Dune" },
    stream: {
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://vidking.net" },
      subtitle: "https://cdn.example/en.vtt",
      subtitleList: [{ url: "https://cdn.example/en.vtt", language: "en", display: "English" }],
      subtitleSource: "provider",
    },
    cachePolicy,
    runtime: "playwright-lease",
    cacheHit: true,
  });

  expect(result.providerId).toBe("vidking");
  expect(result.streams[0]?.protocol).toBe("hls");
  expect(result.subtitles[0]?.language).toBe("en");
  expect(result.trace.cacheHit).toBe(true);
  expect(result.trace.runtime).toBe("playwright-lease");
  expect(result.trace.steps.map((step) => step.stage)).toContain("runtime");
});

test("resolveWithFallback returns the first successful provider and preserves attempts", async () => {
  const resolved = await resolveWithFallback({
    candidates: [
      {
        providerId: "first",
        preferred: true,
        async resolve() {
          return null;
        },
      },
      {
        providerId: "second",
        async resolve() {
          return {
            url: "https://cdn.example/master.m3u8",
            providerResolveResult: adaptCliStreamResult({
              providerId: "second",
              title: { id: "1", kind: "movie", title: "Example" },
              stream: { url: "https://cdn.example/master.m3u8" },
              cachePolicy: createProviderCachePolicy({
                providerId: "second",
                title: { id: "1", kind: "movie" },
              }),
              runtime: "node-fetch",
            }),
          };
        },
      },
    ],
  });

  expect(resolved.providerId).toBe("second");
  expect(resolved.stream?.url).toContain("master.m3u8");
  expect(resolved.result?.providerId).toBe("second");
  expect(resolved.attempts.map((attempt) => attempt.providerId)).toEqual(["first", "second"]);
});

test("resolveWithFallback converts thrown provider errors into structured attempts", async () => {
  const resolved = await resolveWithFallback({
    now: () => "2026-04-30T00:00:00.000Z",
    candidates: [
      {
        providerId: "broken",
        preferred: true,
        async resolve() {
          throw new Error("provider exploded");
        },
      },
    ],
  });

  expect(resolved.stream).toBeNull();
  expect(resolved.attempts[0]?.failure).toMatchObject({
    providerId: "broken",
    code: "unknown",
    message: "provider exploded",
    retryable: true,
    at: "2026-04-30T00:00:00.000Z",
  });
});
