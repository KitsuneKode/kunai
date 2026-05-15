import { expect, test } from "bun:test";

import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import type { ProviderEngine, ProviderEngineResolveOutput } from "@kunai/core";
import type { ProviderId, ProviderResolveResult } from "@kunai/types";

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

function createMockEngine(resolveWithFallbackResult: ProviderEngineResolveOutput): ProviderEngine {
  return {
    modules: [],
    get: () => undefined,
    getProviderIds: () => [],
    getManifest: () => undefined,
    resolve: async () => ({}) as ProviderResolveResult,
    resolveWithFallback: async () => resolveWithFallbackResult,
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

  expect(events).toEqual(["cache-health-check", "cache-stale", "cache-miss"]);
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
