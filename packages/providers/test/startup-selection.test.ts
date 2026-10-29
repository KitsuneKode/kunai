import { describe, expect, test } from "bun:test";

import type { StreamCandidate } from "@kunai/types";

import { selectReadyStream } from "../src/shared/startup-selection";

describe("selectReadyStream", () => {
  const candidates = [
    streamCandidate({ id: "720", qualityRank: 720 }),
    streamCandidate({ id: "1080", qualityRank: 1080 }),
  ] as const satisfies readonly StreamCandidate[];

  test("balanced selects the highest ready quality", () => {
    expect(selectReadyStream(candidates, { startupPriority: "balanced" }).selected.id).toBe("1080");
  });

  test("fast selects the first ready candidate (provider ready-order)", () => {
    const result = selectReadyStream(candidates, { startupPriority: "fast" });
    expect(result.decision.reason).toBe("fast-start");
    expect(result.selected.id).toBe("720");
  });

  test("quality preference selects a matching ready quality (best match, not first hit)", () => {
    expect(
      selectReadyStream(candidates, { startupPriority: "balanced", qualityPreference: "720" })
        .selected.id,
    ).toBe("720");
    expect(
      selectReadyStream(candidates, { startupPriority: "balanced", qualityPreference: "1080p" })
        .selected.id,
    ).toBe("1080");
  });

  test("best/auto quality preference falls through to highest rank", () => {
    expect(
      selectReadyStream(candidates, { startupPriority: "balanced", qualityPreference: "best" })
        .selected.id,
    ).toBe("1080");
  });

  test("quality-first records the foreground wait budget", () => {
    expect(
      selectReadyStream(candidates, { startupPriority: "quality-first" }).decision.waitBudgetMs,
    ).toBe(4_000);
  });

  test("preferred stream or source records an explicit source decision", () => {
    expect(
      selectReadyStream(candidates, { startupPriority: "balanced", preferredStreamId: "720" })
        .decision.reason,
    ).toBe("explicit-source");

    const sourceCandidates = [
      streamCandidate({ id: "720", sourceId: "source:test:720", qualityRank: 720 }),
      streamCandidate({ id: "1080", sourceId: "source:test:1080", qualityRank: 1080 }),
    ] as const satisfies readonly StreamCandidate[];

    expect(
      selectReadyStream(sourceCandidates, {
        startupPriority: "balanced",
        preferredSourceId: "source:test:720",
      }).decision.reason,
    ).toBe("explicit-source");
  });

  test("preferProviderReadyOrder keeps provider ranking over pure max quality", () => {
    const result = selectReadyStream(candidates, {
      startupPriority: "balanced",
      preferProviderReadyOrder: true,
    });
    expect(result.selected.id).toBe("720");
    expect(result.decision.reason).toBe("balanced-ready");
  });

  test("preferProviderReadyOrder yields to quality preference and quality-first", () => {
    expect(
      selectReadyStream(candidates, {
        startupPriority: "balanced",
        preferProviderReadyOrder: true,
        qualityPreference: "1080",
      }).selected.id,
    ).toBe("1080");
    expect(
      selectReadyStream(candidates, {
        startupPriority: "quality-first",
        preferProviderReadyOrder: true,
      }).selected.id,
    ).toBe("1080");
  });
});

describe("selectReadyStream — favorites", () => {
  const streams = [
    streamCandidate({ id: "a", serverName: "Neon", qualityRank: 1080 }),
    streamCandidate({ id: "b", serverName: "Fade", qualityRank: 1080 }),
    streamCandidate({ id: "c", serverName: "Fade", qualityRank: 720 }),
  ] as const satisfies readonly StreamCandidate[];

  test("prefers highest-quality favorite when no explicit selection", () => {
    const result = selectReadyStream(streams, { favoriteSourceNames: ["fade"] });
    expect(result.selected.id).toBe("b");
    expect(result.decision.reason).toBe("favorite-source");
  });

  test("favorite source order wins before quality across different favorite sources", () => {
    const result = selectReadyStream(streams, { favoriteSourceNames: ["fade", "neon"] });
    expect(result.selected.id).toBe("b");
    expect(result.decision.reason).toBe("favorite-source");
  });

  test("explicit selection still wins over favorite", () => {
    expect(
      selectReadyStream(streams, { favoriteSourceNames: ["fade"], preferredStreamId: "a" }).selected
        .id,
    ).toBe("a");
  });

  test("empty favorites = unchanged default (highest quality, original tie order)", () => {
    expect(selectReadyStream(streams, { favoriteSourceNames: [] }).selected.id).toBe("a");
  });

  test("favorite absent from streams falls back to default", () => {
    const result = selectReadyStream(streams, { favoriteSourceNames: ["killjoy"] });
    expect(result.selected.id).toBe("a");
    expect(result.decision.reason).not.toBe("favorite-source");
  });
});

describe("selectReadyStream — preferredAudioLanguage", () => {
  const multiAudioStreams = [
    streamCandidate({ id: "en-1080", qualityRank: 1080, audioLanguages: ["en"] }),
    streamCandidate({ id: "hi-720", qualityRank: 720, audioLanguages: ["hi"] }),
    streamCandidate({ id: "es-1080", qualityRank: 1080, audioLanguages: ["es"] }),
  ];

  test("selects preferred audio language matching stream over higher-quality non-matching stream", () => {
    const result = selectReadyStream(multiAudioStreams, { preferredAudioLanguage: "hi" });
    expect(result.selected.id).toBe("hi-720");
  });

  test("within preferred audio language, highest quality wins", () => {
    const streamsWithMultiple = [
      ...multiAudioStreams,
      streamCandidate({ id: "hi-1080", qualityRank: 1080, audioLanguages: ["hi"] }),
    ];
    const result = selectReadyStream(streamsWithMultiple, { preferredAudioLanguage: "hi" });
    expect(result.selected.id).toBe("hi-1080");
  });

  test("gracefully falls back to highest quality stream if preferred audio language is missing", () => {
    const result = selectReadyStream(multiAudioStreams, { preferredAudioLanguage: "de" });
    expect(result.selected.id).toBe("en-1080");
  });
});

function streamCandidate(
  overrides: Pick<StreamCandidate, "id"> & Partial<StreamCandidate>,
): StreamCandidate {
  return {
    providerId: "test",
    protocol: "hls",
    confidence: 1,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [],
    },
    ...overrides,
  };
}
