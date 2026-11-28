import { describe, expect, test } from "bun:test";

import {
  COMPACT_LIST_FILTER_MAX_OPTIONS,
  resolveCompactListShortcut,
  shouldShowListFilter,
} from "@/app-shell/pickers/list-shell-filter";

describe("list shell filter preference", () => {
  test("auto hides the filter at the compact fixed-action threshold", () => {
    expect(shouldShowListFilter("auto", COMPACT_LIST_FILTER_MAX_OPTIONS)).toBe(false);
    expect(shouldShowListFilter("auto", COMPACT_LIST_FILTER_MAX_OPTIONS + 1)).toBe(true);
  });

  test("always and never override the count", () => {
    expect(shouldShowListFilter("always", 2)).toBe(true);
    expect(shouldShowListFilter("never", 20)).toBe(false);
  });
});

describe("compact list shortcuts", () => {
  test("digits select rows positionally and explicit letters activate", () => {
    const rows = [{}, { shortcut: "e" }, {}];
    expect(resolveCompactListShortcut("1", rows)).toBe(0);
    expect(resolveCompactListShortcut("2", rows)).toBe(1);
    expect(resolveCompactListShortcut("e", rows)).toBe(1);
    expect(resolveCompactListShortcut("d", rows)).toBeNull();
    expect(resolveCompactListShortcut("4", rows)).toBeNull();
  });
});
