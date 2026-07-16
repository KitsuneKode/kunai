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
