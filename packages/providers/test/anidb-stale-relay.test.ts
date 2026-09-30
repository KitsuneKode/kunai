import { afterEach, expect, test } from "bun:test";

import {
  isRelayRefusalError,
  RELAYED_RESPONSE_HEADER,
  RelayRefusalError,
  type ProviderFetchPort,
  type ProviderRuntimeContext,
  type RelayErrorCode,
} from "@kunai/types";

import { clearAnidbCachesForTest, fetchAnidbEpisodeCatalog } from "../src/anidb/direct";

/**
 * A relay deployed before `anidb` existed answers its RPC route with a 404
 * `unknown-provider` of its own. That refusal is the relay's voice, not the
 * upstream's verdict, so under `fallbackToDirect: false` the fetch port throws
 * `RelayRefusalError` instead of returning the refusal as a marked response.
 * The catalogue must reject with that error and record nothing: folding a
 * refusal 404 into `{ missing: true }` cached a stale deployment's refusal as
 * "no episodes". A *relayed* upstream 404 — marked, without the relay's
 * error-code header — is still the upstream's verdict and still a miss.
 */
afterEach(() => {
  clearAnidbCachesForTest();
});

/** Only the fetch port is exercised under test; `now` satisfies the context contract. */
function stubContext(fetch: ProviderFetchPort["fetch"]): ProviderRuntimeContext {
  return {
    now: () => "2026-01-01T00:00:00.000Z",
    fetch: { runtime: "direct-http", fetch },
  };
}

/**
 * What `createRelayFetchPort` hands the client under `fallbackToDirect:
 * false`: the port reads the refusal envelope and throws — the client never
 * sees a Response for a refusal.
 */
function relayRefusalContext(relayCode: RelayErrorCode, status: number): ProviderRuntimeContext {
  return stubContext(async () => {
    throw new RelayRefusalError({ relayCode, providerId: "anidb", status });
  });
}

test("a relay refusal rejects — it is the relay's voice, never a cached miss", async () => {
  const context = relayRefusalContext("unknown-provider", 404);

  const error = await fetchAnidbEpisodeCatalog("onigiri-3942", undefined, context).catch(
    (caught) => caught,
  );

  expect(isRelayRefusalError(error)).toBe(true);
  if (!isRelayRefusalError(error)) return;
  expect(error.relayCode).toBe("unknown-provider");
  expect(error.providerId).toBe("anidb");
  expect(error.status).toBe(404);

  // Nothing was cached as a miss — asking again rejects the same way instead
  // of replaying a poisoned `{ episodes: [], missing: true }`.
  const second = await fetchAnidbEpisodeCatalog("onigiri-3942", undefined, context).catch(
    (caught) => caught,
  );
  expect(isRelayRefusalError(second)).toBe(true);
});

test("a relayed upstream 404 is still a missing catalogue", async () => {
  // Marked as relayed but without the relay's error-code header: the upstream
  // answered through the relay, so the status is its own verdict and the
  // reindexed-slug repair path must still see `missing`.
  const context = stubContext(
    async () =>
      new Response("not found", {
        status: 404,
        headers: { [RELAYED_RESPONSE_HEADER]: "1" },
      }),
  );

  const catalog = await fetchAnidbEpisodeCatalog("onigiri-3942", undefined, context);

  expect(catalog).toEqual({ episodes: [], missing: true });
});

test("a 404 straight from anidb.app is still a missing catalogue", async () => {
  // Unmarked: no relay hop, so the status is the upstream's own verdict and the
  // reindexed-slug repair path must still see `missing`.
  const context = stubContext(async () => new Response("not found", { status: 404 }));

  const catalog = await fetchAnidbEpisodeCatalog("solo-leveling-19413", undefined, context);

  expect(catalog).toEqual({ episodes: [], missing: true });
});
