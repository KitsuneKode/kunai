import { expect, test } from "bun:test";

import {
  allanimeManifest,
  adaptCliStreamResult,
  assertRuntimeAllowed,
  assertManifestHasRuntimePort,
  buildBitcineEmbedUrl,
  buildCinebyEmbedUrl,
  buildVidkingEmbedUrl,
  createProviderCachePolicy,
  createProviderRuntimeContext,
  createProviderTraceEvent,
  DEFAULT_PROVIDER_RETRY_POLICY,
  miruroManifest,
  ProviderResolveFailureError,
  rivestreamManifest,
  resolveWithFallback,
  vidkingManifest,
} from "../src/index";

test("vidking manifest declares capability, cache, and runtime boundaries", () => {
  expect(vidkingManifest.id).toBe("vidking");
  expect(vidkingManifest.mediaKinds).toContain("movie");
  expect(vidkingManifest.mediaKinds).toContain("series");
  expect(vidkingManifest.capabilities).toContain("source-resolve");
  expect(vidkingManifest.cachePolicy.ttlClass).toBe("stream-manifest");

  const directPort = assertManifestHasRuntimePort(vidkingManifest, "direct-http");
  expect(directPort.operations).toContain("resolve-stream");
  expect(directPort.localOnly).toBe(true);
  expect(directPort.browserSafe).toBe(false);

  expect(vidkingManifest.runtimePorts.map((port) => port.runtime)).toEqual(["direct-http"]);
});

test("provider embed URL builders preserve production playback routes", () => {
  expect(buildVidkingEmbedUrl({ id: "438631", mediaKind: "movie" })).toBe(
    "https://www.vidking.net/embed/movie/438631?autoPlay=true",
  );
  expect(buildVidkingEmbedUrl({ id: "1396", mediaKind: "series", season: 1, episode: 5 })).toBe(
    "https://www.vidking.net/embed/tv/1396/1/5?autoPlay=true&episodeSelector=false&nextEpisode=false",
  );

  expect(buildCinebyEmbedUrl({ id: "438631", mediaKind: "movie" })).toBe(
    "https://www.cineby.sc/movie/438631?play=true",
  );
  expect(buildCinebyEmbedUrl({ id: "1396", mediaKind: "series", season: 1, episode: 5 })).toBe(
    "https://www.cineby.sc/tv/1396/1/5?play=true",
  );

  expect(buildBitcineEmbedUrl({ id: "438631", mediaKind: "movie" })).toBe(
    "https://www.bitcine.net/movie/438631?play=true",
  );
  expect(buildBitcineEmbedUrl({ id: "1396", mediaKind: "series", season: 1, episode: 5 })).toBe(
    "https://www.bitcine.net/tv/1396/1/5?play=true",
  );
});

test("provider embed URL builders reject incomplete series inputs", () => {
  expect(() => buildVidkingEmbedUrl({ id: "1396", mediaKind: "series", season: 1 })).toThrow(
    "VidKing requires season and episode",
  );
  expect(() => buildCinebyEmbedUrl({ id: "1396", mediaKind: "series", episode: 5 })).toThrow(
    "Cineby requires season and episode",
  );
  expect(() => buildBitcineEmbedUrl({ id: "1396", mediaKind: "series" })).toThrow(
    "BitCine requires season and episode",
  );
});

test("active direct providers declare cache and runtime boundaries", () => {
  const manifests = [rivestreamManifest, vidkingManifest, allanimeManifest, miruroManifest];

  expect(manifests.map((manifest) => manifest.id)).toEqual([
    "rivestream",
    "vidking",
    "allanime",
    "miruro",
  ]);

  for (const manifest of manifests) {
    expect(manifest.cachePolicy.ttlClass).toBe("stream-manifest");
    expect(manifest.cachePolicy.keyParts).toContain("provider");
    expect(manifest.runtimePorts.length).toBeGreaterThan(0);
  }

  expect(vidkingManifest.status).toBe("production");
  expect(allanimeManifest.status).toBe("production");
  expect(rivestreamManifest.status).toBe("candidate");
  expect(miruroManifest.status).toBe("candidate");
});

test("anime manifests stay visible to CLI series mode while marked as anime-capable", () => {
  expect(allanimeManifest.mediaKinds).toContain("anime");
  expect(allanimeManifest.mediaKinds).toContain("series");
  expect(miruroManifest.mediaKinds).toContain("anime");
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

test("provider sdk helpers create runtime context and typed trace events", () => {
  const events: ReturnType<typeof createProviderTraceEvent>[] = [];
  const context = createProviderRuntimeContext({
    now: () => "2026-05-01T00:00:00.000Z",
    emit(event) {
      events.push(event);
    },
  });

  expect(context.retryPolicy).toEqual(DEFAULT_PROVIDER_RETRY_POLICY);

  context.emit?.(
    createProviderTraceEvent({
      now: context.now,
      type: "runtime:requested",
      providerId: "vidking",
      message: "Provider requested direct HTTP",
    }),
  );

  expect(events[0]).toMatchObject({
    type: "runtime:requested",
    at: "2026-05-01T00:00:00.000Z",
    providerId: "vidking",
  });
});

test("provider sdk helpers reject unavailable runtimes before provider work starts", () => {
  expect(() =>
    assertRuntimeAllowed({
      providerId: "vidking",
      runtime: "direct-http",
      allowedRuntimes: ["browser-safe-fetch"],
    }),
  ).toThrow("vidking requires direct-http");
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
      audioLanguage: "ja",
      hardSubLanguage: "en",
      subtitle: "https://cdn.example/en.vtt",
      subtitleList: [{ url: "https://cdn.example/en.vtt", language: "en", display: "English" }],
      subtitleSource: "provider",
    },
    cachePolicy,
    runtime: "direct-http",
    cacheHit: true,
  });

  expect(result.providerId).toBe("vidking");
  expect(result.streams[0]?.protocol).toBe("hls");
  expect(result.streams[0]?.audioLanguage).toBe("ja");
  expect(result.streams[0]?.hardSubLanguage).toBe("en");
  expect(result.subtitles[0]?.language).toBe("en");
  expect(result.trace.cacheHit).toBe(true);
  expect(result.trace.runtime).toBe("direct-http");
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
              runtime: "direct-http",
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

test("resolveWithFallback preserves typed provider failure errors", async () => {
  const resolved = await resolveWithFallback({
    candidates: [
      {
        providerId: "direct",
        preferred: true,
        async resolve() {
          throw new ProviderResolveFailureError({
            providerId: "direct",
            code: "provider-unavailable",
            message: "Direct provider returned no stream candidates",
            retryable: true,
            at: "2026-05-06T00:00:00.000Z",
          });
        },
      },
    ],
  });

  expect(resolved.stream).toBeNull();
  expect(resolved.attempts[0]?.failure).toMatchObject({
    providerId: "direct",
    code: "provider-unavailable",
    message: "Direct provider returned no stream candidates",
    retryable: true,
  });
});
