import { describe, expect, test } from "bun:test";

import { createBrowseSearchAbort } from "@/app/search/browse-search-abort";

describe("createBrowseSearchAbort", () => {
  test("stays live when type-ahead cancels but phase signal does not", () => {
    const phase = new AbortController();
    const search = createBrowseSearchAbort(phase.signal);
    expect(search.signal.aborted).toBe(false);
    search.dispose();
    expect(search.signal.aborted).toBe(false);
  });

  test("forwards phase cancellation", () => {
    const phase = new AbortController();
    const search = createBrowseSearchAbort(phase.signal);
    phase.abort();
    expect(search.signal.aborted).toBe(true);
    search.dispose();
  });
});
