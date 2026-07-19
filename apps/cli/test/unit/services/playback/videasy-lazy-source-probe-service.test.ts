import { describe, expect, test } from "bun:test";

import { VideasyLazySourceProbeService } from "@/services/playback/VideasyLazySourceProbeService";
import { flavorSourceId, VIDKING_PROVIDER_ID } from "@kunai/providers";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
} from "@kunai/types";

const inventoryKey = {
  providerId: VIDKING_PROVIDER_ID,
  mediaKind: "movie" as const,
  titleId: "438631",
  audioMode: "de",
  subtitleLanguage: "en",
};

describe("VideasyLazySourceProbeService", () => {
  test("skips phase B flavors already resolved in cached inventory", async () => {
    const resolvedFlavorIds: string[] = [];
    const service = new VideasyLazySourceProbeService({
      sourceInventory: {
        get: async () => ({
          ...baseResult(),
          sources: [failedSource(flavorSourceId("cineby-sage"), "Sage", "cineby-sage")],
        }),
        set: async () => {},
      },
      resolveVideasyDirect: async (
        _resolveInput: ProviderResolveInput,
        _context: ProviderRuntimeContext,
        engineOptions?: { readonly flavorId?: string },
      ) => {
        resolvedFlavorIds.push(String(engineOptions?.flavorId));
        return {
          ...baseResult(),
          sources: [availableSource(flavorSourceId(String(engineOptions?.flavorId)), "Brook")],
        };
      },
    });

    await service.schedulePhaseB({
      resolveInput: resolveInput(),
      context: runtimeContext(),
      baseResult: baseResult(),
      inventoryKey,
      preferredAudioLanguage: "de",
    });

    expect(resolvedFlavorIds).not.toContain("cineby-sage");
    expect(resolvedFlavorIds).toContain("cineby-killjoy");
  });

  test("does not start probes when the caller signal is already aborted", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const service = new VideasyLazySourceProbeService({
      sourceInventory: {
        get: async () => null,
        set: async () => {},
      },
      resolveVideasyDirect: async () => {
        calls += 1;
        return baseResult();
      },
    });

    await service.schedulePhaseB({
      resolveInput: resolveInput(),
      context: runtimeContext(controller.signal),
      baseResult: baseResult(),
      inventoryKey,
      preferredAudioLanguage: "de",
    });

    expect(calls).toBe(0);
  });

  test("dedupes streams already present in cached inventory", async () => {
    const persisted: ProviderResolveResult[] = [];
    const service = new VideasyLazySourceProbeService({
      sourceInventory: {
        get: async () => baseResult(),
        set: async (_key, inventory) => {
          persisted.push(inventory);
        },
      },
      resolveVideasyDirect: async () => baseResult(),
    });

    await service.schedulePhaseB({
      resolveInput: resolveInput(),
      context: runtimeContext(),
      baseResult: baseResult(),
      inventoryKey,
      preferredAudioLanguage: "de",
    });

    const lastPersisted = persisted.at(-1);
    const streamIds = lastPersisted?.streams.map((stream) => stream.id) ?? [];
    expect(streamIds).toEqual([...new Set(streamIds)]);
  });

  test("does not dedupe phase-B work across different quality preferences", async () => {
    const probedQualities: string[] = [];
    let release1080!: () => void;
    const gate1080 = new Promise<void>((resolve) => {
      release1080 = resolve;
    });
    const service = new VideasyLazySourceProbeService({
      probeConcurrency: 1,
      sourceInventory: {
        get: async (key) => {
          if (key.qualityPreference === "1080p") await gate1080;
          return null;
        },
        set: async () => {},
      },
      resolveVideasyDirect: async (probeInput) => {
        probedQualities.push(String(probeInput.qualityPreference ?? "none"));
        return baseResult();
      },
    });

    const pending1080 = service.schedulePhaseB({
      resolveInput: { ...resolveInput(), qualityPreference: "1080p" },
      context: runtimeContext(),
      baseResult: baseResult(),
      inventoryKey: { ...inventoryKey, qualityPreference: "1080p" },
      preferredAudioLanguage: "de",
    });
    await Bun.sleep(5);
    const pending720 = service.schedulePhaseB({
      resolveInput: { ...resolveInput(), qualityPreference: "720p" },
      context: runtimeContext(),
      baseResult: baseResult(),
      inventoryKey: { ...inventoryKey, qualityPreference: "720p" },
      preferredAudioLanguage: "de",
    });
    release1080();
    await Promise.all([pending1080, pending720]);

    expect(probedQualities).toContain("1080p");
    expect(probedQualities).toContain("720p");
  });

  test("honors injected probe concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const service = new VideasyLazySourceProbeService({
      probeConcurrency: 1,
      sourceInventory: {
        get: async () => null,
        set: async () => {},
      },
      resolveVideasyDirect: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(1);
        active -= 1;
        return baseResult();
      },
    });

    await service.schedulePhaseB({
      resolveInput: resolveInput(),
      context: runtimeContext(),
      baseResult: baseResult(),
      inventoryKey,
      preferredAudioLanguage: "de",
    });

    expect(maxActive).toBe(1);
  });
});

function resolveInput(): ProviderResolveInput {
  return {
    title: {
      id: "438631",
      tmdbId: "438631",
      kind: "movie",
      title: "Dune",
      year: 2021,
    },
    mediaKind: "movie",
    intent: "play",
    allowedRuntimes: ["direct-http"],
  };
}

function runtimeContext(signal?: AbortSignal): ProviderRuntimeContext {
  return {
    now: () => "2026-05-28T00:00:00.000Z",
    signal,
    retryPolicy: { maxAttempts: 1, backoff: "none", delayMs: 0 },
  };
}

function baseResult(): ProviderResolveResult {
  return {
    status: "resolved",
    providerId: VIDKING_PROVIDER_ID,
    selectedStreamId: "stream:vidking:base",
    sources: [availableSource("source:videasy:mb-flix", "Luffy")],
    variants: [],
    streams: [
      {
        id: "stream:vidking:base",
        providerId: VIDKING_PROVIDER_ID,
        sourceId: "source:videasy:mb-flix",
        url: "https://cdn.example/base.m3u8",
        protocol: "hls",
        container: "m3u8",
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: "2026-05-28T00:00:00.000Z",
      cacheHit: false,
      title: { id: "438631", kind: "movie", title: "Dune" },
      steps: [],
      failures: [],
    },
    failures: [],
  };
}

function availableSource(id: string, label: string): ProviderSourceCandidate {
  return {
    id,
    providerId: VIDKING_PROVIDER_ID,
    kind: "provider-api",
    label,
    host: "api.videasy.to",
    status: "available",
    confidence: 0.9,
  };
}

function failedSource(id: string, label: string, flavorId: string): ProviderSourceCandidate {
  return {
    ...availableSource(id, label),
    status: "failed",
    confidence: 0,
    metadata: {
      flavorId,
      phase: "B",
      failureReason: "previous failure",
    },
  };
}
