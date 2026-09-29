import { afterEach, expect, test } from "bun:test";

import { RELAY_HOP_HEADER, type ProviderRuntimeContext } from "@kunai/types";

import { clearAnidbCachesForTest, fetchAnidbEpisodeCatalog } from "../src/anidb/direct";

/**
 * A relay deployed before `anidb` existed answers its RPC route with a 404
 * `unknown-provider` of its own. Read as anidb.app's verdict that took the
 * whole anime lane down: the catalogue was marked permanently missing, the miss
 * was cached, and every later resolve returned "no episodes" — while the same
 * id resolved fine over curl. The relay's status is not the upstream's answer.
 */
afterEach(() => {
  clearAnidbCachesForTest();
});

function relayContext(status: number, body: string): ProviderRuntimeContext {
  return {
    fetch: {
      async fetch() {
        return new Response(body, { status, headers: { [RELAY_HOP_HEADER]: "1" } });
      },
    },
  } as unknown as ProviderRuntimeContext;
}

test("a 404 from a stale relay is not treated as a missing catalogue", async () => {
  // No curl fallback is reachable in the unit environment, so the call fails
  // rather than resolving — the point is that it does NOT report `missing`,
  // which is what poisoned the cache and blanked the lane.
  const context = relayContext(
    404,
    JSON.stringify({ error: { code: "unknown-provider", providerId: "anidb" } }),
  );

  const catalog = await fetchAnidbEpisodeCatalog("onigiri-3942", undefined, context).catch(
    () => "threw" as const,
  );

  expect(catalog).not.toEqual({ episodes: [], missing: true });
});

test("a 404 straight from anidb.app is still a missing catalogue", async () => {
  // Unmarked: no relay hop, so the status is the upstream's own verdict and the
  // reindexed-slug repair path must still see `missing`.
  const context = {
    fetch: {
      async fetch() {
        return new Response("not found", { status: 404 });
      },
    },
  } as unknown as ProviderRuntimeContext;

  const catalog = await fetchAnidbEpisodeCatalog("solo-leveling-19413", undefined, context);

  expect(catalog).toEqual({ episodes: [], missing: true });
});
