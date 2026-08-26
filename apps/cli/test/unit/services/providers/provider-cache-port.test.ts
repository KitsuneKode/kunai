import { describe, expect, test } from "bun:test";

import { createProviderCachePort } from "@/services/providers/provider-cache-port";
import { openKunaiDatabase, ProviderCacheRepository, runMigrations } from "@kunai/storage";

function backedPort(): { repo: ProviderCacheRepository; db: ReturnType<typeof openKunaiDatabase> } {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  return { repo: new ProviderCacheRepository(db), db };
}

describe("createProviderCachePort", () => {
  test("write then read round-trips a structured value", async () => {
    const { repo } = backedPort();
    const port = createProviderCachePort(repo);
    await port.write("miruro:episodes", "21", { providers: { kiwi: 1 } }, 60_000);
    expect(await port.read<{ providers: Record<string, number> }>("miruro:episodes", "21")).toEqual(
      { providers: { kiwi: 1 } },
    );
  });

  test("survives across contexts backed by the same store (the cross-session guarantee)", async () => {
    const { repo } = backedPort();
    // One "session" writes.
    await createProviderCachePort(repo).write("ns", "k", { v: 42 }, 60_000);
    // A fresh port over the same store — as a new process would see it — reads it.
    expect(await createProviderCachePort(repo).read<{ v: number }>("ns", "k")).toEqual({ v: 42 });
  });

  test("an expired entry reads as null", async () => {
    const { repo } = backedPort();
    let clock = new Date("2026-01-01T00:00:00Z");
    const port = createProviderCachePort(repo, () => clock);
    await port.write("ns", "k", { v: 1 }, 1_000);
    clock = new Date("2026-01-01T00:00:05Z"); // 5s later, past the 1s TTL
    expect(await port.read("ns", "k")).toBeNull();
  });

  test("a broken store degrades to null / no-op, never throws", async () => {
    const broken = {
      read() {
        throw new Error("db down");
      },
      write() {
        throw new Error("db down");
      },
    } as unknown as ProviderCacheRepository;
    const port = createProviderCachePort(broken);
    expect(await port.read("ns", "k")).toBeNull();
    // Must not throw — a cache failure cannot fail the resolve.
    await port.write("ns", "k", { v: 1 }, 1_000);
  });

  test("a corrupt payload reads as null instead of throwing", async () => {
    const { repo, db } = backedPort();
    db.query(
      "INSERT INTO provider_cache (namespace, cache_key, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "ns",
      "k",
      "not-json{",
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    );
    expect(await createProviderCachePort(repo).read("ns", "k")).toBeNull();
  });
});
