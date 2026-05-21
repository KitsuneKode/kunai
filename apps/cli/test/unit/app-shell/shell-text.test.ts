import { describe, expect, test } from "bun:test";

import { truncateAtWord } from "@/app-shell/shell-text";

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
