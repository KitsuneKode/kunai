import { describe, expect, test } from "bun:test";

import { decideBrowseFilterAction } from "@/app-shell/browse-filter-actions";

describe("decideBrowseFilterAction", () => {
  test("/filters opens facets when idle", () => {
    expect(
      decideBrowseFilterAction({
        action: "filters",
        searchState: "idle",
        optionCount: 0,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-facets" });
  });

  test("/filters opens facets when results are loaded", () => {
    expect(
      decideBrowseFilterAction({
        action: "filters",
        searchState: "ready",
        optionCount: 12,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-facets" });
  });

  test("Ctrl+F narrows only when results exist", () => {
    expect(
      decideBrowseFilterAction({
        action: "narrow-results",
        searchState: "ready",
        optionCount: 12,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-narrow" });

    expect(
      decideBrowseFilterAction({
        action: "narrow-results",
        searchState: "idle",
        optionCount: 0,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "ignore" });
  });
});
