import { describe, expect, test } from "bun:test";

import { filterBrowseOptionsByResultFilter as filterOptions } from "@/app-shell/browse-preview-rail";
import {
  browseSearchReducer,
  createInitialBrowseSearchState,
  isQueryDirty,
} from "@/app-shell/browse-search-state";
import type { BrowseShellOption } from "@/app-shell/types";

describe("browseSearchReducer", () => {
  test("keeps query draft separate from submitted query until submit", () => {
    const initial = createInitialBrowseSearchState({ queryDraft: "dune", submittedQuery: "dune" });
    const editing = browseSearchReducer(initial, {
      type: "set-query-draft",
      queryDraft: "dune part two",
    });
    expect(isQueryDirty(editing)).toBe(true);
    expect(editing.submittedQuery).toBe("dune");

    const submitted = browseSearchReducer(editing, {
      type: "submit-query",
      submittedQuery: "dune part two",
    });
    expect(isQueryDirty(submitted)).toBe(false);
    expect(submitted.submittedQuery).toBe("dune part two");
    expect(submitted.resultFilter).toBe("");
  });

  test("result filter only narrows the current set and resets selection", () => {
    const initial = createInitialBrowseSearchState({
      queryDraft: "arcane",
      submittedQuery: "arcane",
      selectedIndex: 2,
    });
    const filtered = browseSearchReducer(initial, {
      type: "set-result-filter",
      resultFilter: "movie",
    });
    expect(filtered.resultFilter).toBe("movie");
    expect(filtered.selectedIndex).toBe(0);
    expect(filtered.submittedQuery).toBe("arcane");
  });
});

describe("filterBrowseOptionsByResultFilter", () => {
  test("filters in-memory options without changing submitted query", () => {
    const options: BrowseShellOption<string>[] = [
      { value: "a", label: "Arcane", previewTitle: "Arcane", previewMeta: ["Series"] },
      { value: "b", label: "Dune", previewTitle: "Dune", previewMeta: ["Movie"] },
    ];
    expect(filterOptions(options, "movie").map((option) => option.label)).toEqual(["Dune"]);
    expect(filterOptions(options, "").length).toBe(2);
  });
});
