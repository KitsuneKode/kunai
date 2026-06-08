import { describe, expect, test } from "bun:test";

import { VidkingLazySourceProbeService } from "@/services/playback/VidkingLazySourceProbeService";
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

describe("VidkingLazySourceProbeService", () => {
  test("skips phase B flavors already resolved in cached inventory", async () => {
    const resolvedFlavorIds: string[] = [];
    const service = new VidkingLazySourceProbeService({
      sourceInventory: {
        get: async () => ({
          ...baseResult(),
          sources: [failedSource(flavorSourceId("videasy-mirror-c"), "Sanji", "videasy-mirror-c")],
        }),
        set: async () => {},
      },
      resolveVidkingDirect: async (_resolveInput, _context, engineOptions) => {
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

    expect(resolvedFlavorIds).not.toContain("videasy-mirror-c");
    expect(resolvedFlavorIds).toContain("videasy-german");
  });

  test("does not start probes when the caller signal is already aborted", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const service = new VidkingLazySourceProbeService({
      sourceInventory: {
        get: async () => null,
        set: async () => {},
      },
      resolveVidkingDirect: async () => {
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
    const service = new VidkingLazySourceProbeService({
      sourceInventory: {
        get: async () => baseResult(),
        set: async (_key, inventory) => {
          persisted.push(inventory);
        },
      },
      resolveVidkingDirect: async () => baseResult(),
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
    sources: [availableSource("source:vidking:videasy:mb-flix", "Luffy")],
    variants: [],
    streams: [
      {
        id: "stream:vidking:base",
        providerId: VIDKING_PROVIDER_ID,
        sourceId: "source:vidking:videasy:mb-flix",
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
