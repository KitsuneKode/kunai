import { describe, expect, test } from "bun:test";

import { createProviderCachePort } from "@/services/providers/provider-cache-port";
import type { MiruroEpisodesResponse } from "@kunai/providers/miruro";
import { getMiruroEpisodesResponse } from "@kunai/providers/miruro";
import { openKunaiDatabase, ProviderCacheRepository, runMigrations } from "@kunai/storage";
import type { ProviderRuntimeContext } from "@kunai/types";

// A context whose fetch must never fire: the catalog is pre-seeded in the
// persistent store, so a resolve that reaches the network is a failure. The
// stub records the call (asserted to stay 0) and throws to make an accidental
// network path fail loudly rather than fall through to a decode error.
function noNetworkContext(cache: ProviderRuntimeContext["cache"], onFetch: () => void) {
  return {
    providerId: "miruro",
    now: () => new Date().toISOString(),
    cache,
    fetch: {
      runtime: "direct-http",
      fetch: async (_url: string) => {
        onFetch();
        throw new Error("miruro persistent-cache test hit the network");
      },
    },
  } as unknown as ProviderRuntimeContext;
}

describe("miruro episode catalog persists across sessions", () => {
  test("a second context backed by the same store skips the network", async () => {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    const repo = new ProviderCacheRepository(db);
    const port = createProviderCachePort(repo);

    const catalog: MiruroEpisodesResponse = {
      providers: { kiwi: { episodes: { sub: [{ id: "e1", number: 1 }] } } },
    } as unknown as MiruroEpisodesResponse;

    // "Session 1" resolved and persisted the catalog (simulated by a direct write).
    await port.write("miruro:episodes", "21", catalog, 12 * 60 * 60 * 1000);

    // "Session 2": a brand-new context (fresh in-memory cache) — the module
    // cache is cold, so a hit can only come from the persistent store. The fetch
    // stub throws if called.
    let fetched = 0;
    const ctx = noNetworkContext(port, () => {
      fetched += 1;
    });

    const result = await getMiruroEpisodesResponse(ctx, "21");
    expect(result?.providers?.kiwi).toBeDefined();
    expect(fetched).toBe(0); // never hit the network
  });
});
