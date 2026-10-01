import { describe, expect, test } from "bun:test";

import { EndpointResilienceTracker, TTLCache } from "../src/shared/provider-cache";

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

describe("EndpointResilienceTracker", () => {
  test("single-strike policy parks an endpoint on its first failure", () => {
    let now = 1_000;
    const tracker = new EndpointResilienceTracker({ cooldownMs: 60_000, now: () => now });

    expect(tracker.recordFailure("host-a")).toBe(false);
    expect(tracker.shouldTry("host-a")).toBe(false);

    now += 60_000;
    expect(tracker.shouldTry("host-a")).toBe(true);
  });

  test("multi-strike policy tolerates a transient blip before cooling", () => {
    const tracker = new EndpointResilienceTracker({
      cooldownMs: 60_000,
      strikesToCooldown: 2,
      now: () => 0,
    });

    expect(tracker.recordFailure("host-a")).toBe(true);
    expect(tracker.shouldTry("host-a")).toBe(true);
    expect(tracker.recordFailure("host-a")).toBe(false);
    expect(tracker.shouldTry("host-a")).toBe(false);
  });

  test("a cooldown override parks immediately regardless of strike count", () => {
    let now = 0;
    const tracker = new EndpointResilienceTracker({
      cooldownMs: 60_000,
      strikesToCooldown: 5,
      now: () => now,
    });

    expect(tracker.recordFailure("host-a", { cooldownMs: 30_000 })).toBe(false);
    expect(tracker.shouldTry("host-a")).toBe(false);

    now = 29_999;
    expect(tracker.shouldTry("host-a")).toBe(false);
    now = 30_000;
    expect(tracker.shouldTry("host-a")).toBe(true);
  });

  test("the `at` anchor lets per-call injected clocks pin the window", () => {
    const tracker = new EndpointResilienceTracker({ cooldownMs: 60_000, now: () => 0 });

    tracker.recordFailure("host-a", { at: 10_000 });
    expect(tracker.shouldTry("host-a", 69_999)).toBe(false);
    expect(tracker.shouldTry("host-a", 70_000)).toBe(true);
  });

  test("a stable success resets both the streak and the cooldown", () => {
    let now = 0;
    const tracker = new EndpointResilienceTracker({
      cooldownMs: 60_000,
      strikesToCooldown: 2,
      now: () => now,
    });

    tracker.recordFailure("host-a");
    tracker.recordFailure("host-a");
    expect(tracker.shouldTry("host-a")).toBe(false);

    tracker.recordSuccess("host-a");
    expect(tracker.shouldTry("host-a")).toBe(true);
    expect(tracker.failureCount("host-a")).toBe(0);
  });

  test("maxEntries bounds the map", () => {
    const tracker = new EndpointResilienceTracker({
      cooldownMs: 60_000,
      maxEntries: 3,
      now: () => 0,
    });

    for (let i = 0; i < 10; i++) tracker.recordFailure(`host-${i}`);

    expect(tracker.size).toBeLessThanOrEqual(3);
  });
});
