import { expect, test } from "bun:test";

import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import type { ProviderEngine, ProviderEngineResolveOutput } from "@kunai/core";
import type {
  ProviderHealth,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
} from "@kunai/types";

const title = {
  id: "12345",
  type: "movie" as const,
  name: "Test Movie",
  year: "2025",
};

const stream = {
  url: "https://example.com/stream.m3u8",
  headers: {},
  subtitle: undefined,
  subtitleList: [],
  subtitleSource: "none" as const,
  subtitleEvidence: {
    directSubtitleObserved: false,
    wyzieSearchObserved: false,
    reason: "not-observed" as const,
  },
  title: "Test Movie",
  timestamp: Date.now(),
};

function createMemoryCache(value: typeof stream | null): CacheStore & { setKeys: string[] } {
  let stored: typeof stream | null = value;
  const setKeys: string[] = [];
  return {
    get: async () => stored,
    set: async (_key: string, val: unknown) => {
      setKeys.push(_key);
      stored = val as typeof stream;
    },
    setKeys,
    delete: async () => {
      stored = null;
    },
    clear: async () => {},
    prune: async () => {},
    ttl: () => 0,
  } as unknown as CacheStore & { setKeys: string[] };
}

function createMemoryProviderHealth(initial: ProviderHealth[] = []) {
  const stored = new Map(initial.map((health) => [health.providerId, health]));
  return {
    get: (providerId: ProviderId) => stored.get(providerId),
    set: (health: ProviderHealth) => {
      stored.set(health.providerId, health);
    },
    entries: () => Array.from(stored.values()),
  };
}

function createEmptyProviderResult(providerId: ProviderId): ProviderResolveResult {
  return {
    status: "exhausted",
    providerId,
    streams: [],
    subtitles: [],
    trace: {
      id: `trace:${providerId}`,
      startedAt: new Date().toISOString(),
      title: { id: "12345", kind: "movie", title: "Test Movie" },
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [],
  };
}

function createManifest(providerId: ProviderId, mediaKinds: readonly string[]) {
  return {
    id: providerId,
    displayName: providerId,
    aliases: [],
    description: providerId,
    domain: `${providerId}.example`,
    recommended: true,
    mediaKinds,
    capabilities: [],
    runtimePorts: [],
    cachePolicy: { ttlClass: "metadata", scope: "local", keyParts: [] },
    browserSafe: true,
    relaySafe: true,
    status: "production",
  };
}

function createMockEngine(
  resolveWithFallbackResult: ProviderEngineResolveOutput,
  options: {
    readonly modules?: readonly {
      readonly providerId: ProviderId;
      readonly manifest: ReturnType<typeof createManifest>;
    }[];
    readonly onCandidateIds?: (candidateIds: readonly ProviderId[]) => void;
    readonly onResolveInput?: (input: ProviderResolveInput) => void;
  } = {},
): ProviderEngine {
  return {
    modules: options.modules ?? [],
    get: () => undefined,
    getProviderIds: () => [],
    getManifest: (providerId: ProviderId) =>
      options.modules?.find((module) => module.providerId === providerId)?.manifest,
    resolve: async () => ({}) as ProviderResolveResult,
    resolveWithFallback: async (
      input: ProviderResolveInput,
      candidateIds: readonly ProviderId[],
    ) => {
      options.onResolveInput?.(input);
      options.onCandidateIds?.(candidateIds);
      return resolveWithFallbackResult;
    },
  } as unknown as ProviderEngine;
}

test("PlaybackResolveService returns cached stream without provider resolve", async () => {
  const cache = createMemoryCache(stream);
  const engine = createMockEngine({ result: null, providerId: null, attempts: [] });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.cacheStatus).toBe("hit");
  expect(result.stream?.cacheProvenance).toBe("cached");
});

