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

  test("Esc ladder prefers narrow, then chips, then the typed query", () => {
    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: true,
        resultFilterNonEmpty: true,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
        hasSubmittedSearch: true,
      }),
    ).toBe("narrow");

    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
        hasSubmittedSearch: true,
      }),
    ).toBe("chips");

    // Text typed with results on screen is the ordinary state. Answering
    // "results" here reset the surface to trending instead of clearing what was
    // typed — the reload that emptying the draft was changed to stop doing.
    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 0,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
        hasSubmittedSearch: true,
      }),
    ).toBe("query");
  });

  test("results reset only when there is a search to reset from", () => {
    const base = {
      narrowOpenOrFocused: false,
      resultFilterNonEmpty: false,
      structuredChipCount: 0,
      hasResultsOrErrorOrLoading: true,
      queryNonEmpty: false,
    };

    expect(nextBrowseEscFilterLayer({ ...base, hasSubmittedSearch: true })).toBe("results");

    // Default discovery results with no search behind them. This used to answer
    // "results" forever: the reload repopulated the list, so the condition
    // stayed true and Esc could never reach "cancel" — the surface was
    // inescapable by Esc alone.
    expect(nextBrowseEscFilterLayer({ ...base, hasSubmittedSearch: false })).toBe("cancel");
  });

  test("Esc clears the query, then resets results, then leaves", () => {
    const base = {
      narrowOpenOrFocused: false,
      resultFilterNonEmpty: false,
      structuredChipCount: 0,
      hasResultsOrErrorOrLoading: true,
      hasSubmittedSearch: true,
    };

    expect(nextBrowseEscFilterLayer({ ...base, queryNonEmpty: true })).toBe("query");
    expect(nextBrowseEscFilterLayer({ ...base, queryNonEmpty: false })).toBe("results");
    // After the reset there is no search left behind the results.
    expect(
      nextBrowseEscFilterLayer({ ...base, queryNonEmpty: false, hasSubmittedSearch: false }),
    ).toBe("cancel");
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
