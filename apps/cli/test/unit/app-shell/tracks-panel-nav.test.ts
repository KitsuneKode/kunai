import { describe, expect, test } from "bun:test";

import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "@/app-shell/tracks-panel-nav";

const ctx = (sectionCount: number, optionCount: number) => ({ sectionCount, optionCount });

describe("tracksPanelNavReducer", () => {
  test("starts on sections pane at the deep-linked section index", () => {
    expect(createInitialTracksNav({ initialSectionIndex: 2 })).toEqual({
      focusedPane: "sections",
      sectionIndex: 2,
      optionIndex: 0,
    });
  });

  test("down/up move between sections, clamped", () => {
    let s: TracksNavState = createInitialTracksNav({});
    s = tracksPanelNavReducer(s, { type: "down" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(1);
    s = tracksPanelNavReducer({ ...s, sectionIndex: 3 }, { type: "down" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(3); // clamped at last
    s = tracksPanelNavReducer({ ...s, sectionIndex: 0 }, { type: "up" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(0); // clamped at first
  });

  test("enter moves focus into options at index 0", () => {
    expect(
      tracksPanelNavReducer(createInitialTracksNav({}), { type: "enter-section" }, ctx(4, 5)),
    ).toEqual({ focusedPane: "options", sectionIndex: 0, optionIndex: 0 });
  });

  test("down/up navigate options when in options pane, clamped", () => {
    let s: TracksNavState = { focusedPane: "options", sectionIndex: 0, optionIndex: 0 };
    s = tracksPanelNavReducer(s, { type: "down" }, ctx(4, 3));
    expect(s.optionIndex).toBe(1);
    s = tracksPanelNavReducer({ ...s, optionIndex: 2 }, { type: "down" }, ctx(4, 3));
    expect(s.optionIndex).toBe(2); // clamped
  });

  test("exit returns to sections pane keeping the section index", () => {
    expect(
      tracksPanelNavReducer(
        { focusedPane: "options", sectionIndex: 2, optionIndex: 4 },
        { type: "exit-section" },
        ctx(4, 5),
      ),
    ).toEqual({ focusedPane: "sections", sectionIndex: 2, optionIndex: 0 });
  });

  test("entering a section with no options stays in sections pane", () => {
    expect(
      tracksPanelNavReducer(createInitialTracksNav({}), { type: "enter-section" }, ctx(4, 0))
        .focusedPane,
    ).toBe("sections");
  });
});

describe("subtitle grid navigation", () => {
  // 3 columns, 10 cells → rows [0,1,2] [3,4,5] [6,7,8] [9]
  const grid = { sectionCount: 2, optionCount: 10, gridColumns: 3 };
  const inOptions = (optionIndex: number) => ({
    focusedPane: "options" as const,
    sectionIndex: 0,
    optionIndex,
  });

  test("down moves a whole row, not one cell across", () => {
    // The regression: stepping by 1 in a 3-wide grid meant "down" landed on the
    // cell to the right, so the cursor crawled sideways through the list.
    expect(tracksPanelNavReducer(inOptions(0), { type: "down" }, grid).optionIndex).toBe(3);
    expect(tracksPanelNavReducer(inOptions(4), { type: "down" }, grid).optionIndex).toBe(7);
  });

  test("up moves a whole row and holds on the first one", () => {
    expect(tracksPanelNavReducer(inOptions(7), { type: "up" }, grid).optionIndex).toBe(4);
    // Above the top row there is nowhere to go; clamping to 0 would teleport the
    // cursor to a different column.
    expect(tracksPanelNavReducer(inOptions(1), { type: "up" }, grid).optionIndex).toBe(1);
  });

  test("down clamps to the last cell on a ragged final row", () => {
    expect(tracksPanelNavReducer(inOptions(8), { type: "down" }, grid).optionIndex).toBe(9);
  });

  test("left and right step within a row, and left stops at the row start", () => {
    expect(tracksPanelNavReducer(inOptions(3), { type: "right" }, grid).optionIndex).toBe(4);
    expect(tracksPanelNavReducer(inOptions(4), { type: "left" }, grid).optionIndex).toBe(3);
    // Column 0 belongs to "leave the pane", which the caller handles.
    expect(tracksPanelNavReducer(inOptions(3), { type: "left" }, grid).optionIndex).toBe(3);
  });

  test("list sections keep single-step movement", () => {
    const list = { sectionCount: 2, optionCount: 10 };
    expect(tracksPanelNavReducer(inOptions(0), { type: "down" }, list).optionIndex).toBe(1);
    expect(tracksPanelNavReducer(inOptions(5), { type: "up" }, list).optionIndex).toBe(4);
    // Horizontal movement is meaningless in a one-per-row list.
    expect(tracksPanelNavReducer(inOptions(5), { type: "right" }, list).optionIndex).toBe(5);
  });
});
