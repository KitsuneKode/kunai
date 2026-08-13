import { describe, expect, test } from "bun:test";

import { ByteBudgetLruCache } from "@/app-shell/poster-byte-cache";

/** A cache keyed by string holding strings, weighed by character length. */
function stringCache(options: { maxEntries?: number; maxBytes?: number } = {}) {
  const evicted: [string, string][] = [];
  const cache = new ByteBudgetLruCache<string, string>({
    maxEntries: options.maxEntries ?? 8,
    maxBytes: options.maxBytes ?? 1024,
    weight: (value) => value.length,
    onEvict: (key, value) => evicted.push([key, value]),
  });
  return { cache, evicted };
}

describe("ByteBudgetLruCache", () => {
  test("returns stored values and reports absence", () => {
    const { cache } = stringCache();
    cache.set("a", "aaa");

    expect(cache.get("a")).toBe("aaa");
    expect(cache.has("a")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  test("evicts the least recently used entry, counting reads as use", () => {
    const { cache, evicted } = stringCache({ maxEntries: 2, maxBytes: 1024 });
    cache.set("a", "aaa");
    cache.set("b", "bbb");
    // Reading "a" promotes it, so "b" becomes the eviction candidate.
    expect(cache.get("a")).toBe("aaa");
    cache.set("c", "ccc");

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(evicted).toEqual([["b", "bbb"]]);
    expect(cache.byteLength).toBe(6);
  });

  test("evicts to stay inside the byte budget even when entries fit", () => {
    const { cache, evicted } = stringCache({ maxEntries: 10, maxBytes: 10 });
    cache.set("a", "aaaaa");
    cache.set("b", "bbbbb");
    cache.set("c", "ccccc");

    // Entry count was never the constraint; bytes were.
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(2);
    expect(cache.byteLength).toBe(10);
    expect(evicted).toEqual([["a", "aaaaa"]]);
  });

  test("accounts for a replacement rather than double counting it", () => {
    const { cache, evicted } = stringCache();
    cache.set("a", "aaa");
    cache.set("a", "aaaaaaa");

    expect(cache.size).toBe(1);
    expect(cache.byteLength).toBe(7);
    expect(cache.get("a")).toBe("aaaaaaa");
    // The displaced value owned resources, so its eviction still fires.
    expect(evicted).toEqual([["a", "aaa"]]);
  });

  test("refuses a value larger than the whole budget without disturbing the cache", () => {
    const { cache, evicted } = stringCache({ maxEntries: 4, maxBytes: 8 });
    cache.set("keep", "keepme");

    const accepted = cache.set("huge", "x".repeat(9));

    expect(accepted).toBe(false);
    expect(cache.has("huge")).toBe(false);
    // Evicting good entries to make room for something that can never fit would
    // be pure loss.
    expect(cache.has("keep")).toBe(true);
    expect(evicted).toEqual([]);
  });

  test("keeps the existing value when an oversized replacement is refused", () => {
    const { cache, evicted } = stringCache({ maxEntries: 4, maxBytes: 8 });
    cache.set("a", "aaa");

    expect(cache.set("a", "x".repeat(99))).toBe(false);
    expect(cache.get("a")).toBe("aaa");
    expect(cache.byteLength).toBe(3);
    expect(evicted).toEqual([]);
  });

  test.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("refuses a value whose weight is %s", (_label, weight) => {
    const cache = new ByteBudgetLruCache<string, string>({
      maxEntries: 4,
      maxBytes: 64,
      weight: () => weight,
    });

    // A bad weight silently corrupts the running total, so it is rejected at
    // the boundary instead of poisoning every later eviction decision.
    expect(cache.set("a", "aaa")).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });

  test("accepts a zero weight", () => {
    const cache = new ByteBudgetLruCache<string, string>({
      maxEntries: 4,
      maxBytes: 64,
      weight: () => 0,
    });

    expect(cache.set("a", "")).toBe(true);
    expect(cache.size).toBe(1);
  });

  test("reports eviction on explicit delete", () => {
    const { cache, evicted } = stringCache();
    cache.set("a", "aaa");

    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
    expect(evicted).toEqual([["a", "aaa"]]);
  });

  test("reports eviction for every entry on clear", () => {
    const { cache, evicted } = stringCache();
    cache.set("a", "aaa");
    cache.set("b", "bb");

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
    // Renderer-owned terminal resources hang off these values, so clear has to
    // hand every one back rather than dropping the map.
    expect(evicted).toEqual([
      ["a", "aaa"],
      ["b", "bb"],
    ]);
  });

  test("works without an onEvict callback", () => {
    const cache = new ByteBudgetLruCache<string, string>({
      maxEntries: 1,
      maxBytes: 64,
      weight: (value) => value.length,
    });

    cache.set("a", "aaa");
    cache.set("b", "bbb");

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
  });
});
