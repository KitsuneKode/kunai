import { describe, expect, test } from "bun:test";

import { openKunaiDatabase, ProviderCacheRepository, runMigrations } from "@kunai/storage";

function repo() {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  return new ProviderCacheRepository(db);
}

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe("ProviderCacheRepository", () => {
  test("round-trips a value under a namespace and key", () => {
    const r = repo();
    r.write("miruro:episodes", "21", '{"providers":{"kiwi":{}}}', future);
    expect(r.read("miruro:episodes", "21")).toBe('{"providers":{"kiwi":{}}}');
  });

  test("a miss returns null", () => {
    expect(repo().read("miruro:episodes", "missing")).toBeNull();
  });

  test("namespaces do not collide", () => {
    const r = repo();
    r.write("a", "k", "from-a", future);
    r.write("b", "k", "from-b", future);
    expect(r.read("a", "k")).toBe("from-a");
    expect(r.read("b", "k")).toBe("from-b");
  });

  test("an expired entry reads as null and is dropped", () => {
    const r = repo();
    r.write("ns", "k", "stale", past);
    expect(r.read("ns", "k")).toBeNull();
  });

  test("writing the same key overwrites", () => {
    const r = repo();
    r.write("ns", "k", "v1", future);
    r.write("ns", "k", "v2", future);
    expect(r.read("ns", "k")).toBe("v2");
  });

  test("pruneExpired removes only expired rows", () => {
    const r = repo();
    r.write("ns", "live", "keep", future);
    r.write("ns", "dead", "drop", past);
    r.pruneExpired();
    expect(r.read("ns", "live")).toBe("keep");
    expect(r.read("ns", "dead")).toBeNull();
  });
});
