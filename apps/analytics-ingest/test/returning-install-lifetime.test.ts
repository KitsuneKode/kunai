import { describe, expect, test } from "bun:test";

import { createMemoryAnalyticsStore } from "../src/memory-store";

const ping = {
  version: "0.0.0-test",
  os: "linux",
  arch: "x64",
} as const;

describe("returning install lifetime", () => {
  test("a pruned install that pings again counts once, not as live plus retired", async () => {
    const store = createMemoryAnalyticsStore();
    await store.recordPing({ day: "1999-01-01", installHash: "abc", ...ping });
    expect((await store.rollUpDay("1999-01-02")).lifetimeInstalls).toBe(1);

    expect((await store.pruneLifetimeBefore("1999-01-02")).retired).toBe(1);
    expect((await store.rollUpDay("1999-01-02")).lifetimeInstalls).toBe(1);

    await store.recordPing({ day: "1999-02-01", installHash: "abc", ...ping });
    expect((await store.rollUpDay("1999-02-01")).lifetimeInstalls).toBe(1);
  });
});
