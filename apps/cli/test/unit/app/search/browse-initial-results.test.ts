import { describe, expect, test } from "bun:test";

import type { BrowseShellOption } from "@/app-shell/types";
import { buildBrowseInitialResults } from "@/app/search/browse-initial-results";

const OPTIONS: readonly BrowseShellOption<string>[] = [
  {
    value: "movie",
    label: "A Movie",
    previewMeta: ["Movie", "2024"],
    localFilterFacts: { mediaType: "movie" },
  },
  {
    value: "series",
    label: "A Series",
    previewMeta: ["Series", "2024"],
    localFilterFacts: { mediaType: "series" },
  },
];

describe("buildBrowseInitialResults", () => {
  test("passes results through untouched when the query has no structured filters", () => {
    const result = buildBrowseInitialResults({ options: OPTIONS, query: "dune" });
    expect(result.options.map((o) => o.value)).toEqual(["movie", "series"]);
    expect(result.subtitleSuffix).toBe("");
    expect(result.activeBadges).toEqual([]);
  });

  test("applies the same local narrowing that interactive Enter search uses", () => {
    const result = buildBrowseInitialResults({
      options: OPTIONS,
      query: "dune type:movie",
    });
    // Bootstrap / -S must narrow identically to Enter — only the movie survives.
    expect(result.options.map((o) => o.value)).toEqual(["movie"]);
    expect(result.activeBadges.some((badge) => badge.includes("type movie"))).toBe(true);
  });

  test("preserves upstream/unsupported evidence badges from the search response", () => {
    const result = buildBrowseInitialResults({
      options: OPTIONS,
      query: "dune type:movie",
      evidence: { upstream: ["genre drama"], local: [], unsupported: ["watched watching"] },
    });
    expect(result.activeBadges).toContain("upstream genre drama");
    expect(result.activeBadges).toContain("unsupported watched watching");
    expect(result.subtitleSuffix).toContain("·");
  });
});
