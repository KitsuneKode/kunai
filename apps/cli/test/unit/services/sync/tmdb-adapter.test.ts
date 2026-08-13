import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { TmdbAdapter } from "@/services/sync/TmdbAdapter";

const tokenStore = { load: async () => ({}) } as unknown as SyncTokenStore;

const connectedTokenStore = {
  load: async () => ({ tmdb: { sessionId: "session-1", accountId: "account-1" } }),
} as unknown as SyncTokenStore;

const movieTarget = { tracker: "tmdb", tmdbId: 550, mediaKind: "movie" } as const;
const seriesTarget = { tracker: "tmdb", tmdbId: 1396, mediaKind: "series" } as const;
const signal = () => ({ signal: new AbortController().signal });

function recordingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

async function connectedAdapter(fetchImpl: ConstructorParameters<typeof TmdbAdapter>[2]) {
  const adapter = new TmdbAdapter(connectedTokenStore, "test-key", fetchImpl);
  await adapter.init();
  return adapter;
}

describe("TmdbAdapter.apply", () => {
  /**
   * The capability declaration and the runtime path must agree. A progress row
   * reaching TMDB is a payload that can never succeed, so it is classified
   * non-retryable rather than failing remotely and being redelivered forever.
   */
  test("refuses episode progress without making a request", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    const outcome = await adapter.apply(
      {
        version: 1,
        kind: "progress:set",
        target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
        progress: 3,
        status: "watching",
      },
      signal(),
    );

    expect(outcome).toMatchObject({ status: "failed", retryable: false });
    expect(calls).toHaveLength(0);
  });

  test("sends the exact desired watchlist state for add and remove", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      {
        version: 1,
        kind: "list-membership:set",
        target: movieTarget,
        list: "watchlist",
        present: true,
      },
      signal(),
    );
    await adapter.apply(
      {
        version: 1,
        kind: "list-membership:set",
        target: seriesTarget,
        list: "watchlist",
        present: false,
      },
      signal(),
    );

    expect(calls[0]?.url).toContain("/account/account-1/watchlist");
    expect(calls[0]?.body).toEqual({ media_type: "movie", media_id: 550, watchlist: true });
    expect(calls[1]?.body).toEqual({ media_type: "tv", media_id: 1396, watchlist: false });
  });

  test("sends the exact desired favourite state", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    expect(calls[0]?.url).toContain("/account/account-1/favorite");
    expect(calls[0]?.body).toEqual({ media_type: "movie", media_id: 550, favorite: true });
  });

  /** Desired state means an identical resend is harmless. */
  test("is idempotent across a retry of the same body", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);
    const operation = {
      version: 1,
      kind: "favorite-membership:set",
      target: movieTarget,
      present: true,
    } as const;

    await adapter.apply(operation, signal());
    await adapter.apply(operation, signal());

    expect(calls[0]?.body).toEqual(calls[1]?.body ?? {});
  });

  test("maps a rejected session to a reauth demand", async () => {
    const adapter = await connectedAdapter(
      async () => new Response(JSON.stringify({ status_code: 3 }), { status: 401 }),
    );

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    expect(outcome.status).toBe("needs-reauth");
  });

  test("maps a server error to a retryable failure", async () => {
    const adapter = await connectedAdapter(async () => new Response("upstream", { status: 503 }));

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    expect(outcome).toMatchObject({ status: "failed", kind: "remote", retryable: true });
  });

  /** Credentials belong in the request, not in a URL that lands in logs. */
  test("never puts the session id or api key in the request URL", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    expect(calls[0]?.url).not.toContain("session-1");
    expect(calls[0]?.url).not.toContain("test-key");
  });
});

/**
 * Capabilities are read, not restated. Settings decides what to offer and the
 * drain decides what to deliver from these declarations, so an overclaim here
 * becomes a control the user can operate that does nothing.
 */
describe("TmdbAdapter capabilities", () => {
  const adapter = new TmdbAdapter(tokenStore, "test-key");

  /**
   * TMDB v3 has no episode-progress endpoint. The old `pushWatched()`, now
   * removed,
   * pretended otherwise by POSTing `watchlist: false` — which does not record
   * progress, it removes the title from the watchlist.
   */
  test("does not claim episode progress", () => {
    expect(adapter.capabilities.episodeProgress).toBe(false);
  });

  test("claims exactly watchlist and favourite membership", () => {
    expect(adapter.capabilities).toEqual({
      episodeProgress: false,
      watchlistMembership: true,
      favoriteMembership: true,
      pullLists: false,
      rating: false,
    });
  });

  /** Nothing on this branch reads remote lists or writes ratings. */
  test("claims neither pull nor rating", () => {
    expect(adapter.capabilities.pullLists).toBe(false);
    expect(adapter.capabilities.rating).toBe(false);
  });
});
