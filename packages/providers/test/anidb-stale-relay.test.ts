import { afterEach, expect, test } from "bun:test";

import { RELAYED_RESPONSE_HEADER, type ProviderRuntimeContext } from "@kunai/types";

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
        return new Response(body, { status, headers: { [RELAYED_RESPONSE_HEADER]: "1" } });
      },
    },
  } as unknown as ProviderRuntimeContext;
}

test("a relayed upstream 404 is still a missing catalogue", async () => {
  // The fetch port turns a relay-generated refusal into a direct retry or a
  // typed error before this provider sees it. A 404 that arrives here, even
  // marked as relayed, is the upstream's own verdict.
  const context = relayContext(404, "not found");

  const catalog = await fetchAnidbEpisodeCatalog("onigiri-3942", undefined, context);

  expect(catalog).toEqual({ episodes: [], missing: true });
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