test("PlaybackResolveService falls back to engine on cache miss", async () => {
  const cache = createMemoryCache(null);
  const fallbackStream = { ...stream, url: "https://fallback.example/stream.m3u8" };
  let observedResolveInput: ProviderResolveInput | null = null;
  const engine = createMockEngine(
    {
      result: {
        status: "resolved",
        providerId: "fallback" as ProviderId,
        streams: [
          {
            id: "stream:fallback:1",
            providerId: "fallback" as ProviderId,
            url: "https://fallback.example/stream.m3u8",
            protocol: "hls" as const,
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:1",
          startedAt: new Date().toISOString(),
          title: { id: "12345", kind: "movie", title: "Test Movie" },
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      },
      providerId: "fallback" as ProviderId,
      attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
    },
    {
      onResolveInput: (input) => {
        observedResolveInput = input;
      },
    },
  );
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    startupPriority: "fast",
    signal: new AbortController().signal,
  });

  expect(result.providerId).toBe("fallback");
  expect(result.stream).not.toBeNull();
  expect(result.stream!.url).toBe(fallbackStream.url);
  expect((observedResolveInput as ProviderResolveInput | null)?.startupPriority).toBe("fast");
});

test("PlaybackResolveService does not cache deferred media locators", async () => {
  const cache = createMemoryCache(null);
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "allanime" as ProviderId,
      streams: [
        {
          id: "stream:allanime:ak:1",
          providerId: "allanime" as ProviderId,
          deferredLocator: "allmanga-ak:test-locator",
          protocol: "dash" as const,
          container: "mpd" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:deferred",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "allanime" as ProviderId,
    attempts: [{ providerId: "allanime" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "anime",
    providerId: "allanime",
    audioPreference: "sub",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.stream?.deferredLocator).toBe("allmanga-ak:test-locator");
  expect(cache.setKeys).toHaveLength(0);
});

test("PlaybackResolveService reuses source inventory before a provider resolve", async () => {
  let providerCalls = 0;
  const inventory = {
    get: async (): Promise<ProviderResolveResult> => ({
      status: "resolved",
      providerId: "primary" as ProviderId,
      streams: [
        {
          id: "stream:inventory:1",
          providerId: "primary" as ProviderId,
          url: "https://inventory.example/stream.m3u8",
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "stream-manifest" as const,
            scope: "local" as const,
            keyParts: [],
          },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:inventory",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie" as const, title: "Test Movie" },
        cacheHit: true,
        steps: [],
        failures: [],
      },
      failures: [],
    }),
    set: async () => {},
    delete: async () => {},
  };
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    { onCandidateIds: () => (providerCalls += 1) },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: createMemoryCache(null),
    sourceInventory: inventory,
    streamHealthService: {
      check: async () => ({
        healthy: true,
        checked: true,
        strategy: "hls-manifest-get",
      }),
    } as never,
  });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.stream?.url).toBe("https://inventory.example/stream.m3u8");
  expect(providerCalls).toBe(0);
});

test("PlaybackResolveService resolves fresh when cached inventory lacks an explicit source choice", async () => {
  let providerCalls = 0;
  const inventory = {
    get: async (): Promise<ProviderResolveResult> => ({
      status: "resolved",
      providerId: "primary" as ProviderId,
      streams: [
        {
          id: "stream:inventory:other",
          sourceId: "source:other",
          providerId: "primary" as ProviderId,
          url: "https://inventory.example/other.m3u8",
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: {
            ttlClass: "stream-manifest" as const,
            scope: "local" as const,
            keyParts: [],
          },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:inventory",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie" as const, title: "Test Movie" },
        cacheHit: true,
        steps: [],
        failures: [],
      },
      failures: [],
    }),
    set: async () => {},
    delete: async () => {},
  };
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    { onCandidateIds: () => (providerCalls += 1) },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: createMemoryCache(null),
    sourceInventory: inventory,
  });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    selectedSourceId: "source:selected",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(providerCalls).toBe(1);
});

test("PlaybackResolveService records the classified primary failure when fallback succeeds", async () => {
  const failures: string[] = [];
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "fallback" as ProviderId,
      streams: [
        {
          id: "stream:fallback",
          providerId: "fallback" as ProviderId,
          url: "https://fallback.example/stream.m3u8",
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:fallback",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "fallback" as ProviderId,
    attempts: [
      {
        providerId: "primary" as ProviderId,
        failure: {
          providerId: "primary" as ProviderId,
          code: "parse-failed",
          message: "schema changed",
          retryable: true,
          at: new Date().toISOString(),
        },
      },
      { providerId: "fallback" as ProviderId, result: undefined },
    ],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: createMemoryCache(null),
    titleProviderHealth: {
      recordFailure: (_titleId, _providerId, _fallbackId, kind) =>
        failures.push(typeof kind === "string" ? kind : kind.errorClass),
      recordCleanSuccess: () => {},
    },
  });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(failures).toEqual(["parse"]);
});

