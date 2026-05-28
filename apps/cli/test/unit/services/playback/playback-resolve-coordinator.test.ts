import { describe, expect, test } from "bun:test";

import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import { PlaybackResolveCoordinator } from "@/services/playback/PlaybackResolveCoordinator";
import type { ProviderEngine, ProviderEngineEvent, ProviderEngineResolveOutput } from "@kunai/core";
import type { ProviderId, ProviderResolveInput, ProviderResolveResult } from "@kunai/types";

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

function createObservedMockEngine(
  resolveWithFallbackResult: ProviderEngineResolveOutput,
  observedEvents: readonly ProviderEngineEvent[],
): ProviderEngine {
  return {
    modules: [],
    get: () => undefined,
    getProviderIds: () => [],
    getManifest: () => undefined,
    resolve: async () => ({}) as ProviderResolveResult,
    resolveWithFallback: async (
      _input: ProviderResolveInput,
      _providers: readonly ProviderId[],
      _signal?: AbortSignal,
      observer?: (event: ProviderEngineEvent) => void,
    ) => {
      observedEvents.forEach((event) => observer?.(event));
      return resolveWithFallbackResult;
    },
  } as unknown as ProviderEngine;
}

function createProviderResult(url: string): ProviderEngineResolveOutput {
  return {
    result: {
      status: "resolved",
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

function createProviderResultWithSelectionDecision(): ProviderEngineResolveOutput {
  return {
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
        id: "trace:selection",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "series", title: "Test Series" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
      selectionDecision: {
        startupPriority: "balanced",
        reason: "balanced-1080",
        waitBudgetMs: 1_000,
        selectedQualityRank: 1080,
        enrichmentLane: "required",
      },
    },
    providerId: "fallback" as ProviderId,
    attempts: [{ providerId: "fallback" as ProviderId, result: undefined }],
  };
}

function createProviderResultAfterFallback(): ProviderEngineResolveOutput {
  return {
    result: {
      status: "resolved",
      providerId: "rivestream" as ProviderId,
      streams: [
        {
          id: "stream:rivestream:1",
          providerId: "rivestream" as ProviderId,
          url: "https://rivestream.example/stream.m3u8",
          protocol: "hls" as const,
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:fallback",
        startedAt: new Date().toISOString(),
        title: { id: "12345", kind: "series", title: "Test Series" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
    providerId: "rivestream" as ProviderId,
    attempts: [
      {
        providerId: "vidking" as ProviderId,
        failure: {
          providerId: "vidking" as ProviderId,
          code: "timeout",
          message: "VidKing timed out",
          retryable: true,
          at: "2026-05-15T00:00:00.000Z",
        },
      },
      { providerId: "rivestream" as ProviderId, result: undefined },
    ],
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
      streamHealth: async (url) => url !== stream.url,
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

  test("records provider fallback timeline diagnostics", async () => {
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
      engine: createMockEngine(createProviderResultAfterFallback()),
      cacheStore: createMemoryCache(null),
      diagnostics,
    });

    const result = await coordinator.resolve(input());

    expect(result.providerTimeline?.status).toBe("recovered");
    expect(events).toContainEqual(
      expect.objectContaining({
        category: "provider",
        operation: "provider.resolve.timeline",
        message: "Recovered via Rivestream",
        providerId: "rivestream",
        context: expect.objectContaining({
          status: "recovered",
          primaryFailure: "VidKing timed out",
          failureClass: "timeout",
          attemptTimeline: expect.arrayContaining([
            expect.objectContaining({
              providerId: "vidking",
              status: "failed",
              failureClass: "timeout",
            }),
            expect.objectContaining({
              providerId: "rivestream",
              status: "succeeded",
            }),
          ]),
        }),
      }),
    );
  });

  test("propagates resolve correlation into provider timeline diagnostics", async () => {
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
      engine: createMockEngine(createProviderResultAfterFallback()),
      cacheStore: createMemoryCache(null),
      diagnostics,
    });

    const result = await coordinator.resolve({
      ...input(),
      correlation: {
        sessionId: "session-1",
        playbackCycleId: "playback-1",
        providerAttemptId: "provider-1",
      },
    });

    expect(result.providerTimeline?.traceId).toBe("provider-1");
    expect(events).toContainEqual(
      expect.objectContaining({
        category: "provider",
        operation: "provider.resolve.timeline",
        traceId: "provider-1",
        sessionId: "session-1",
        playbackCycleId: "playback-1",
        providerAttemptId: "provider-1",
      }),
    );
  });

  test("records physical provider attempt and fallback evidence", async () => {
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
      engine: createObservedMockEngine(createProviderResultAfterFallback(), [
        {
          type: "provider-attempt-started",
          providerId: "vidking" as ProviderId,
          attempt: 1,
          at: "2026-05-15T00:00:00.000Z",
        },
        {
          type: "provider-attempt-failed",
          providerId: "vidking" as ProviderId,
          attempt: 1,
          at: "2026-05-15T00:00:02.000Z",
          elapsedMs: 2000,
          failure: {
            providerId: "vidking" as ProviderId,
            code: "timeout",
            message: "VidKing timed out",
            retryable: true,
            at: "2026-05-15T00:00:02.000Z",
          },
        },
        {
          type: "provider-fallback-started",
          fromProviderId: "vidking" as ProviderId,
          toProviderId: "rivestream" as ProviderId,
          at: "2026-05-15T00:00:02.001Z",
          failure: {
            providerId: "vidking" as ProviderId,
            code: "timeout",
            message: "VidKing timed out",
            retryable: true,
            at: "2026-05-15T00:00:02.000Z",
          },
        },
      ]),
      cacheStore: createMemoryCache(null),
      diagnostics,
    });

    await coordinator.resolve({
      ...input(),
      correlation: {
        sessionId: "session-1",
        playbackCycleId: "cycle-1",
        providerAttemptId: "provider-1",
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        operation: "provider.resolve.attempt",
        playbackCycleId: "cycle-1",
        providerAttemptId: "provider-1",
        providerId: "vidking",
        context: expect.objectContaining({
          phase: "failed",
          physicalAttempt: 1,
          elapsedMs: 2000,
          failureCode: "timeout",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        operation: "provider.resolve.fallback",
        playbackCycleId: "cycle-1",
        providerAttemptId: "provider-1",
        providerId: "rivestream",
        context: expect.objectContaining({
          fromProviderId: "vidking",
          toProviderId: "rivestream",
          failureCode: "timeout",
        }),
      }),
    );
  });

  test("records playback recovery decisions through diagnostics", async () => {
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
      engine: createMockEngine(createProviderResult("https://fresh.example/stream.m3u8")),
      cacheStore: createMemoryCache(null),
      diagnostics,
    });

    await coordinator.resolve({ ...input(), recoveryMode: "guided" });

    expect(events).toContainEqual(
      expect.objectContaining({
        category: "playback",
        operation: "playback-recovery-decision",
        message: "Playback recovery decision: resolve-primary",
        context: expect.objectContaining({
          decision: "resolve-primary",
          reason: "normal-primary",
          recoveryMode: "guided",
        }),
      }),
    );
  });

  test("records provider selection decisions through diagnostics", async () => {
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
      engine: createMockEngine(createProviderResultWithSelectionDecision()),
      cacheStore: createMemoryCache(null),
      diagnostics,
    });

    await coordinator.resolve(input());

    expect(events).toContainEqual(
      expect.objectContaining({
        category: "provider",
        operation: "provider.selection.decision",
        message: "Provider startup selection decision recorded",
        providerId: "fallback",
        context: {
          startupPriority: "balanced",
          reason: "balanced-1080",
          waitBudgetMs: 1_000,
          selectedQualityRank: 1080,
          enrichmentLane: "required",
        },
      }),
    );
  });
});
