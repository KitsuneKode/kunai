import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { TmdbAdapter } from "@/services/sync/TmdbAdapter";

const tokenStore = { load: async () => ({}) } as unknown as SyncTokenStore;

const connectedTokenStore = {
  load: async () => ({
    tmdb: { sessionId: "session-1", accountId: "12345", username: "kitsune" },
  }),
  patchTmdb: async () => {},
} as unknown as SyncTokenStore;

const movieTarget = { tracker: "tmdb", tmdbId: 550, mediaKind: "movie" } as const;
const seriesTarget = { tracker: "tmdb", tmdbId: 1396, mediaKind: "series" } as const;
const signal = () => ({ signal: new AbortController().signal });

function recordingFetch() {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
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

    expect(calls[0]?.url).toContain("/account/12345/watchlist");
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

    expect(calls[0]?.url).toContain("/account/12345/favorite");
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

  /**
   * TMDB v3 authenticates account writes with `api_key` and `session_id` in the
   * query string. There is no `X-Session-Id` header in the API, and bearer auth
   * belongs to v4 and takes a read access token rather than the 32-character v3
   * key — sending the v3 key as a bearer made TMDB reject every write as
   * unauthenticated, which surfaced to the user as a permanent "reconnect TMDB".
   *
   * The previous test here asserted the opposite and passed, because it was
   * checking an invented contract rather than the documented one.
   */
  test("authenticates in the query string, the way TMDB v3 requires", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    const url = new URL(String(calls[0]?.url));
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("session_id")).toBe("session-1");
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.headers["X-Session-Id"]).toBeUndefined();
  });

  /**
   * `/account/{account_id}/…` takes the numeric id. Connect used to prefer the
   * username, so the path addressed an account that does not exist.
   */
  test("addresses the account by its numeric id, never the username", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: movieTarget, present: true },
      signal(),
    );

    expect(new URL(String(calls[0]?.url)).pathname).toBe("/3/account/12345/favorite");
    expect(String(calls[0]?.url)).not.toContain("kitsune");
  });

  /** The handle is what the user recognises, so it is what settings shows. */
  test("reports the username as the connected identity", async () => {
    const adapter = await connectedAdapter(recordingFetch().fetchImpl);
    expect(adapter.getConnection()).toMatchObject({ state: "connected", username: "kitsune" });
  });
});

/**
 * Builds before the account-id/username split stored the handle in `accountId`.
 * Those sessions are still valid — only the stored shape is wrong — so start-up
 * repairs them rather than making the user reconnect.
 */
describe("TmdbAdapter.refreshIdentity", () => {
  function legacyStore() {
    const patched: unknown[] = [];
    const store = {
      load: async () => ({ tmdb: { sessionId: "session-1", accountId: "kitsune" } }),
      patchTmdb: async (data: unknown) => {
        patched.push(data);
      },
    } as unknown as SyncTokenStore;
    return { patched, store };
  }

  test("re-resolves a non-numeric stored account id and persists the repair", async () => {
    const { patched, store } = legacyStore();
    const adapter = new TmdbAdapter(
      store,
      "test-key",
      async () => new Response(JSON.stringify({ id: 12345, username: "kitsune" }), { status: 200 }),
    );
    await adapter.init();
    await adapter.refreshIdentity(signal());

    expect(patched[0]).toMatchObject({ accountId: "12345", username: "kitsune" });
  });

  test("leaves a numeric account id alone, making no request", async () => {
    let requests = 0;
    const adapter = new TmdbAdapter(connectedTokenStore, "test-key", async () => {
      requests += 1;
      return new Response("{}", { status: 200 });
    });
    await adapter.init();
    await adapter.refreshIdentity(signal());

    expect(requests).toBe(0);
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
