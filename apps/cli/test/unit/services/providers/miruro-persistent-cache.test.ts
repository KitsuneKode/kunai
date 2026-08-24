import { describe, expect, test } from "bun:test";

import { createProviderCachePort } from "@/services/providers/provider-cache-port";
import type { MiruroEpisodesResponse } from "@kunai/providers/miruro";
import { getMiruroEpisodesResponse } from "@kunai/providers/miruro";
import { openKunaiDatabase, ProviderCacheRepository, runMigrations } from "@kunai/storage";
import type { ProviderRuntimeContext } from "@kunai/types";

// A stub that returns a valid episodes payload once, then fails — so a second
// resolve can only succeed if it read from the persistent cache.
function oneShotPipeContext(cache: ProviderRuntimeContext["cache"], onFetch: () => void) {
  let served = false;
  return {
    providerId: "miruro",
    now: () => new Date().toISOString(),
    cache,
    fetch: {
      runtime: "direct-http",
      fetch: async (_url: string) => {
        onFetch();
        if (served) return new Response("gone", { status: 500 });
        served = true;
        // Not a decodable pipe body — getMiruroEpisodesResponse would throw. We
        // instead pre-seed the persistent cache below and assert the SECOND
        // call reads it without touching the network at all.
        return new Response("gone", { status: 500 });
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
    const ctx = oneShotPipeContext(port, () => {
      fetched += 1;
    });

    const result = await getMiruroEpisodesResponse(ctx, "21");
    expect(result?.providers?.kiwi).toBeDefined();
    expect(fetched).toBe(0); // never hit the network
  });
});
