import { expect, test } from "bun:test";

import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import { StreamHealthService } from "@/services/playback/StreamHealthService";
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

test("PlaybackResolveService does not carry primary source selection into fallback cache keys", async () => {
  const cache = createMemoryCache(null);
  const fallbackResult: ProviderResolveResult = {
    status: "resolved",
    providerId: "fallback" as ProviderId,
    selectedStreamId: "stream:fallback",
    streams: [
      {
        id: "stream:fallback",
        providerId: "fallback" as ProviderId,
        sourceId: "source:fallback:flowcast",
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
  };
  const engine = createMockEngine({
    result: fallbackResult,
    providerId: "fallback" as ProviderId,
    attempts: [
      {
        providerId: "primary" as ProviderId,
        failure: {
          providerId: "primary" as ProviderId,
          code: "not-found",
          message: "primary had no streams",
          retryable: true,
          at: new Date().toISOString(),
        },
      },
      {
        providerId: "fallback" as ProviderId,
        result: fallbackResult,
      },
    ],
  });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    selectedSourceId: "source:primary:1movies",
    selectedStreamId: "stream:primary:1080",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.providerId).toBe("fallback");
  expect(cache.setKeys).toHaveLength(1);
  expect(cache.setKeys[0]).toContain("provider:fallback");
  expect(cache.setKeys[0]).toContain(":balanced:none:none");
  expect(cache.setKeys[0]).not.toContain("source:primary:1movies");
  expect(cache.setKeys[0]).not.toContain("stream:primary:1080");
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
      return url !== freshStream.url;
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
    "cache-health-check",
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

test("PlaybackResolveService skips a blocked cached stream during recovery", async () => {
  const blockedStream = {
    ...stream,
    timestamp: Date.now(),
    url: "https://cdn.example/dead-loop.m3u8",
  };
  const cache = createMemoryCache(blockedStream);
  const freshStreamUrl = "https://cdn.example/refetched-good.m3u8";
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "vidking" as ProviderId,
      streams: [
        {
          id: "stream:vidking:fresh",
          providerId: "vidking" as ProviderId,
          url: freshStreamUrl,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:fresh",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "vidking" as ProviderId,
    attempts: [{ providerId: "vidking" as ProviderId, result: undefined }],
  });
  const events: string[] = [];
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    blockedStreamUrls: [blockedStream.url],
    onEvent: (event) => events.push(event.type),
  });

  expect(events).toContain("cache-stale");
  expect(result.cacheStatus).toBe("miss");
  expect(result.stream?.url).toBe(freshStreamUrl);
});

test("PlaybackResolveService selects an alternate provider stream when the preferred URL is blocked", async () => {
  const blockedUrl = "https://cdn.example/repeated-dead.m3u8";
  const alternateUrl = "https://cdn.example/source-b.m3u8";
  const cache = createMemoryCache(null);
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "vidking" as ProviderId,
      selectedStreamId: "stream:vidking:dead",
      streams: [
        {
          id: "stream:vidking:dead",
          providerId: "vidking" as ProviderId,
          url: blockedUrl,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
        {
          id: "stream:vidking:alt",
          providerId: "vidking" as ProviderId,
          url: alternateUrl,
          protocol: "hls" as const,
          confidence: 0.8,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:alt",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "movie", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "vidking" as ProviderId,
    attempts: [{ providerId: "vidking" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    blockedStreamUrls: [blockedUrl],
  });

  expect(result.stream?.url).toBe(alternateUrl);
  expect(result.stream?.providerResolveResult?.selectedStreamId).toBe("stream:vidking:alt");
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
    streamHealth: async (url) => url !== staleStream.url,
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

test("PlaybackResolveService emits provider-health-skipped when down providers are excluded", async () => {
  const cache = createMemoryCache(null);
  const events: Array<{ type: string; providerId?: string }> = [];
  const feedback: string[] = [];
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
          providerId: "anime-down" as ProviderId,
          manifest: createManifest("anime-down" as ProviderId, ["anime"]),
        },
      ],
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
    onEvent: (event) => events.push(event),
    onFeedback: (payload) => {
      if (payload.note) feedback.push(payload.note);
    },
  });

  expect(events).toContainEqual(
    expect.objectContaining({
      type: "provider-health-skipped",
      providerId: "anime-down",
      effectiveStatus: "down",
    }),
  );
  expect(feedback.some((note) => note.includes("/reset-provider-health"))).toBe(true);
});

test("PlaybackResolveService reads provider priority at resolve time", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  let priority = {
    providerPriority: ["primary", "fallback-a", "fallback-b"],
    animeProviderPriority: [] as string[],
  };
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
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    getProviderPriority: () => priority,
  });

  const resolveInput = {
    title,
    episode: { season: 1, episode: 2 },
    mode: "series" as const,
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
  };

  await service.resolve({ ...resolveInput, signal: new AbortController().signal });
  priority = {
    providerPriority: ["primary", "fallback-b", "fallback-a"],
    animeProviderPriority: [],
  };
  await service.resolve({ ...resolveInput, signal: new AbortController().signal });

  expect(observedCandidates).toEqual([
    ["primary", "fallback-a", "fallback-b"],
    ["primary", "fallback-b", "fallback-a"],
  ]);
});

