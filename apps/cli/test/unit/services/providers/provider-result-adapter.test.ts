import { describe, expect, test } from "bun:test";

import { subtitleCandidateToTrack } from "@/services/providers/provider-result-adapter";
import type { SubtitleCandidate } from "@kunai/types";

describe("provider result adapter", () => {
  test("keeps provider aliases out of subtitle track language fields", () => {
    const track = subtitleCandidateToTrack(
      makeSubtitleCandidate({
        language: "Vietsub",
        label: "Vietsub",
      }),
    );

    expect(track.language).toBeUndefined();
    expect(track.display).toBe("Vietsub");
  });

  test("normalizes real subtitle languages and preserves display labels", () => {
    const track = subtitleCandidateToTrack(
      makeSubtitleCandidate({
        language: "Portuguese (BR)",
        label: "Portuguese (BR)",
      }),
    );

    expect(track.language).toBe("pt");
    expect(track.display).toBe("Portuguese");
  });
});

function makeSubtitleCandidate(overrides: Partial<SubtitleCandidate> = {}): SubtitleCandidate {
  return {
    id: "subtitle:test",
    providerId: "test-provider",
    url: "https://subs.example/sub.vtt",
    format: "vtt",
    source: "provider",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "subtitle-list",
      scope: "local",
      keyParts: ["test-provider", "subtitle"],
    },
    ...overrides,
  };
}
