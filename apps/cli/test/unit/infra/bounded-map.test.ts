import { describe, expect, test } from "bun:test";

import { BoundedLruMap } from "@/infra/bounded-map";

describe("BoundedLruMap", () => {
  test("evicts the oldest write past the ceiling", () => {
    const map = new BoundedLruMap<string, number>(3);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("d", 4);

    expect(map.size).toBe(3);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe(2);
    expect(map.get("d")).toBe(4);
  });

  test("a get() promotes the entry, so reads protect hot keys", () => {
    const map = new BoundedLruMap<string, number>(2);
    map.set("hot", 1);
    map.set("cold", 2);
    // Reading "hot" makes "cold" the oldest.
    expect(map.get("hot")).toBe(1);
    map.set("new", 3);

    expect(map.has("cold")).toBe(false);
    expect(map.get("hot")).toBe(1);
    expect(map.get("new")).toBe(3);
  });

  test("rewriting an existing key is a refresh, never growth", () => {
    const map = new BoundedLruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 10);

    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(10);
    // "b" is now oldest, so it is the one the next write evicts.
    map.set("c", 3);
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(10);
  });

  test("has() reports membership without promoting", () => {
    const map = new BoundedLruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    // `has` must not rescue "a" — otherwise callers that probe with has() would
    // silently starve eviction the way plain reads would not.
    expect(map.has("a")).toBe(true);
    map.set("c", 3);
    expect(map.has("a")).toBe(false);
  });

  test("a ceiling of one keeps exactly the latest write", () => {
    const map = new BoundedLruMap<string, number>(1);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.size).toBe(1);
    expect(map.get("b")).toBe(2);
  });

  test("clear() empties, and size tracks writes", () => {
    const map = new BoundedLruMap<string, number>(4);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.size).toBe(2);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.get("a")).toBeUndefined();
  });
});