test("PlaybackResolveService caches late valid user-navigation results without returning them", async () => {
  const cache = createMemoryCache(null);
  const controller = new AbortController();
  controller.abort();
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "primary" as ProviderId,
      streams: [
        {
          id: "stream:primary:1",
          providerId: "primary" as ProviderId,
          url: "https://late.example/stream.m3u8",
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:late",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "primary" as ProviderId,
    attempts: [{ providerId: "primary" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: controller.signal,
    cancellationReason: "user-navigation",
  });

  expect(result.stream).toBeNull();
  expect(cache.setKeys.length).toBe(1);
});

test("PlaybackResolveService records empty provider results as failed attempts", async () => {
  const emptyResult = {
    ...createEmptyProviderResult("primary" as ProviderId),
    failures: [
      {
        providerId: "primary" as ProviderId,
        code: "not-found" as const,
        message: "primary had no stream candidates",
        retryable: true,
        at: new Date().toISOString(),
      },
    ],
  };
  const engine = createMockEngine({
    result: null,
    providerId: null,
    attempts: [{ providerId: "primary" as ProviderId, result: emptyResult }],
  });
  const service = new PlaybackResolveService({ engine, cacheStore: createMemoryCache(null) });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.stream).toBeNull();
  const attempt = result.providerTimeline?.attempts[0];
  expect(attempt).toMatchObject({
    providerId: "primary",
    status: "failed",
    failureClass: "provider-empty",
    userSummary: "primary had no stream candidates",
  });
});

test("PlaybackResolveService reuses fresh cached stream without health check", async () => {
  const freshStream = { ...stream, timestamp: Date.now() };
  const cache = createMemoryCache(freshStream);
  let providerCalls = 0;
  let healthCalls = 0;
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    { onCandidateIds: () => (providerCalls += 1) },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async () => {
      healthCalls += 1;
      return true;
    },
  });

  const events: string[] = [];
  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e.type),
  });

  expect(result.cacheStatus).toBe("hit");
  expect(result.stream?.cacheProvenance).toBe("cached");
  expect(events).toEqual(["cache-hit"]);
  expect(healthCalls).toBe(0);
  expect(providerCalls).toBe(0);
});

test("PlaybackResolveService force-validates fresh cached stream after suspected dead playback", async () => {
  const freshStream = {
    ...stream,
    timestamp: Date.now(),
    url: "https://cdn.example/fresh-but-dead.m3u8",
  };
  const cache = createMemoryCache(freshStream);
  const fallbackStream = { ...stream, url: "https://fallback.example/refetched.m3u8" };
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "fallback" as ProviderId,
      streams: [
        {
          id: "stream:fallback:1",
          providerId: "fallback" as ProviderId,
          url: fallbackStream.url,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:1",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "fallback" as ProviderId,
    attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async (url) => {
      expect(url).toBe(freshStream.url);
      return false;
    },
  });

  const events: string[] = [];
  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    forceHealthCheck: true,
    onEvent: (e) => events.push(e.type),
  });

  expect(events).toEqual([
    "cache-health-check",
    "cache-stale",
    "cache-miss",
    "recovery-decision",
    "provider-resolve-started",
    "attempt",
  ]);
  expect(result.cacheStatus).toBe("miss");
  expect(result.cacheProvenance).toBe("refetched");
  expect(result.stream?.url).toBe(fallbackStream.url);
});

