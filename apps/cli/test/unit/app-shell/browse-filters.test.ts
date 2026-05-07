import { describe, expect, test } from "bun:test";

import {
  applyBrowseResultFilters,
  describeBrowseResultFilters,
  parseBrowseFilterQuery,
} from "@/app-shell/browse-filters";
import type { BrowseShellOption } from "@/app-shell/types";

const OPTIONS: readonly BrowseShellOption<string>[] = [
  {
    value: "breaking-bad",
    label: "Breaking Bad",
    previewMeta: ["Series", "2008"],
    previewRating: "9.5/10 TMDB",
  },
  {
    value: "el-camino",
    label: "El Camino",
    previewMeta: ["Movie", "2019"],
    previewRating: "7.3/10 TMDB",
  },
  {
    value: "better-call-saul",
    label: "Better Call Saul",
    previewMeta: ["Series", "2015"],
    previewRating: "9.0/10 TMDB",
  },
];

describe("browse filters", () => {
  test("strips supported filter tokens while preserving the provider search query", () => {
    const parsed = parseBrowseFilterQuery("breaking bad type:series year:2008 rating:9");

    expect(parsed.searchQuery).toBe("breaking bad");
    expect(parsed.filters).toEqual({
      type: "series",
      year: "2008",
      minRating: 9,
    });
  });

  test("keeps plain words that look like media types unless they use token syntax", () => {
    const parsed = parseBrowseFilterQuery("the series");

    expect(parsed.searchQuery).toBe("the series");
    expect(parsed.filters.type).toBe("all");
  });

  test("filters browse options locally without extra provider calls", () => {
    const parsed = parseBrowseFilterQuery("bad type:series rating:9 year:2008");
    const filtered = applyBrowseResultFilters(OPTIONS, parsed.filters);

    expect(filtered.map((option) => option.value)).toEqual(["breaking-bad"]);
    expect(describeBrowseResultFilters(parsed.filters)).toEqual([
      "type series",
      "year 2008",
      "rating >= 9",
    ]);
  });
});
