import { describe, expect, test } from "bun:test";

import { buildBrowseIdleReturnLoopModel } from "@/app-shell/browse-idle-actions";
import {
  browseSearchReducer,
  createInitialBrowseSearchState,
} from "@/app-shell/browse-search-state";

describe("browse-shell characterization", () => {
  test("submit-query resets selection and clears details", () => {
    const next = browseSearchReducer(
      {
        ...createInitialBrowseSearchState(),
        selectedIndex: 3,
        detailsOpen: true,
        detailsScroll: 2,
      },
      { type: "submit-query", submittedQuery: "frieren" },
    );

    expect(next.submittedQuery).toBe("frieren");
    expect(next.selectedIndex).toBe(0);
    expect(next.detailsOpen).toBe(false);
    expect(next.detailsScroll).toBe(0);
  });

  test("idle return loop surfaces continue watching when focused", () => {
    const model = buildBrowseIdleReturnLoopModel(
      {
        continueWatching: {
          title: "Frieren",
          ep: "S01E01",
          titleId: "tmdb:1",
          mediaKind: "series",
        },
        todayReleaseCount: 0,
        todayReleaseTitleCount: 0,
      },
      { idleFocused: true },
    );

    expect(model?.rows.some((row) => row.id === "continue")).toBe(true);
  });
});