test("PlaybackResolveService can try a fresh source without deleting a playable cached fallback", async () => {
  const cachedStream = {
    ...stream,
    timestamp: Date.now(),
    url: "https://cdn.example/current-playable.m3u8",
  };
  const cache = createMemoryCache(cachedStream);
  let providerCalled = false;
  const engine = createMockEngine(
    {
      result: null,
      providerId: null,
      attempts: [
        {
          providerId: "vidking" as ProviderId,
          failure: {
            providerId: "vidking" as ProviderId,
            code: "not-found",
            message: "No fresher source",
            retryable: true,
            at: new Date().toISOString(),
          },
        },
      ],
    },
    {
      onCandidateIds: () => {
        providerCalled = true;
      },
    },
  );
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const events: string[] = [];
  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    preferFreshStream: true,
    preserveCachedStreamOnFreshFailure: true,
    onEvent: (e) => events.push(e.type),
  });

  expect(providerCalled).toBe(true);
  expect(events).toContain("fresh-source-failed-using-cache");
  expect(result.cacheStatus).toBe("hit");
  expect(result.cacheProvenance).toBe("cached");
  expect(result.stream?.url).toBe(cachedStream.url);
});

test("PlaybackResolveService validates stale cached stream and returns it when healthy", async () => {
  const staleStream = {
    ...stream,
    timestamp: Date.now() - 3 * 60 * 60 * 1000, // 3 hours old
    url: "https://cdn.example/healthy.m3u8",
  };
  const cache = createMemoryCache(staleStream);
  const engine = createMockEngine({ result: null, providerId: null, attempts: [] });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async (url, headers) => {
      expect(url).toBe(staleStream.url);
      expect(headers).toEqual(staleStream.headers);
      return true;
    },
  });

  const events: string[] = [];
  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e.type),
  });

  expect(events).toEqual(["cache-health-check", "cache-hit-validated"]);
  expect(result.cacheStatus).toBe("hit");
  expect(result.stream?.cacheProvenance).toBe("revalidated");
});

test("PlaybackResolveService deletes stale cache and refetches when validation fails", async () => {
  const staleStream = {
    ...stream,
    timestamp: Date.now() - 3 * 60 * 60 * 1000, // 3 hours old
    url: "https://cdn.example/dead.m3u8",
  };
  const cache = createMemoryCache(staleStream);
  const fallbackStream = { ...stream, url: "https://fallback.example/stream.m3u8" };
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "fallback" as ProviderId,
      streams: [
        {
          id: "stream:fallback:1",
          providerId: "fallback" as ProviderId,
          url: fallbackStream.url,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:1",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "fallback" as ProviderId,
    attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async () => false,
  });

  const events: string[] = [];
  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e.type),
  });

  // Should have attempted validation, then fallen through to refetch
  expect(events).toContain("cache-stale");
  expect(result.cacheStatus).toBe("miss");
  expect(result.stream?.url).toBe(fallbackStream.url);
});

test("PlaybackResolveService filters fallback providers by media kind and down health", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const providerHealth = createMemoryProviderHealth([
    {
      providerId: "anime-down" as ProviderId,
      status: "down",
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 5,
    },
  ]);
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    {
      modules: [
        {
          providerId: "primary" as ProviderId,
          manifest: createManifest("primary" as ProviderId, ["anime"]),
        },
        {
          providerId: "anime-ok" as ProviderId,
          manifest: createManifest("anime-ok" as ProviderId, ["anime"]),
        },
        {
          providerId: "series-only" as ProviderId,
          manifest: createManifest("series-only" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "anime-down" as ProviderId,
          manifest: createManifest("anime-down" as ProviderId, ["anime"]),
        },
      ],
      onCandidateIds: (candidateIds) => observedCandidates.push([...candidateIds]),
    },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    providerHealth: providerHealth as never,
  });

  await service.resolve({
    title: { ...title, type: "series" },
    episode: { season: 1, episode: 2 },
    mode: "anime",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(observedCandidates).toEqual([["primary", "anime-ok"]]);
});

