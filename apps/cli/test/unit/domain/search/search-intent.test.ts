import { describe, expect, test } from "bun:test";

import {
  clearFilterStateKey,
  describeFilterStateChips,
  filterStateToSearchIntent,
  normalizeFilterState,
  normalizeSearchIntent,
} from "@/domain/search/SearchIntent";

describe("SearchIntent", () => {
  test("normalizes empty optional filters without changing query", () => {
    expect(
      normalizeSearchIntent({
        query: "Dune",
        mode: "series",
        filters: {},
      }),
    ).toEqual({
      query: "Dune",
      mode: "series",
      filters: {},
      sort: "relevance",
    });
  });

  test("clamps unsupported year ranges into ordered ranges", () => {
    expect(
      normalizeSearchIntent({
        query: "crime",
        mode: "all",
        filters: { year: { from: 2022, to: 1999 } },
      }).filters.year,
    ).toEqual({ from: 1999, to: 2022 });
  });

  test("converts stacked filter state into a search intent", () => {
    const state = normalizeFilterState({
      query: "isekai",
      mode: "anime",
      genres: [" fantasy ", "action"],
      year: { from: 2026, to: 2024 },
      minRating: 12,
      watched: "unwatched",
      downloaded: false,
      release: "this-week",
      audio: "ja",
      subtitles: "en",
      provider: "allanime",
      sort: "rating",
    });

    expect(filterStateToSearchIntent(state, "series")).toEqual({
      query: "isekai",
      mode: "anime",
      filters: {
        genres: ["fantasy", "action"],
        year: { from: 2024, to: 2026 },
        minRating: 10,
        watched: "unwatched",
        downloaded: false,
        release: "this-week",
        audio: "ja",
        subtitles: "en",
        provider: "allanime",
      },
      sort: "rating",
    });
  });

  test("clears one filter chip without erasing unrelated state", () => {
    const state = normalizeFilterState({
      query: "Dune",
      mode: "series",
      genres: ["drama"],
      year: 2021,
      minRating: 8,
    });

    const cleared = clearFilterStateKey(state, "year");

    expect(describeFilterStateChips(cleared)).toEqual([
      "mode series",
      "genre drama",
      "rating >= 8",
    ]);
  });
});
