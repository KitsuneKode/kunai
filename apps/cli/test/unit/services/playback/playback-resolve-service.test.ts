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
      _input: ProviderResolveInput,
      candidateIds: readonly ProviderId[],
    ) => {
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
  const engine = createMockEngine({
    result: {
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
  });
  const service = new PlaybackResolveService({ engine, cacheStore: cache });

  const result = await service.resolve({
    title,
    episode: { season: 1, episode: 2 },
    mode: "series",
    providerId: "primary",
    audioPreference: "original",
    subtitlePreference: "none",
    signal: new AbortController().signal,
  });

  expect(result.providerId).toBe("fallback");
  expect(result.stream).not.toBeNull();
  expect(result.stream!.url).toBe(fallbackStream.url);
});

test("PlaybackResolveService reuses fresh cached stream without health check", async () => {
  const freshStream = { ...stream, timestamp: Date.now() };
  const cache = createMemoryCache(freshStream);
  const engine = createMockEngine({ result: null, providerId: null, attempts: [] });
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
    onEvent: (e) => events.push(e.type),
  });

  expect(result.cacheStatus).toBe("hit");
  expect(result.stream?.cacheProvenance).toBe("cached");
  expect(events).toEqual(["cache-hit"]);
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

  expect(events).toEqual(["cache-health-check", "cache-stale", "cache-miss", "recovery-decision"]);
  expect(result.cacheStatus).toBe("miss");
  expect(result.cacheProvenance).toBe("refetched");
  expect(result.stream?.url).toBe(fallbackStream.url);
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
