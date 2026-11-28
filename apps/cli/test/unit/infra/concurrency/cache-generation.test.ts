import { describe, expect, test } from "bun:test";

import { createCacheGenerationGate } from "@/infra/concurrency/cache-generation";

describe("cache generation gate", () => {
  test("commits only while the captured generation is current and the fetch is complete", () => {
    const gate = createCacheGenerationGate();
    const token = gate.capture();
    let writes = 0;
    expect(
      gate.commitIfFresh(token, {}, () => {
        writes += 1;
      }),
    ).toBe(true);
    expect(writes).toBe(1);

    const controller = new AbortController();
    controller.abort();
    expect(
      gate.commitIfFresh(token, { signal: controller.signal }, () => {
        writes += 1;
      }),
    ).toBe(false);

    expect(
      gate.commitIfFresh(token, { complete: false }, () => {
        writes += 1;
      }),
    ).toBe(false);
    expect(writes).toBe(1);

    const stale = gate.capture();
    expect(gate.invalidate()).toBe(1);
    expect(gate.isCurrent(stale)).toBe(false);
    expect(
      gate.commitIfFresh(stale, { complete: true }, () => {
        writes += 1;
      }),
    ).toBe(false);
    expect(
      gate.commitIfFresh(gate.capture(), {}, () => {
        writes += 1;
      }),
    ).toBe(true);
    expect(writes).toBe(2);
  });

  test("onInvalidate fires on invalidate and the unsubscribe stops it", () => {
    const gate = createCacheGenerationGate();
    let calls = 0;
    const stop = gate.onInvalidate(() => {
      calls += 1;
    });
    gate.invalidate();
    stop();
    gate.invalidate();
    expect(calls).toBe(1);
  });
});
