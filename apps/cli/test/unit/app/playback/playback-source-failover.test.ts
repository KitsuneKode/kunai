import { describe, expect, test } from "bun:test";

import {
  listOrderedPlaybackSourceIds,
  pickNextCatalogSourceId,
  planStartupFailover,
  STARTUP_STALL_TIMEOUT_MS,
} from "@/app/playback/playback-source-failover";
import type { ProviderResolveResult } from "@kunai/types";

describe("playback-source-failover", () => {
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
});