test("PlaybackResolveService sends refresh intent and ignores provider health on explicit recompute", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const observedResolveInputs: ProviderResolveInput[] = [];
  const engine = createMockEngine(
    {
      result: {
        status: "resolved",
        providerId: "fallback-down" as ProviderId,
        streams: [
          {
            id: "stream:fallback-down:1",
            providerId: "fallback-down" as ProviderId,
            url: "https://fallback-down.example/live.m3u8",
            protocol: "hls" as const,
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:recompute",
          startedAt: new Date().toISOString(),
          title: { id: "12345", kind: "series", title: "Test Movie" },
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      },
      providerId: "fallback-down" as ProviderId,
      attempts: [{ providerId: "fallback-down" as ProviderId, result: undefined }],
    },
    {
      modules: [
        {
          providerId: "primary" as ProviderId,
          manifest: createManifest("primary" as ProviderId, ["series", "movie"]),
        },
        {
          providerId: "fallback-down" as ProviderId,
          manifest: createManifest("fallback-down" as ProviderId, ["series", "movie"]),
        },
      ],
      onResolveInput: (input) => {
        observedResolveInputs.push(input);
      },
      onCandidateIds: (candidateIds) => {
        observedCandidates.push([...candidateIds]);
      },
    },
  );
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    providerHealth: createMemoryProviderHealth([
      {
        providerId: "fallback-down" as ProviderId,
        status: "down",
        checkedAt: "2026-05-28T00:00:00.000Z",
      },
    ]) as never,
  });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
    resolveIntent: "refresh",
    ignoreProviderHealth: true,
    ignoreTitleHealthSuggestion: true,
    recoveryMode: "fallback-first",
  });

  expect(observedResolveInputs[0]?.intent).toBe("refresh");
  expect(observedCandidates).toEqual([["primary", "fallback-down"]]);
  expect(result.providerId).toBe("fallback-down");
});