test("PlaybackResolveService keeps primary first despite title health suggestion", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const engine = createMockEngine(
    {
      result: {
        status: "resolved",
        providerId: "fallback" as ProviderId,
        streams: [
          {
            id: "stream:fallback:1",
            providerId: "fallback" as ProviderId,
            url: "https://fallback.example/stream.m3u8",
            protocol: "hls" as const,
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:fallback",
          startedAt: new Date().toISOString(),
          title: { id: "12345", kind: "series", title: "Test Movie" },
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      },
      providerId: "fallback" as ProviderId,
      attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
    },
    {
      modules: [
        {
          providerId: "primary" as ProviderId,
          manifest: createManifest("primary" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "fallback" as ProviderId,
          manifest: createManifest("fallback" as ProviderId, ["series", "movie"]),
        },
      ],
      onCandidateIds: (candidateIds) => observedCandidates.push([...candidateIds]),
    },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    titleProviderHealth: {
      recordFailure: () => {},
      recordCleanSuccess: () => {},
      getSwitchSuggestion: () => ({
        providerId: "primary",
        suggestedProviderId: "fallback",
      }),
    },
  });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(observedCandidates).toEqual([["primary", "fallback"]]);
});

test("PlaybackResolveService guided mode caps provider fallbacks to one", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    {
      modules: [
        {
          providerId: "primary" as ProviderId,
          manifest: createManifest("primary" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "fallback-a" as ProviderId,
          manifest: createManifest("fallback-a" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "fallback-b" as ProviderId,
          manifest: createManifest("fallback-b" as ProviderId, ["series", "movie"]),
        },
      ],
      onCandidateIds: (candidateIds) => observedCandidates.push([...candidateIds]),
    },
  );
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(observedCandidates).toEqual([["primary", "fallback-a"]]);
});

test("PlaybackResolveService manual recovery mode does not auto-fallback", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const engine = createMockEngine(
    { result: null, providerId: null, attempts: [] },
    {
      modules: [
        {
          providerId: "primary" as ProviderId,
          manifest: createManifest("primary" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "fallback" as ProviderId,
          manifest: createManifest("fallback" as ProviderId, ["series", "movie"]),
        },
      ],
      onCandidateIds: (candidateIds) => observedCandidates.push([...candidateIds]),
    },
  );
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    recoveryMode: "manual",
    signal: new AbortController().signal,
  });

  expect(observedCandidates).toEqual([["primary"]]);
});

test("PlaybackResolveService persists consecutive provider failures before marking down", async () => {
  const cache = createMemoryCache(null);
  const now = new Date().toISOString();
  const providerHealth = createMemoryProviderHealth();
  const engine = createMockEngine({
    result: null,
    providerId: null,
    attempts: [
      {
        providerId: "primary" as ProviderId,
        result: {
          ...createEmptyProviderResult("primary" as ProviderId),
          healthDelta: {
            providerId: "primary" as ProviderId,
            outcome: "failure",
            resolveMs: 100,
            at: now,
          },
        },
      },
    ],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    providerHealth: providerHealth as never,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await service.resolve({
      title,
      episode: { season: 1, episode: 2 },
      mode: "series",
      providerId: "primary",
      audioPreference: "original",
      subtitlePreference: "none",
      signal: new AbortController().signal,
    });
  }

  const health = providerHealth.get("primary" as ProviderId);
  expect(health?.consecutiveFailures).toBe(5);
  expect(health?.status).toBe("down");
});

test("PlaybackResolveService does not poison provider health for offline network results", async () => {
  const providerHealth = createMemoryProviderHealth();
  const offlineResult = {
    ...createEmptyProviderResult("primary" as ProviderId),
    failures: [
      {
        providerId: "primary" as ProviderId,
        code: "network-error" as const,
        message: "getaddrinfo ENOTFOUND provider.example",
        retryable: false,
        at: new Date().toISOString(),
      },
    ],
    healthDelta: {
      providerId: "primary" as ProviderId,
      outcome: "failure" as const,
      at: new Date().toISOString(),
    },
  };
  const engine = createMockEngine({
    result: null,
    providerId: null,
    attempts: [{ providerId: "primary" as ProviderId, result: offlineResult }],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: createMemoryCache(null),
    providerHealth: providerHealth as never,
  });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(providerHealth.get("primary" as ProviderId)).toBeUndefined();
});

test("PlaybackResolveService passes abort signal into stale cache health checks", async () => {
  const staleStream = {
    ...stream,
    timestamp: Date.now() - 3 * 60 * 60 * 1000,
    url: "https://cdn.example/slow-stale.m3u8",
  };
  const cache = createMemoryCache(staleStream);
  const engine = createMockEngine({ result: null, providerId: null, attempts: [] });
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async (_url, _headers, signal) => {
      observedSignal = signal;
      return true;
    },
  });

  await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: controller.signal,
  });

  expect(observedSignal).toBe(controller.signal);
});
