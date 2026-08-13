import { expect, test } from "bun:test";

import { shouldDeferBrowseIdleContext } from "@/app/search/search-startup-policy";

test("only a normal empty interactive launch defers personal context", () => {
  expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 0 })).toBe(true);
  expect(shouldDeferBrowseIdleContext({ query: "Dune", resultCount: 0 })).toBe(false);
  expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 1 })).toBe(false);
  for (const initialRoute of ["history", "calendar", "recommendation", "random"] as const) {
    expect(shouldDeferBrowseIdleContext({ query: "", resultCount: 0, initialRoute })).toBe(false);
  }
});

test("a pending calendar route always defers personal context", () => {
  // The calendar surface must paint before ANY other startup work, including a
  // preserved-search or routed open that would otherwise load idle context first.
  expect(
    shouldDeferBrowseIdleContext({ query: "", resultCount: 0, hasPendingCalendarRoute: true }),
  ).toBe(true);
  expect(
    shouldDeferBrowseIdleContext({
      query: "Dune",
      resultCount: 4,
      initialRoute: "calendar",
      hasPendingCalendarRoute: true,
    }),
  ).toBe(true);
});
