import { describe, expect, test } from "bun:test";

import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveCoordinator } from "@/services/playback/PlaybackResolveCoordinator";
import type { ProviderEngine, ProviderEngineResolveOutput } from "@kunai/core";
import type { ProviderId, ProviderResolveResult } from "@kunai/types";

const title = {
  id: "12345",
  type: "series" as const,
  name: "Test Series",
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
  title: "Test Series",
  timestamp: Date.now(),
};

function createMemoryCache(value: typeof stream | null): CacheStore {
  let stored: typeof stream | null = value;
  return {
    get: async () => stored,
    set: async (_key: string, val: unknown) => {
      stored = val as typeof stream;
    },
    delete: async () => {
      stored = null;
    },
    clear: async () => {},
    prune: async () => {},
    ttl: () => 0,
  } as unknown as CacheStore;
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

function createProviderResult(url: string): ProviderEngineResolveOutput {
  return {
    result: {
      providerId: "fallback" as ProviderId,
      streams: [
        {
          id: "stream:fallback:1",
          providerId: "fallback" as ProviderId,
          url,
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:1",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "series", title: "Test Series" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "fallback" as ProviderId,
    attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
  };
}

function input(signal = new AbortController().signal) {
  return {
    title,
    episode: { season: 1, episode: 2 },
    mode: "series" as const,
    providerId: "vidking",
    audioPreference: "original",
    subtitlePreference: "none",
    signal,
  };
}

describe("PlaybackResolveCoordinator", () => {
  test("returns cache-hit provenance for fresh cached streams", async () => {
    const coordinator = new PlaybackResolveCoordinator({
      engine: createMockEngine({ result: null, providerId: null, attempts: [] }),
      cacheStore: createMemoryCache({ ...stream, timestamp: Date.now() }),
    });

    const result = await coordinator.resolve(input());

    expect(result.provenance).toBe("cache-hit");
    expect(result.stream?.cacheProvenance).toBe("cached");
  });

  test("returns cache-refetched provenance after stale health failure", async () => {
    const coordinator = new PlaybackResolveCoordinator({
      engine: createMockEngine(createProviderResult("https://fallback.example/stream.m3u8")),
      cacheStore: createMemoryCache({
        ...stream,
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
      }),
      streamHealth: async () => false,
    });

    const result = await coordinator.resolve(input());

    expect(result.provenance).toBe("cache-refetched");
    expect(result.stream?.url).toBe("https://fallback.example/stream.m3u8");
  });

  test("records cache and health diagnostics through one event bridge", async () => {
    const events: unknown[] = [];
    const diagnostics = {
      record: (event: unknown) => events.push(event),
      getRecent: () => [],
      getSnapshot: () => [],
      clear: () => {},
      buildSupportBundle: () => {
        throw new Error("not needed");
      },
    } as unknown as DiagnosticsService;
    const coordinator = new PlaybackResolveCoordinator({
      engine: createMockEngine({ result: null, providerId: null, attempts: [] }),
      cacheStore: createMemoryCache({
        ...stream,
        timestamp: Date.now() - 3 * 60 * 60 * 1000,
      }),
      streamHealth: async () => true,
      diagnostics,
    });

    const result = await coordinator.resolve(input());

    expect(result.provenance).toBe("cache-hit-validated");
    expect(events).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        category: "cache",
        operation: "stream-health-check",
        message: "Cached stream health check passed",
      }),
    );
  });

  test("prefetch resolves through the same coordinator path", async () => {
    const coordinator = new PlaybackResolveCoordinator({
      engine: createMockEngine(createProviderResult("https://fresh.example/stream.m3u8")),
      cacheStore: createMemoryCache(null),
    });

    const result = await coordinator.prefetch(input());

    expect(result?.url).toBe("https://fresh.example/stream.m3u8");
    expect(result?.cacheProvenance).toBe("fresh");
  });
});
