import { describe, expect, test } from "bun:test";

import { buildTracksPanelData } from "@/app-shell/tracks-panel-data";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { SourceInventoryCacheInput } from "@/services/playback/SourceInventoryService";
import type { ProviderResolveResult } from "@kunai/types";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "720p" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

describe("buildTracksPanelData", () => {
  test("cross-provider inventory hints use quality-partitioned cache identity", async () => {
    const inventoryReads: SourceInventoryCacheInput[] = [];
    const cached: ProviderResolveResult = {
      status: "resolved",
      providerId: "rivestream",
      selectedStreamId: "stream:rivestream:1",
      sources: [
        {
          id: "source:rivestream:cdn",
          providerId: "rivestream",
          kind: "provider-api",
          label: "CDN",
          status: "available",
          confidence: 0.9,
        },
      ],
      streams: [
        {
          id: "stream:rivestream:1",
          providerId: "rivestream",
          sourceId: "source:rivestream:cdn",
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
        cacheHit: true,
        steps: [],
        failures: [],
      },
      failures: [],
    };

    const container = {
      config: { getRaw: () => config },
      stateManager: {
        getState: () => ({
          mode: "series",
          provider: "vidking",
          currentTitle: { id: "1396", type: "series", name: "Breaking Bad" },
          currentEpisode: { season: 1, episode: 5 },
        }),
      },
      providerRegistry: {
        getAll: () => [
          { metadata: { id: "vidking", name: "VidKing" } },
          { metadata: { id: "rivestream", name: "RiveStream" } },
        ],
        getCompatible: () => [{ metadata: { id: "rivestream", name: "RiveStream" } }],
        get: (id: string) =>
          id === "vidking"
            ? { metadata: { id: "vidking", name: "VidKing" } }
            : { metadata: { id: "rivestream", name: "RiveStream" } },
      },
      titleProviderHealth: {
        getSwitchSuggestion: () => undefined,
      },
      sourceInventory: {
        get: async (input: SourceInventoryCacheInput) => {
          inventoryReads.push(input);
          return cached;
        },
      },
    } as unknown as Container;

    await buildTracksPanelData(
      {
        url: "https://example.com/active.m3u8",
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
        providerResolveResult: {
          status: "resolved",
          providerId: "vidking",
          selectedStreamId: "stream:vidking:1",
          sources: [
            {
              id: "source:vidking:cdn",
              providerId: "vidking",
              kind: "provider-api",
              label: "CDN",
              status: "selected",
              confidence: 0.9,
            },
          ],
          streams: [
            {
              id: "stream:vidking:1",
              providerId: "vidking",
              sourceId: "source:vidking:cdn",
              url: "https://example.com/active.m3u8",
              protocol: "hls",
              confidence: 0.9,
              cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
            },
          ],
          subtitles: [],
          variants: [],
          trace: {
            id: "trace:active",
            startedAt: "2026-07-19T00:00:00.000Z",
            title: { id: "1396", kind: "series", title: "Breaking Bad" },
            cacheHit: false,
            steps: [],
            failures: [],
          },
          failures: [],
        },
      },
      container,
    );

    expect(inventoryReads[0]).toEqual(
      expect.objectContaining({ qualityPreference: "720p", providerId: "rivestream" }),
    );
  });
});
