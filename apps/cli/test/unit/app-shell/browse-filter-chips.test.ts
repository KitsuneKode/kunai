import { describe, expect, test } from "bun:test";

import {
  getLastFilterStateKey,
  nextBrowseEscFilterLayer,
  removeFilterTokenFromQuery,
  shouldResearchAfterFilterChange,
  stripStructuredFiltersFromQuery,
} from "@/app-shell/browse-filter-chips";
import {
  clearBrowseResultFilter,
  describeBrowseResultFilters,
  parseBrowseFilterQuery,
} from "@/app-shell/browse-filters";
import { normalizeFilterState } from "@/domain/search/SearchIntent";

describe("browse filter chips", () => {
  test("clearing one chip keeps the others", () => {
    const raw = "isekai mode:anime year:2024 rating:8 genre:action";
    const parsed = parseBrowseFilterQuery(raw);
    const withoutYear = clearBrowseResultFilter(parsed.filters, "year");
    expect(describeBrowseResultFilters(withoutYear)).toEqual([
      "mode anime",
      "genre action",
      "rating >= 8",
    ]);
    expect(removeFilterTokenFromQuery(raw, "year")).toBe("isekai mode:anime genre:action rating:8");
  });

  test("Esc ladder prefers narrow then chips then results", () => {
    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: true,
        resultFilterNonEmpty: true,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("narrow");

    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("chips");

    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 0,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("results");
  });

  test("removeFilterTokenFromQuery round-trips remaining structured tokens", () => {
    const raw = "mob mode:anime year:2024 rating:7 genre:action,comedy";
    expect(removeFilterTokenFromQuery(raw, "mode")).toBe(
      "mob genre:action,comedy year:2024 rating:7",
    );
    expect(removeFilterTokenFromQuery(raw, "genres")).toBe("mob mode:anime year:2024 rating:7");
  });

  test("stripStructuredFiltersFromQuery keeps plain search text only", () => {
    expect(stripStructuredFiltersFromQuery("isekai mode:anime year:2024")).toBe("isekai");
    expect(stripStructuredFiltersFromQuery("mode:anime year:2024")).toBe("");
  });

  test("getLastFilterStateKey follows chip describe order", () => {
    const state = normalizeFilterState({
      query: "isekai",
      mode: "anime",
      year: 2024,
      minRating: 8,
    });
    expect(getLastFilterStateKey(state)).toBe("minRating");
  });

  describe("shouldResearchAfterFilterChange", () => {
    test("re-searches even when the current list is empty (over-filtered)", () => {
      expect(
        shouldResearchAfterFilterChange({
          searchState: "ready",
          lastSearchedQuery: "mob downloaded:true",
          nextQuery: "mob",
        }),
      ).toBe(true);
    });

    test("re-searches from an error state so a bad filter can be peeled", () => {
      expect(
        shouldResearchAfterFilterChange({
          searchState: "error",
          lastSearchedQuery: "mob type:playlist",
          nextQuery: "mob",
        }),
      ).toBe(true);
    });

    test("does not re-search when no prior search was run", () => {
      expect(
        shouldResearchAfterFilterChange({
          searchState: "idle",
          lastSearchedQuery: "",
          nextQuery: "mob",
        }),
      ).toBe(false);
    });

    test("does not re-search when clearing empties the query entirely", () => {
      expect(
        shouldResearchAfterFilterChange({
          searchState: "ready",
          lastSearchedQuery: "mode:anime",
          nextQuery: "   ",
        }),
      ).toBe(false);
    });
  });
});
