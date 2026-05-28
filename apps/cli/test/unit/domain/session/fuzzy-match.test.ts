import { describe, expect, test } from "bun:test";

import { fuzzyMatchScore, rankFuzzyMatches } from "@/domain/session/fuzzy-match";

describe("fuzzyMatchScore", () => {
  test("ranks exact above prefix above word-boundary above subsequence", () => {
    const exact = fuzzyMatchScore("play", "play");
    const prefix = fuzzyMatchScore("pla", "playback");
    const word = fuzzyMatchScore("sea", "open search");
    const subsequence = fuzzyMatchScore("pb", "playback");

    expect(exact).not.toBeNull();
    expect(prefix).not.toBeNull();
    expect(word).not.toBeNull();
    expect(subsequence).not.toBeNull();
    expect(exact!).toBeLessThan(prefix!);
    expect(prefix!).toBeLessThan(word!);
    expect(word!).toBeLessThan(subsequence!);
  });

  test("prefers shorter targets at equal match quality", () => {
    const short = fuzzyMatchScore("rec", "recover");
    const long = fuzzyMatchScore("rec", "recover-playback-stream");
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(short!).toBeLessThan(long!);
  });

  test("ranks palette commands with obvious prefix ahead of scattered noise", () => {
    const ranked = rankFuzzyMatches(
      [
        { id: "diagnostics", label: "Diagnostics panel" },
        { id: "download", label: "Download current title" },
        { id: "discover", label: "Open discover recommendations" },
      ],
      "dia",
      (item) => [item.label, item.id],
    );
    expect(ranked[0]?.id).toBe("diagnostics");
  });
});
