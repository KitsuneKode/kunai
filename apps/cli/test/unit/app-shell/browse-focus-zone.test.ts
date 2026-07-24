import { describe, expect, test } from "bun:test";

import {
  browseFocusZoneReducer,
  createInitialBrowseFocusZone,
  isBrowseFilterFocused,
  isBrowseIdleFocused,
  isBrowseListFocused,
  isBrowseQueryFocused,
  isBrowseTextInputZone,
  type BrowseFocusZoneContext,
} from "@/app-shell/browse-focus-zone";

const withResults: BrowseFocusZoneContext = {
  hasResults: true,
  hasFilterBar: true,
  canFocusIdle: false,
};

const idleOnly: BrowseFocusZoneContext = {
  hasResults: false,
  hasFilterBar: false,
  canFocusIdle: true,
};

describe("createInitialBrowseFocusZone", () => {
  test("defaults to query", () => {
    expect(createInitialBrowseFocusZone()).toBe("query");
  });

  test("can start on idle continue row", () => {
    expect(createInitialBrowseFocusZone({ startIdle: true })).toBe("idle");
  });
});

describe("browseFocusZoneReducer", () => {
  test("↓ from query enters list when results exist", () => {
    expect(browseFocusZoneReducer("query", { type: "arrow-down" }, withResults)).toBe("list");
  });

  test("↓ from query enters idle when no results but continue row is available", () => {
    expect(browseFocusZoneReducer("query", { type: "arrow-down" }, idleOnly)).toBe("idle");
  });

  test("↑ at top of list keeps list focus so the shell can wrap to the last row", () => {
    // The list is a closed loop: neither edge exits to the search box. Esc is
    // the only list → query gesture, so ↑ on row 0 must not leak focus out.
    expect(browseFocusZoneReducer("list", { type: "arrow-up" }, withResults)).toBe("list");
  });

  test("↓ at bottom of list keeps list focus so the shell can wrap to the first row", () => {
    expect(browseFocusZoneReducer("list", { type: "arrow-down" }, withResults)).toBe("list");
  });

  test("↑ from query with results enters list zone", () => {
    expect(browseFocusZoneReducer("query", { type: "arrow-up" }, withResults)).toBe("list");
  });

  test("ctrl+f shortcut focuses filter when filter bar is available", () => {
    expect(browseFocusZoneReducer("query", { type: "focus-filter-shortcut" }, withResults)).toBe(
      "filter",
    );
    expect(browseFocusZoneReducer("list", { type: "focus-filter-shortcut" }, withResults)).toBe(
      "filter",
    );
  });

  test("filter shortcut is ignored without a filter bar", () => {
    expect(
      browseFocusZoneReducer(
        "query",
        { type: "focus-filter-shortcut" },
        { ...withResults, hasFilterBar: false },
      ),
    ).toBe("query");
  });

  test("escape steps back from list, filter, and idle to query", () => {
    expect(browseFocusZoneReducer("list", { type: "escape" }, withResults)).toBe("query");
    expect(browseFocusZoneReducer("filter", { type: "escape" }, withResults)).toBe("query");
    expect(browseFocusZoneReducer("idle", { type: "escape" }, idleOnly)).toBe("query");
  });

  test("empty results pull focus out of list/filter/idle", () => {
    // BrowseShell skips applying this event while `isCalendarView` — an empty
    // calendar day must keep list focus so the next ↑/↓ is not a dead key.
    expect(browseFocusZoneReducer("list", { type: "results-became-empty" }, withResults)).toBe(
      "query",
    );
    expect(browseFocusZoneReducer("filter", { type: "clear-results" }, withResults)).toBe("query");
    expect(browseFocusZoneReducer("idle", { type: "results-became-empty" }, idleOnly)).toBe(
      "query",
    );
  });

  test("↓ from filter enters list when results exist", () => {
    expect(browseFocusZoneReducer("filter", { type: "arrow-down" }, withResults)).toBe("list");
  });

  test("explicit focus helpers respect context gates", () => {
    expect(browseFocusZoneReducer("query", { type: "focus-list" }, idleOnly)).toBe("query");
    expect(browseFocusZoneReducer("query", { type: "focus-filter" }, idleOnly)).toBe("query");
    expect(browseFocusZoneReducer("query", { type: "focus-idle" }, withResults)).toBe("query");
  });
});

describe("browse focus zone helpers", () => {
  test("maps zones to booleans used by browse-shell", () => {
    expect(isBrowseQueryFocused("query")).toBe(true);
    expect(isBrowseListFocused("list")).toBe(true);
    expect(isBrowseFilterFocused("filter")).toBe(true);
    expect(isBrowseIdleFocused("idle")).toBe(true);
    expect(isBrowseTextInputZone("query")).toBe(true);
    expect(isBrowseTextInputZone("filter")).toBe(true);
    expect(isBrowseTextInputZone("list")).toBe(false);
  });
});
