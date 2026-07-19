import { describe, expect, test } from "bun:test";

import type { Container } from "@/container";
import { scheduleVideasyLazySourceProbes } from "@/services/playback/schedule-videasy-lazy-probes";
import type { SourceInventoryCacheInput } from "@/services/playback/SourceInventoryService";
import { VIDKING_PROVIDER_ID } from "@kunai/providers";
import type { ProviderResolveResult } from "@kunai/types";

describe("scheduleVideasyLazySourceProbes", () => {
  test("includes quality preference in lazy inventory keys", () => {
    let inventoryKey: SourceInventoryCacheInput | undefined;
    const container = {
      engine: {
        createRuntimeContext: () => ({
          now: () => "2026-07-19T00:00:00.000Z",
          retryPolicy: { maxAttempts: 1, backoff: "none", delayMs: 0 },
        }),
      },
      videasyLazySourceProbe: {
        schedulePhaseB: (input: { inventoryKey: SourceInventoryCacheInput }) => {
          inventoryKey = input.inventoryKey;
        },
      },
    } as unknown as Container;

    const result: ProviderResolveResult = {
      status: "resolved",
      providerId: VIDKING_PROVIDER_ID,
      selectedStreamId: "stream:vidking:1",
      sources: [],
      streams: [
        {
          id: "stream:vidking:1",
          providerId: VIDKING_PROVIDER_ID,
          url: "https://example.com/stream.m3u8",
          protocol: "hls",
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
        },
      ],
      subtitles: [],
      variants: [],
      trace: {
        id: "trace:1",
        startedAt: "2026-07-19T00:00:00.000Z",
        title: { id: "1396", kind: "series", title: "Breaking Bad" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    };

    scheduleVideasyLazySourceProbes({
      container,
      stream: {
        url: "https://example.com/stream.m3u8",
        headers: {},
        subtitle: undefined,
        subtitleList: [],
        subtitleSource: "none",
        subtitleEvidence: {
          directSubtitleObserved: false,
          wyzieSearchObserved: false,
          reason: "not-observed",
        },
        title: "Breaking Bad",
        timestamp: Date.now(),
        providerResolveResult: result,
      },
      title: { id: "1396", type: "series", name: "Breaking Bad" },
      episode: { season: 1, episode: 5 },
      mode: "series",
      providerId: VIDKING_PROVIDER_ID,
      audioPreference: "original",
      subtitlePreference: "none",
      qualityPreference: "720p",
      startupPriority: "balanced",
    });

    expect(inventoryKey).toEqual(expect.objectContaining({ qualityPreference: "720p" }));
  });
});
