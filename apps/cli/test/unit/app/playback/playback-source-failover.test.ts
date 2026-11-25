import { describe, expect, test } from "bun:test";

import {
  capQualityPreference,
  listOrderedPlaybackSourceIds,
  pickNextCatalogSourceId,
  planQualityStepDown,
  planStartupFailover,
  shouldUseProviderPlaybackRecovery,
  STARTUP_STALL_TIMEOUT_MS,
} from "@/app/playback/playback-source-failover";
import type {
  ProviderResolveResult,
  ProviderSourceCandidate,
  ProviderSourceStatus,
  StreamCandidate,
} from "@kunai/types";

describe("playback-source-failover", () => {
  test("verified local playback never enters provider stream recovery", () => {
    expect(shouldUseProviderPlaybackRecovery("local")).toBe(false);
    expect(shouldUseProviderPlaybackRecovery("fresh")).toBe(true);
    expect(shouldUseProviderPlaybackRecovery("cache")).toBe(true);
  });

  test("STARTUP_STALL_TIMEOUT_MS leaves headroom past 20s for slow CDNs", () => {
    expect(STARTUP_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
  });

  test("pickNextCatalogSourceId returns the next untried source in order", () => {
    expect(
      pickNextCatalogSourceId(
        ["source:a", "source:b", "source:c"],
        "source:a",
        new Set(["source:a"]),
      ),
    ).toBe("source:b");
    expect(
      pickNextCatalogSourceId(
        ["source:a", "source:b", "source:c"],
        "source:b",
        new Set(["source:a", "source:b"]),
      ),
    ).toBe("source:c");
    expect(
      pickNextCatalogSourceId(
        ["source:a", "source:b"],
        "source:b",
        new Set(["source:a", "source:b"]),
      ),
    ).toBeNull();
  });

  test("planStartupFailover prefers next source then provider hop then give-up", () => {
    expect(
      planStartupFailover({
        sourceIds: ["s1", "s2"],
        currentSourceId: "s1",
        triedSourceIds: new Set(["s1"]),
        hasFallbackProvider: true,
        failoverAttempts: 0,
      }),
    ).toEqual({ kind: "advance-source", sourceId: "s2" });

    expect(
      planStartupFailover({
        sourceIds: ["s1", "s2"],
        currentSourceId: "s2",
        triedSourceIds: new Set(["s1", "s2"]),
        hasFallbackProvider: true,
        failoverAttempts: 2,
        providerHopUsed: false,
      }),
    ).toEqual({ kind: "fallback-provider" });

    expect(
      planStartupFailover({
        sourceIds: ["s1"],
        currentSourceId: "s1",
        triedSourceIds: new Set(["s1"]),
        hasFallbackProvider: false,
        failoverAttempts: 1,
        providerHopUsed: true,
      }),
    ).toEqual({ kind: "give-up" });

    expect(
      planStartupFailover({
        sourceIds: ["s1", "s2"],
        currentSourceId: "s1",
        triedSourceIds: new Set(["s1"]),
        hasFallbackProvider: true,
        failoverAttempts: 4,
      }),
    ).toEqual({ kind: "give-up" });
  });

  test("listOrderedPlaybackSourceIds prefers sources inventory order", () => {
    const result = {
      providerId: "videasy",
      status: "ok",
      sources: [
        {
          id: "source:yoru",
          providerId: "videasy",
          kind: "provider-api",
          label: "Yoru",
          host: "x",
          status: "selected",
          confidence: 1,
        },
        {
          id: "source:neon",
          providerId: "videasy",
          kind: "provider-api",
          label: "Neon",
          host: "x",
          status: "ready",
          confidence: 1,
        },
      ],
      streams: [],
      subtitles: [],
      selectedStreamId: null,
      failures: [],
      trace: { title: { kind: "movie" }, events: [] },
      cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
    } as unknown as ProviderResolveResult;

    expect(listOrderedPlaybackSourceIds(result)).toEqual(["source:yoru", "source:neon"]);
  });

  test("pickNextCatalogSourceId wraps to sources listed before the current one", () => {
    // Playback started on c (a favourite or pinned pick); a and b come first.
    expect(
      pickNextCatalogSourceId(
        ["source:a", "source:b", "source:c"],
        "source:c",
        new Set(["source:c"]),
      ),
    ).toBe("source:a");
    expect(
      pickNextCatalogSourceId(
        ["source:a", "source:b", "source:c"],
        "source:b",
        new Set(["source:b", "source:c"]),
      ),
    ).toBe("source:a");
  });

  test("a refused target is not retried when the provider lands back on the previous source", () => {
    // Recovery asked for b; the provider refused it and played a again. With b
    // recorded as tried, the next plan moves on instead of asking for b again.
    expect(
      planStartupFailover({
        sourceIds: ["a", "b", "c"],
        currentSourceId: "a",
        triedSourceIds: new Set(["a", "b"]),
        hasFallbackProvider: true,
        failoverAttempts: 1,
      }),
    ).toEqual({ kind: "advance-source", sourceId: "c" });
    expect(
      planStartupFailover({
        sourceIds: ["a", "b"],
        currentSourceId: "a",
        triedSourceIds: new Set(["a", "b"]),
        hasFallbackProvider: true,
        failoverAttempts: 1,
      }),
    ).toEqual({ kind: "fallback-provider" });
  });

  test("listOrderedPlaybackSourceIds leaves out failed and exhausted sources but keeps skipped", () => {
    const source = (id: string, status: ProviderSourceStatus): ProviderSourceCandidate => ({
      id,
      providerId: "videasy",
      kind: "provider-api",
      label: id,
      host: "x",
      status,
      confidence: 1,
    });
    const result = {
      sources: [
        source("source:live", "selected"),
        source("source:dead", "failed"),
        source("source:spent", "exhausted"),
        source("source:known", "skipped"),
      ],
      streams: [],
    };

    expect(listOrderedPlaybackSourceIds(result)).toEqual(["source:live", "source:known"]);
  });
});

describe("4K step-down before abandoning a source", () => {
  const rung = (
    id: string,
    sourceId: string,
    qualityRank: number,
    url = `https://cdn/${id}`,
  ): StreamCandidate => ({
    id,
    providerId: "vidlink",
    sourceId,
    qualityRank,
    url,
    protocol: "hls",
    confidence: 0.9,
    cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
  });
  const resolved = (
    selectedStreamId: string,
    streams: StreamCandidate[],
  ): Pick<ProviderResolveResult, "streams" | "selectedStreamId"> => ({ selectedStreamId, streams });

  test("a failing 4K rung steps down to 1080p on its own source", () => {
    const result = resolved("a-2160", [
      rung("a-2160", "a", 2160),
      rung("a-1080", "a", 1080),
      rung("b-2160", "b", 2160),
    ]);
    expect(planQualityStepDown(result, null)).toEqual({ sourceId: "a", maxRank: 1080 });
  });

  test("once per source: after stepping down, the next failure leaves the source", () => {
    const result = resolved("a-2160", [rung("a-2160", "a", 2160), rung("a-1080", "a", 1080)]);
    expect(planQualityStepDown(result, { sourceId: "a", maxRank: 1080 })).toBeNull();
  });

  test("nothing to step down to, or already at 1080p, leaves recovery unchanged", () => {
    // Only 4K on this source (the lower rung is elsewhere).
    expect(
      planQualityStepDown(
        resolved("a-2160", [rung("a-2160", "a", 2160), rung("b-1080", "b", 1080)]),
        null,
      ),
    ).toBeNull();
    // Already 1080p.
    expect(
      planQualityStepDown(
        resolved("a-1080", [rung("a-1080", "a", 1080), rung("a-720", "a", 720)]),
        null,
      ),
    ).toBeNull();
    // A lower "rung" that is the same URL is not a different stream.
    expect(
      planQualityStepDown(
        resolved("a-2160", [
          rung("a-2160", "a", 2160, "https://cdn/same"),
          rung("a-1080", "a", 1080, "https://cdn/same"),
        ]),
        null,
      ),
    ).toBeNull();
    expect(planQualityStepDown(null, null)).toBeNull();
  });

  test("the ceiling caps automatic and 4K preferences but keeps a lower choice", () => {
    const ceiling = { sourceId: "a", maxRank: 1080 };
    expect(capQualityPreference(undefined, ceiling)).toBe("1080");
    expect(capQualityPreference("best", ceiling)).toBe("1080");
    expect(capQualityPreference("4k", ceiling)).toBe("1080");
    expect(capQualityPreference("2160", ceiling)).toBe("1080");
    expect(capQualityPreference("720p", ceiling)).toBe("720p");
    expect(capQualityPreference("best", null)).toBe("best");
  });
});
