import { expect, test } from "bun:test";

import {
  assertRuntimeAllowed,
  assertManifestHasRuntimePort,
  buildVidkingEmbedUrl,
  createProviderCachePolicy,
  createProviderRuntimeContext,
  createProviderTraceEvent,
  createProviderEngine,
  defineProviderManifest,
  DEFAULT_PROVIDER_RETRY_POLICY,
  ProviderResolveFailureError,
  resolveWithFallback,
  type CoreProviderModule,
} from "../src/index";

const allanimeManifest = defineProviderManifest({
  id: "allanime",
  displayName: "AllManga",
  description: "Test",
  domain: "allmanga.to",
  recommended: false,
  mediaKinds: ["anime", "series"],
  capabilities: ["search", "episode-list", "source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
  browserSafe: false,
  relaySafe: false,
});

const miruroManifest = defineProviderManifest({
  id: "miruro",
  displayName: "Miruro",
  description: "Test",
  domain: "miruro.tv",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
  browserSafe: true,
  relaySafe: true,
  status: "candidate",
});

const rivestreamManifest = defineProviderManifest({
  id: "rivestream",
  displayName: "Rivestream",
  description: "Test",
  domain: "rivestream.app",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: false,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
  browserSafe: false,
  relaySafe: true,
  status: "candidate",
});

const vidkingManifest = defineProviderManifest({
  id: "vidking",
  displayName: "VidKing",
  description: "Test",
  domain: "videasy.net",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream"],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
  browserSafe: false,
  relaySafe: false,
});

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

test("vidking embed URL builder preserves direct-provider route shape", () => {
  expect(buildVidkingEmbedUrl({ id: "438631", mediaKind: "movie" })).toBe(
    "https://www.vidking.net/embed/movie/438631?autoPlay=true",
  );
  expect(buildVidkingEmbedUrl({ id: "1396", mediaKind: "series", season: 1, episode: 5 })).toBe(
    "https://www.vidking.net/embed/tv/1396/1/5?autoPlay=true&episodeSelector=false&nextEpisode=false",
  );
});

test("vidking embed URL builder rejects incomplete series inputs", () => {
  expect(() => buildVidkingEmbedUrl({ id: "1396", mediaKind: "series", season: 1 })).toThrow(
    "VidKing requires season and episode",
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

test("resolveWithFallback returns the first successful provider and preserves attempts", async () => {
  const resolved = await resolveWithFallback<{
    url: string;
    providerResolveResult?: import("@kunai/types").ProviderResolveResult;
  }>({
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
          return { url: "https://cdn.example/master.m3u8" };
        },
      },
    ],
  });

  expect(resolved.providerId).toBe("second");
  expect(resolved.stream?.url).toContain("master.m3u8");
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

test("ProviderEngine falls back after a provider returns an exhausted empty result", async () => {
  const emptyProvider: CoreProviderModule = {
    providerId: "empty",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "empty",
      displayName: "Empty Provider",
    }),
    async resolve(input, context) {
      return {
        status: "exhausted",
        providerId: "empty",
        streams: [],
        subtitles: [],
        trace: {
          id: "trace:empty",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [
            {
              providerId: "empty",
              code: "not-found",
              message: "empty provider had no streams",
              retryable: true,
              at: context.now(),
            },
          ],
        },
        failures: [
          {
            providerId: "empty",
            code: "not-found",
            message: "empty provider had no streams",
            retryable: true,
            at: context.now(),
          },
        ],
        healthDelta: {
          providerId: "empty",
          outcome: "failure",
          at: context.now(),
        },
      };
    },
  };
  const goodProvider: CoreProviderModule = {
    providerId: "good",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "good",
      displayName: "Good Provider",
    }),
    async resolve(input, context) {
      return {
        status: "resolved",
        providerId: "good",
        selectedStreamId: "stream:good:1",
        streams: [
          {
            id: "stream:good:1",
            providerId: "good",
            url: "https://cdn.example/master.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:good",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
        healthDelta: {
          providerId: "good",
          outcome: "success",
          at: context.now(),
        },
      };
    },
  };
  const engine = createProviderEngine({
    modules: [emptyProvider, goodProvider],
    maxAttempts: 1,
    retryDelayMs: 0,
  });

  const resolved = await engine.resolveWithFallback(
    {
      title: { id: "123", kind: "movie", title: "Demo" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    ["empty", "good"],
  );

  expect(resolved.providerId).toBe("good");
  expect(resolved.result?.streams[0]?.url).toBe("https://cdn.example/master.m3u8");
  expect(resolved.attempts).toHaveLength(2);
  expect(resolved.attempts[0]?.failure).toMatchObject({
    providerId: "empty",
    code: "not-found",
    message: "empty provider had no streams",
  });
});

test("ProviderEngine retries retryable exhausted results before falling back", async () => {
  let primaryAttempts = 0;
  const flakyProvider: CoreProviderModule = {
    providerId: "flaky",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "flaky",
      displayName: "Flaky Provider",
    }),
    async resolve(input, context) {
      primaryAttempts += 1;
      if (primaryAttempts === 1) {
        return {
          status: "exhausted",
          providerId: "flaky",
          streams: [],
          subtitles: [],
          trace: {
            id: "trace:flaky:empty",
            startedAt: context.now(),
            title: input.title,
            cacheHit: false,
            steps: [],
            failures: [
              {
                providerId: "flaky",
                code: "network-error",
                message: "temporary upstream wobble",
                retryable: true,
                at: context.now(),
              },
            ],
          },
          failures: [
            {
              providerId: "flaky",
              code: "network-error",
              message: "temporary upstream wobble",
              retryable: true,
              at: context.now(),
            },
          ],
        };
      }

      return {
        status: "resolved",
        providerId: "flaky",
        selectedStreamId: "stream:flaky:1",
        streams: [
          {
            id: "stream:flaky:1",
            providerId: "flaky",
            url: "https://cdn.example/flaky.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:flaky:ok",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      };
    },
  };
  const fallbackProvider: CoreProviderModule = {
    providerId: "fallback",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "fallback",
      displayName: "Fallback Provider",
    }),
    async resolve(input, context) {
      return {
        status: "resolved",
        providerId: "fallback",
        selectedStreamId: "stream:fallback:1",
        streams: [
          {
            id: "stream:fallback:1",
            providerId: "fallback",
            url: "https://cdn.example/fallback.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:fallback",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      };
    },
  };
  const engine = createProviderEngine({
    modules: [flakyProvider, fallbackProvider],
    maxAttempts: 2,
    retryDelayMs: 0,
  });

  const resolved = await engine.resolveWithFallback(
    {
      title: { id: "123", kind: "movie", title: "Demo" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    ["flaky", "fallback"],
  );

  expect(resolved.providerId).toBe("flaky");
  expect(resolved.result?.selectedStreamId).toBe("stream:flaky:1");
  expect(primaryAttempts).toBe(2);
  expect(resolved.attempts).toHaveLength(1);
});

test("ProviderEngine does not retry or fallback when the network is offline", async () => {
  let primaryAttempts = 0;
  let fallbackAttempts = 0;
  const offlineProvider: CoreProviderModule = {
    providerId: "offline",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "offline",
      displayName: "Offline Provider",
    }),
    async resolve(input, context) {
      primaryAttempts += 1;
      const failure = {
        providerId: "offline" as const,
        code: "network-error" as const,
        message: "getaddrinfo ENOTFOUND api.example.test",
        retryable: true,
        at: context.now(),
      };
      return {
        status: "exhausted",
        providerId: "offline",
        streams: [],
        subtitles: [],
        trace: {
          id: "trace:offline",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [failure],
        },
        failures: [failure],
      };
    },
  };
  const fallbackProvider: CoreProviderModule = {
    providerId: "fallback",
    manifest: defineProviderManifest({
      ...vidkingManifest,
      id: "fallback",
      displayName: "Fallback Provider",
    }),
    async resolve(input, context) {
      fallbackAttempts += 1;
      return {
        status: "resolved",
        providerId: "fallback",
        selectedStreamId: "stream:fallback:1",
        streams: [
          {
            id: "stream:fallback:1",
            providerId: "fallback",
            url: "https://cdn.example/fallback.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:fallback",
          startedAt: context.now(),
          title: input.title,
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      };
    },
  };
  const engine = createProviderEngine({
    modules: [offlineProvider, fallbackProvider],
    maxAttempts: 3,
    retryDelayMs: 0,
  });

  const resolved = await engine.resolveWithFallback(
    {
      title: { id: "123", kind: "movie", title: "Demo" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    ["offline", "fallback"],
  );

  expect(resolved.result).toBeNull();
  expect(resolved.attempts).toHaveLength(1);
  expect(primaryAttempts).toBe(1);
  expect(fallbackAttempts).toBe(0);
  expect(resolved.attempts[0]?.failure).toMatchObject({
    code: "network-error",
    message: "getaddrinfo ENOTFOUND api.example.test",
  });
});
