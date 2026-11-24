import { describe, expect, test } from "bun:test";

import {
  formatChecklistSelectionCount,
  toggleVisibleChecklistSelection,
  type ListOption,
} from "@/app-shell/checklist-shell";

const OPTIONS: readonly ListOption<number>[] = [
  { value: 1, label: "Episode 1" },
  { value: 2, label: "Episode 2" },
  { value: 3, label: "Episode 3" },
  { value: 4, label: "Episode 4" },
];

describe("checklist-shell selection helpers", () => {
  test("toggleVisibleChecklistSelection selects visible items without wiping hidden selections", () => {
    // Episode 1 is checked while unfiltered; then the user filters to Episodes 2 & 3.
    const initial = new Set([1]);
    const filtered = OPTIONS.slice(1, 3);

    const afterSelectAllVisible = toggleVisibleChecklistSelection(initial, filtered);
    expect([...afterSelectAllVisible].sort()).toEqual([1, 2, 3]);

    // Pressing Ctrl+A again unchecks only the visible subset and keeps Episode 1.
    const afterUnselectAllVisible = toggleVisibleChecklistSelection(
      afterSelectAllVisible,
      filtered,
    );
    expect([...afterUnselectAllVisible].sort()).toEqual([1]);
  });

  test("toggleVisibleChecklistSelection does not clear a same-sized disjoint selection", () => {
    // Previously `current.size === filteredOptions.length` wrongly cleared {1, 2}
    // when filtered to {3, 4}.
    const initial = new Set([1, 2]);
    const filtered = OPTIONS.slice(2, 4);

    const next = toggleVisibleChecklistSelection(initial, filtered);
    expect([...next].sort()).toEqual([1, 2, 3, 4]);
  });

  test("toggleVisibleChecklistSelection is a no-op when no items match the filter", () => {
    const initial = new Set([1]);
    const next = toggleVisibleChecklistSelection(initial, []);
    expect([...next]).toEqual([1]);
  });

  test("formatChecklistSelectionCount uses singular and plural grammar", () => {
    expect(formatChecklistSelectionCount(1)).toBe("1 item");
    expect(formatChecklistSelectionCount(2)).toBe("2 items");
    expect(formatChecklistSelectionCount(0)).toBe("0 items");
  });
});
