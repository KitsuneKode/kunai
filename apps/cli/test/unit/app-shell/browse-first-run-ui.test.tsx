import { describe, expect, test } from "bun:test";

import {
  BrowseLoadingBlock,
  browseEmptyDetail,
  browseQueryHint,
  COLD_START_ACTIONS,
  COLD_START_LABEL,
  noResultsTitle,
  picksFocusZone,
  STARTUP_EMPTY_TITLE,
} from "@/app-shell/browse-first-run-ui";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";

const HINT = {
  commandMode: false,
  suggesting: false,
  optionCount: 0,
  canFocusIdleRows: false,
  listFocused: false,
  queryEmpty: true,
  loadingPicks: false,
};

describe("first-run Browse", () => {
  test("picks that loaded on their own never take the search field", () => {
    expect(picksFocusZone(12, true)).toBe("query");
    // The reverse: picks the user asked for own the list, as before.
    expect(picksFocusZone(12, false)).toBe("list");
    expect(picksFocusZone(0, false)).toBe("query");
  });

  test("the hint says the field is live while picks load", () => {
    expect(browseQueryHint({ ...HINT, loadingPicks: true })).toBe(
      "Type a title, then enter · no need to wait",
    );
  });

  test("with picks listed and the field empty, the hint names both ways on", () => {
    expect(browseQueryHint({ ...HINT, optionCount: 12 })).toBe(
      "Type a title, then enter · ↓ picks",
    );
    expect(browseQueryHint({ ...HINT, optionCount: 12, queryEmpty: false })).toBe(
      "↓ results · / commands",
    );
    // Once the list has focus, say so: bare keys act on the row, not the field.
    expect(browseQueryHint({ ...HINT, optionCount: 12, listFocused: true })).toBe(
      "results own keys · Esc search",
    );
  });

  test("the idle hints are unchanged", () => {
    expect(browseQueryHint({ ...HINT, canFocusIdleRows: true })).toBe(
      "Type a title · ↓ for you now · / commands",
    );
    expect(browseQueryHint({ ...HINT, commandMode: true })).toBeUndefined();
  });

  test("the cold start offers commands instead of a bare spinner", () => {
    const handle = render(
      <BrowseLoadingBlock message={COLD_START_LABEL} coldStart width={98} rows={30} />,
      {
        columns: 100,
        rows: 30,
      },
    );
    try {
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("Finding something to watch…");
      expect(frame).toContain("Or start here");
      for (const action of COLD_START_ACTIONS) expect(frame).toContain(action.command);
      expect(frame).toContain("what is popular this week");
    } finally {
      handle.unmount();
    }
  });

  test("a search the user is waiting on keeps the ordinary loader", () => {
    const handle = render(
      <BrowseLoadingBlock message="Searching…" coldStart={false} width={98} rows={12} />,
      {
        columns: 100,
        rows: 12,
      },
    );
    try {
      const frame = stripAnsi(handle.lastFrame());
      expect(frame).toContain("Searching…");
      expect(frame).not.toContain("Or start here");
    } finally {
      handle.unmount();
    }
  });

  test("an empty answer names the lane that was searched", () => {
    expect(noResultsTitle("frieren", "series")).toBe('No results for "frieren" in shows & movies');
    expect(noResultsTitle("dune", "anime")).toBe('No results for "dune" in anime');
  });

  test("picks that never arrived say what to do without claiming a cause", () => {
    expect(browseEmptyDetail("series", STARTUP_EMPTY_TITLE)).toBe(
      "Type a title to search. No connection? Check it, then run /discover.",
    );
    expect(browseEmptyDetail("series", "anything else")).toBeUndefined();
  });
});
