import { describe, expect, test } from "bun:test";

import { buildTracksPanelData } from "@/app-shell/tracks-panel-data";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { SourceInventoryCacheInput } from "@/services/playback/SourceInventoryService";
import type { ProviderResolveResult } from "@kunai/types";

import { createTestStateManager } from "../../helpers/session-state";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "720p" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

describe("buildTracksPanelData", () => {
  test("local playback exposes file facts without provider inventory or registry access", async () => {
    // SAFETY: This test double supplies the exact members read by the exercised workflow.
    // SAFETY: partial test container supplies every config/state/registry member this projection reads.
    const container: Container = {
      stateManager: createTestStateManager("retired-provider"),
      providerRegistry: {
        getAll: (): ReturnType<Container["providerRegistry"]["getAll"]> => {
          throw new Error("local playback read providers");
        },
      },
    } as Container;
    const data = await buildTracksPanelData(
      {
        url: "/owned/file.mp4",
        playbackSourceKind: "local",
        headers: {},
        title: "Owned file",
        timestamp: 1,
      },
      container,
    );
    expect(data.providerLabel).toBe("Local file");
    expect(data.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "source",
          selectable: false,
          rows: [
            expect.objectContaining({ label: "Downloaded file", selected: true, enabled: false }),
          ],
        }),
      ]),
    );
    expect(
      data.groups.every((group) => !group.selectable && group.rows.every((row) => !row.enabled)),
    ).toBe(true);
  });

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

    // SAFETY: partial test container supplies every config/state/registry member this projection reads.
    const container: Container = {
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
    } as never;

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

test.each(["unknown", "1080p"])(
  "a singleton %s quality is one honest Auto fact rather than a fake switch",
  async (label) => {
    const stream = {
      url: "https://cdn.example/stream",
      headers: {},
      timestamp: 1,
      providerResolveResult: {
        status: "resolved" as const,
        providerId: "vidlink",
        selectedStreamId: "one",
        streams: [
          {
            id: "one",
            providerId: "vidlink",
            sourceId: "source",
            url: "https://cdn.example/stream",
            protocol: "dash" as const,
            qualityLabel: label,
            confidence: 1,
            cachePolicy: {
              ttlClass: "stream-manifest" as const,
              scope: "local" as const,
              keyParts: [],
            },
          },
        ],
        sources: [],
        subtitles: [],
        failures: [],
        trace: {
          id: "trace",
          startedAt: new Date().toISOString(),
          cacheHit: false,
          title: { id: "1", title: "Title", kind: "movie" as const },
          steps: [],
          failures: [],
        },
      },
    };
    // SAFETY: partial test container supplies every config/state/registry member this projection reads.
    const container: Container = {
      config: {
        getRaw: () => ({
          ...config,
          seriesLanguageProfile: { ...config.seriesLanguageProfile, quality: "auto" },
        }),
      },
      stateManager: {
        getState: () => ({
          mode: "series",
          provider: "vidlink",
          currentTitle: null,
          currentEpisode: null,
          playbackTrackPreferences: {},
        }),
      },
      providerRegistry: { getAll: () => [], get: () => undefined },
      titleProviderHealth: { getSwitchSuggestion: () => undefined },
    } as never;
    const data = await buildTracksPanelData(stream, container);
    const quality = data.groups.find((group) => group.section === "quality");
    expect(quality?.rows).toHaveLength(1);
    expect(quality?.rows[0]).toMatchObject({ label: "Auto", selected: true, enabled: false });
    expect(quality?.selectable).toBe(false);
    expect(quality?.rows[0]?.detail).not.toContain("unknown");
  },
);

test("Tracks does not mark Off while mpv is rendering an embedded subtitle", async () => {
  // SAFETY: partial test container supplies every config/state/registry member this projection reads.
  const container: Container = {
    config: { getRaw: () => config },
    stateManager: {
      getState: () => ({
        mode: "series",
        provider: "vidlink",
        currentTitle: null,
        playbackTrackPreferences: {},
      }),
    },
    providerRegistry: { getAll: () => [], get: () => undefined },
  } as never;
  const data = await buildTracksPanelData(
    {
      url: "https://cdn.example/video.mp4",
      headers: {},
      timestamp: 1,
      playbackSubtitle: { id: 2, visible: true, language: "en", title: "Embedded English" },
    },
    container,
  );
  const subtitles = data.groups.find((group) => group.section === "subtitle");
  expect(subtitles?.rows.find((row) => row.value === "subtitle:off")?.selected).toBe(false);
  expect(subtitles?.rows.find((row) => row.selected)?.label).toContain("Embedded English");
});
