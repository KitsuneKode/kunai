import { describe, expect, test } from "bun:test";

import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

describe("withTimeoutSignal", () => {
  test("aborts when parent signal aborts without AbortSignal.any", async () => {
    const parent = new AbortController();
    const combined = withTimeoutSignal(parent.signal, 60_000);
    parent.abort();
    await Bun.sleep(0);
    expect(combined.aborted).toBe(true);
  });

  test("aborts when timeout elapses without AbortSignal.any", async () => {
    const combined = withTimeoutSignal(undefined, 5);
    await Bun.sleep(20);
    expect(combined.aborted).toBe(true);
  });
});