test("PlaybackResolveService skips a freshly resolved stream that fails preflight and tries fallback provider", async () => {
  const cache = createMemoryCache(null);
  const observedCandidates: ProviderId[][] = [];
  const resolvedByProvider = new Map<ProviderId, ProviderResolveResult>([
    [
      "primary" as ProviderId,
      {
        status: "resolved",
        providerId: "primary" as ProviderId,
        selectedStreamId: "stream:primary:dead",
        streams: [
          {
            id: "stream:primary:dead",
            providerId: "primary" as ProviderId,
            url: "https://primary.example/dead.m3u8",
            protocol: "hls" as const,
            confidence: 0.9,
            cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace:primary",
          startedAt: new Date().toISOString(),
          title: { id: "12345", kind: "series", title: "Test Movie" },
          cacheHit: false,
          steps: [],
          failures: [],
        },
        failures: [],
      },
    ],
    [
      "fallback" as ProviderId,
      {
        status: "resolved",
        providerId: "fallback" as ProviderId,
        selectedStreamId: "stream:fallback:live",
        streams: [
          {
            id: "stream:fallback:live",
            providerId: "fallback" as ProviderId,
            url: "https://fallback.example/live.m3u8",
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
    ],
  ]);
  const engine = {
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
    get: () => undefined,
    getProviderIds: () => [],
    getManifest: (providerId: ProviderId) =>
      createManifest(
        providerId,
        providerId === "primary" || providerId === "fallback" ? ["series", "movie"] : [],
      ),
    resolve: async () => ({}) as ProviderResolveResult,
    resolveWithFallback: async (
      _input: ProviderResolveInput,
      candidateIds: readonly ProviderId[],
    ) => {
      observedCandidates.push([...candidateIds]);
      const providerId = candidateIds[0] as ProviderId | undefined;
      const result = providerId ? resolvedByProvider.get(providerId) : undefined;
      return {
        result: result ?? null,
        providerId: result ? providerId : null,
        attempts: providerId && result ? [{ providerId, result }] : [],
      };
    },
  } as unknown as ProviderEngine;
  const healthChecks: string[] = [];
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealth: async (url) => {
      healthChecks.push(url);
      return !url.includes("dead");
    },
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

  expect(observedCandidates).toEqual([["primary", "fallback"], ["fallback"]]);
  expect(healthChecks).toEqual([
    "https://primary.example/dead.m3u8",
    "https://fallback.example/live.m3u8",
  ]);
  expect(result.providerId).toBe("fallback");
  expect(result.stream?.url).toBe("https://fallback.example/live.m3u8");
  expect(result.attempts).toEqual([
    expect.objectContaining({
      providerId: "primary",
      stream: null,
      failure: expect.objectContaining({ code: "expired" }),
    }),
    expect.objectContaining({
      providerId: "fallback",
      stream: expect.objectContaining({ url: "https://fallback.example/live.m3u8" }),
      failure: undefined,
    }),
  ]);
  expect(result.providerTimeline?.status).toBe("recovered");
  expect(cache.setKeys).toHaveLength(1);
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

test("PlaybackResolveService guided mode walks full configured provider priority", async () => {
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

  expect(observedCandidates).toEqual([["primary", "fallback-a", "fallback-b"]]);
});

test("PlaybackResolveService skips duplicate health check when provider attested reachability", async () => {
  const cache = createMemoryCache(null);
  let probeCalls = 0;
  const verifiedUrl = "https://cdn.example/verified.m3u8";
  const engine = createMockEngine({
    result: {
      status: "resolved",
      providerId: "vidking" as ProviderId,
      selectedStreamId: "stream:vidking:1",
      streamReachabilityVerified: true,
      streams: [
        {
          id: "stream:vidking:1",
          providerId: "vidking" as ProviderId,
          url: verifiedUrl,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:1",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "series", title: "Test Movie" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "vidking" as ProviderId,
    attempts: [{ providerId: "vidking" as ProviderId, result: undefined }],
  });
  const service = new PlaybackResolveService({
    engine,
    cacheStore: cache,
    streamHealthService: new StreamHealthService({
      fetchImpl: async () => {
        probeCalls += 1;
        return new Response("", { status: 404 });
      },
    }),
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

  expect(result.stream?.url).toBe(verifiedUrl);
  expect(probeCalls).toBe(0);
  expect(events).not.toContain("cache-health-check");
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

test("PlaybackResolveService stops a stalling provider fan-out at its total deadline", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const engine = {
    modules: [
      {
        providerId: "primary" as ProviderId,
        manifest: createManifest("primary" as ProviderId, ["movie"]),
      },
    ],
    get: () => undefined,
    getProviderIds: () => ["primary" as ProviderId],
    getManifest: () => createManifest("primary" as ProviderId, ["movie"]),
    resolve: async () => createEmptyProviderResult("primary" as ProviderId),
    resolveWithFallback: async (
      _input: ProviderResolveInput,
      _candidateIds: readonly ProviderId[],
      signal?: AbortSignal,
    ): Promise<ProviderEngineResolveOutput> => {
      observedSignal = signal;
      if (!signal?.aborted) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      }
      return { result: null, providerId: null, attempts: [] };
    },
  } as unknown as ProviderEngine;
  const service = new PlaybackResolveService({
    engine,
    cacheStore: createMemoryCache(null),
    resolveTotalDeadlineMs: () => 5,
  });

  const pending = service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: controller.signal,
  });
  const outcome = await Promise.race([pending, Bun.sleep(100).then(() => "hung" as const)]);
  if (outcome === "hung") {
    controller.abort();
    await pending;
  }

  expect(outcome).not.toBe("hung");
  expect(observedSignal).not.toBe(controller.signal);
  if (outcome !== "hung") expect(outcome.stream).toBeNull();
});
