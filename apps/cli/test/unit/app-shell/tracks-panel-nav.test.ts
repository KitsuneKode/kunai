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
