import { describe, expect, test } from "bun:test";

import { planAudioCycle, planSourceCycle } from "@/app/playback/playback-control-actions";
import type { ProviderResolveResult, StreamCandidate } from "@kunai/types";

function candidate(id: string, extra: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    id,
    providerId: "alpha",
    protocol: "hls",
    confidence: 1,
    cachePolicy: { ttlClass: "stream-manifest", scope: "memory", keyParts: [] },
    ...extra,
  };
}

function inventory(
  streams: readonly StreamCandidate[],
  selectedStreamId?: string,
): ProviderResolveResult {
  return {
    providerId: "alpha",
    status: "resolved",
    selectedStreamId,
    streams,
    subtitles: [],
    failures: [],
    trace: {
      id: "trace",
      startedAt: "2026-01-01T00:00:00.000Z",
      title: { id: "tmdb:1", kind: "movie", title: "Fixture" },
      cacheHit: false,
      steps: [],
      failures: [],
    },
  };
}

describe("planSourceCycle", () => {
  test("advances to the next distinct source and wraps around", () => {
    const streams = [
      candidate("a1", { sourceId: "a" }),
      candidate("a2", { sourceId: "a" }),
      candidate("b1", { sourceId: "b" }),
    ];
    expect(planSourceCycle(inventory(streams, "a2"))).toEqual({
      kind: "select",
      selection: { sourceId: "b", streamId: null },
    });
    expect(planSourceCycle(inventory(streams, "b1"))).toEqual({
      kind: "select",
      selection: { sourceId: "a", streamId: null },
    });
  });

  test("with a single source, steps through its streams instead", () => {
    const streams = [candidate("x1", { sourceId: "x" }), candidate("x2")];
    expect(planSourceCycle(inventory(streams, "x1"))).toEqual({
      kind: "select",
      selection: { sourceId: null, streamId: "x2" },
    });
    expect(planSourceCycle(inventory(streams, "x2"))).toEqual({
      kind: "select",
      selection: { sourceId: "x", streamId: "x1" },
    });
  });

  test("an unknown current stream starts from the first source", () => {
    const streams = [candidate("a1", { sourceId: "a" }), candidate("b1", { sourceId: "b" })];
    expect(planSourceCycle(inventory(streams, "gone"))).toEqual({
      kind: "select",
      selection: { sourceId: "a", streamId: null },
    });
  });

  test("one stream or no inventory asks for a fresh resolve", () => {
    expect(planSourceCycle(inventory([candidate("only", { sourceId: "a" })], "only"))).toEqual({
      kind: "refresh",
    });
    expect(planSourceCycle(undefined)).toEqual({ kind: "refresh" });
  });
});

describe("planAudioCycle", () => {
  test("switches between declared dub and sub presentations", () => {
    const streams = [
      candidate("sub", { sourceId: "s", presentation: "sub" }),
      candidate("dub", { sourceId: "d", presentation: "dub" }),
    ];
    expect(planAudioCycle(inventory(streams, "sub"))).toEqual({ sourceId: "d", streamId: "dub" });
    expect(planAudioCycle(inventory(streams, "dub"))).toEqual({ sourceId: "s", streamId: "sub" });
  });

  test("falls back to audio languages when no presentation is declared", () => {
    const streams = [
      candidate("ja", { audioLanguages: ["ja"] }),
      candidate("en", { audioLanguages: ["en"] }),
    ];
    expect(planAudioCycle(inventory(streams, "ja"))).toEqual({ sourceId: null, streamId: "en" });
    expect(planAudioCycle(inventory(streams, "en"))).toEqual({ sourceId: null, streamId: "ja" });
  });

  test("returns null when no stream offers the other presentation", () => {
    const streams = [candidate("sub1", { presentation: "sub" }), candidate("sub2")];
    expect(planAudioCycle(inventory(streams, "sub1"))).toBeNull();
    expect(planAudioCycle(undefined)).toBeNull();
  });
});
