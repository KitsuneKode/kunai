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

  test("fast selects the first ready candidate", () => {
    const result = selectReadyStream(candidates, { startupPriority: "fast" });

    expect(result.decision.reason).toBe("fast-start");
    expect(result.selected.id).toBe("720");
  });

  test("quality preference selects a matching ready quality", () => {
    expect(
      selectReadyStream(candidates, { startupPriority: "balanced", qualityPreference: "720" })
        .selected.id,
    ).toBe("720");
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
