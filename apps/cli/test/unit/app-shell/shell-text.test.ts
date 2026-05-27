import { describe, expect, test } from "bun:test";

import {
  dedupeEpisodeLabel,
  measureColumns,
  padColumnsEnd,
  padColumnsStart,
  truncateAtWord,
  truncateLine,
} from "@/app-shell/shell-text";

describe("dedupeEpisodeLabel", () => {
  test("collapses the 'Episode N · Episode N' duplication", () => {
    expect(dedupeEpisodeLabel(7, "Episode 7")).toBe("Episode 7");
    expect(dedupeEpisodeLabel(7, "episode 7")).toBe("Episode 7");
    expect(dedupeEpisodeLabel(7, "  Episode 7  ")).toBe("Episode 7");
  });
  test("keeps a real episode title", () => {
    expect(dedupeEpisodeLabel(7, "The Reckoning")).toBe("Episode 7  ·  The Reckoning");
  });
  test("falls back to 'Episode N' when no name is provided", () => {
    expect(dedupeEpisodeLabel(7, undefined)).toBe("Episode 7");
    expect(dedupeEpisodeLabel(7, "")).toBe("Episode 7");
  });
});

describe("truncateAtWord", () => {
  test("returns input when it fits", () => {
    expect(truncateAtWord("blue collar", 20)).toBe("blue collar");
  });
  test("breaks on a word boundary, never mid-word", () => {
    // guards the "...no more than blue-col" mid-word cut bug
    expect(truncateAtWord("take down corrupt superheroes", 18)).toBe("take down corrupt…");
  });
  test("falls back to a hard cut when the first word exceeds width", () => {
    expect(truncateAtWord("supercalifragilistic", 6)).toBe("super…");
  });
  test("handles tiny widths", () => {
    expect(truncateAtWord("anything", 1)).toBe("…");
    expect(truncateAtWord("anything", 0)).toBe("");
  });
});

describe("terminal column text helpers", () => {
  test("truncates CJK titles by display columns instead of UTF-16 length", () => {
    const truncated = truncateLine("葬送のフリーレン season finale", 12);

    expect(truncated).toBe("葬送のフリ…");
    expect(measureColumns(truncated)).toBeLessThanOrEqual(12);
  });

  test("pads double-width titles to a stable terminal column width", () => {
    const padded = padColumnsEnd("推し", 6);

    expect(padded).toBe("推し  ");
    expect(measureColumns(padded)).toBe(6);
  });

  test("left-pads double-width metadata to a stable terminal column width", () => {
    const padded = padColumnsStart("映画", 6);

    expect(padded).toBe("  映画");
    expect(measureColumns(padded)).toBe(6);
  });
});
