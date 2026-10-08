import { describe, expect, test } from "bun:test";

import { HealthTracker, TTLCache } from "../src/shared/provider-cache";

describe("TTLCache expiry", () => {
  test("deletes an expired entry on access rather than returning it", () => {
    let now = 1_000;
    const cache = new TTLCache<string, string>(100, { now: () => now });

    cache.set("a", "value");
    expect(cache.get("a")).toBe("value");

    now = 1_101;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("prune drops every expired entry and keeps live ones", () => {
    let now = 0;
    const cache = new TTLCache<string, string>(100, { now: () => now });

    cache.set("old", "1");
    now = 60;
    cache.set("new", "2");
    now = 120;

    cache.prune();

    expect(cache.size).toBe(1);
    expect(cache.get("new")).toBe("2");
  });
});

describe("TTLCache size bound", () => {
  test("evicts the oldest entry once the bound is exceeded", () => {
    const cache = new TTLCache<string, number>(10_000, { maxEntries: 3 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });

  test("replacing an existing key does not grow the cache or evict a peer", () => {
    const cache = new TTLCache<string, number>(10_000, { maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 99);

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(99);
    expect(cache.get("b")).toBe(2);
  });

  test("prefers evicting an expired entry over a live one", () => {
    let now = 0;
    const cache = new TTLCache<string, number>(100, { maxEntries: 2, now: () => now });

    cache.set("stale", 1);
    now = 50;
    cache.set("live", 2);
    now = 120; // "stale" has expired, "live" has not

    cache.set("fresh", 3);

    expect(cache.size).toBe(2);
    expect(cache.get("live")).toBe(2);
    expect(cache.get("fresh")).toBe(3);
  });

  test("stays bounded under sustained unique writes", () => {
    const cache = new TTLCache<string, number>(10_000, { maxEntries: 16 });

    for (let i = 0; i < 1_000; i++) cache.set(`key-${i}`, i);

    expect(cache.size).toBe(16);
    expect(cache.get("key-999")).toBe(999);
  });

  test("is unbounded when no bound is configured, preserving existing callers", () => {
    const cache = new TTLCache<string, number>(10_000);

    for (let i = 0; i < 100; i++) cache.set(`key-${i}`, i);

    expect(cache.size).toBe(100);
  });

  test("clear empties everything", () => {
    const cache = new TTLCache<string, number>(10_000, { maxEntries: 4 });

    cache.set("a", 1);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("HealthTracker cooldown", () => {
  test("cools down after max failures and recovers past the deadline", () => {
    let now = 1_000;
    const tracker = new HealthTracker(60_000, 2, { now: () => now });

    expect(tracker.recordFailure("srv")).toBe(true);
    expect(tracker.shouldTry("srv")).toBe(true);
    expect(tracker.recordFailure("srv")).toBe(false);
    expect(tracker.shouldTry("srv")).toBe(false);
    expect(tracker.failureCount("srv")).toBe(2);

    now = 61_001;
    expect(tracker.shouldTry("srv")).toBe(true);
    // Expiry resets the count, so the next failure starts over.
    expect(tracker.failureCount("srv")).toBe(0);
    expect(tracker.recordFailure("srv")).toBe(true);
  });

  test("success clears failures and cooldowns", () => {
    let now = 0;
    const tracker = new HealthTracker(60_000, 1, { now: () => now });

    expect(tracker.recordFailure("srv")).toBe(false);
    expect(tracker.shouldTry("srv")).toBe(false);
    tracker.recordSuccess("srv");
    expect(tracker.shouldTry("srv")).toBe(true);
    expect(tracker.failureCount("srv")).toBe(0);
  });
});
