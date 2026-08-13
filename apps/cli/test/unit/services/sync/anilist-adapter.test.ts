import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { AniListAdapter } from "@/services/sync/AniListAdapter";
import type { TrackerOperation } from "@/services/sync/operations";

const connectedTokenStore = {
  load: async () => ({ anilist: { accessToken: "token", userId: 42 } }),
} as unknown as SyncTokenStore;

const anilistTarget = { tracker: "anilist", anilistId: 438631, mediaKind: "anime" } as const;

/**
 * A fake AniList that holds real state, so idempotence can be asserted against
 * what the remote ends up believing rather than against call arguments.
 */
function fakeAniList(options: { favourite?: boolean; failNextResponse?: boolean } = {}) {
  const state = {
    favourite: options.favourite ?? false,
    toggleCalls: 0,
    saveCalls: 0,
    deleteCalls: 0,
    lastSave: undefined as Record<string, unknown> | undefined,
    failNextResponse: options.failNextResponse ?? false,
  };

  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const json = (data: unknown) =>
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (body.query.includes("ToggleFavourite")) {
      state.toggleCalls += 1;
      state.favourite = !state.favourite;
      // The mutation lands, then the response is lost on the way back — the
      // exact shape that makes a blind retry flip the value back.
      if (state.failNextResponse) {
        state.failNextResponse = false;
        throw new TypeError("network error");
      }
      return json({ ToggleFavourite: { anime: { nodes: [{ id: 438631 }] } } });
    }
    if (body.query.includes("isFavourite")) {
      return json({ Media: { id: 438631, isFavourite: state.favourite } });
    }
    if (body.query.includes("DeleteMediaListEntry")) {
      state.deleteCalls += 1;
      return json({ DeleteMediaListEntry: { deleted: true } });
    }
    if (body.query.includes("mediaListEntry")) {
      return json({ Media: { id: 438631, mediaListEntry: { id: 7 } } });
    }
    state.saveCalls += 1;
    state.lastSave = body.variables;
    return json({ SaveMediaListEntry: { id: 1 } });
  };

  return { state, fetchImpl };
}

async function connectedAdapter(fetchImpl: ConstructorParameters<typeof AniListAdapter>[1]) {
  const adapter = new AniListAdapter(connectedTokenStore, fetchImpl);
  await adapter.init();
  return adapter;
}

const signal = () => ({ signal: new AbortController().signal });

describe("AniListAdapter.apply", () => {
  test("sends the cour-relative progress and desired status", async () => {
    const { state, fetchImpl } = fakeAniList();
    const adapter = await connectedAdapter(fetchImpl);

    const outcome = await adapter.apply(
      {
        version: 1,
        kind: "progress:set",
        target: anilistTarget,
        progress: 3,
        status: "completed",
      },
      signal(),
    );

    expect(outcome.status).toBe("ok");
    expect(state.lastSave).toMatchObject({ mediaId: 438631, progress: 3, status: "COMPLETED" });
  });

  /**
   * A foreign target is a payload that can never succeed against this adapter,
   * so it must be classified before any request rather than failing remotely
   * and being retried forever.
   */
  test("rejects a foreign target before making a request", async () => {
    let calls = 0;
    const adapter = await connectedAdapter(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });

    const outcome = await adapter.apply(
      {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "tmdb", tmdbId: 550, mediaKind: "movie" },
        present: true,
      },
      signal(),
    );

    expect(outcome).toMatchObject({
      status: "failed",
      code: "tracker-target-mismatch",
      kind: "mapping",
      retryable: false,
    });
    expect(calls).toBe(0);
  });

  /**
   * The reason favourites are modelled as desired state rather than
   * `ToggleFavourite`: the outbox may redeliver a row whose response was lost
   * after the remote already applied it. A blind toggle would undo the user's
   * intent on the retry, and nothing would report an error.
   */
  test("a lost favourite response leaves the desired state after retry", async () => {
    const { state, fetchImpl } = fakeAniList({ favourite: false, failNextResponse: true });
    const adapter = await connectedAdapter(fetchImpl);
    const operation: TrackerOperation = {
      version: 1,
      kind: "favorite-membership:set",
      target: anilistTarget,
      present: true,
    };

    const first = await adapter.apply(operation, signal());
    expect(first.status).toBe("failed");
    expect(state.favourite).toBe(true);

    const retry = await adapter.apply(operation, signal());

    expect(retry.status).toBe("ok");
    expect(state.toggleCalls).toBe(1);
    expect(state.favourite).toBe(true);
  });

  test("does not toggle when the favourite is already in the desired state", async () => {
    const { state, fetchImpl } = fakeAniList({ favourite: true });
    const adapter = await connectedAdapter(fetchImpl);

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: anilistTarget, present: true },
      signal(),
    );

    expect(outcome.status).toBe("ok");
    expect(state.toggleCalls).toBe(0);
  });

  test("toggles once to remove a favourite that is present", async () => {
    const { state, fetchImpl } = fakeAniList({ favourite: true });
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: anilistTarget, present: false },
      signal(),
    );

    expect(state.toggleCalls).toBe(1);
    expect(state.favourite).toBe(false);
  });

  test("adds to planning and deletes the entry to remove it", async () => {
    const { state, fetchImpl } = fakeAniList();
    const adapter = await connectedAdapter(fetchImpl);

    await adapter.apply(
      {
        version: 1,
        kind: "list-membership:set",
        target: anilistTarget,
        list: "watchlist",
        present: true,
      },
      signal(),
    );
    expect(state.lastSave).toMatchObject({ mediaId: 438631, status: "PLANNING" });

    await adapter.apply(
      {
        version: 1,
        kind: "list-membership:set",
        target: anilistTarget,
        list: "watchlist",
        present: false,
      },
      signal(),
    );
    expect(state.deleteCalls).toBe(1);
  });

  /** Cancellation releases the claim untouched; it is not a delivery failure. */
  test("reports caller cancellation rather than a retryable failure", async () => {
    const controller = new AbortController();
    const adapter = await connectedAdapter(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: anilistTarget, present: true },
      { signal: controller.signal },
    );

    expect(outcome).toEqual({ status: "cancelled", reason: "caller-aborted" });
  });

  test("reports an unauthenticated adapter as needing reauth", async () => {
    const adapter = new AniListAdapter({ load: async () => ({}) } as unknown as SyncTokenStore);
    await adapter.init();

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target: anilistTarget, present: true },
      signal(),
    );

    expect(outcome.status).toBe("needs-reauth");
  });
});

/**
 * Capabilities are read, not restated. Settings decides what to offer and the
 * drain decides what to deliver from these declarations, so an overclaim here
 * becomes a control the user can operate that does nothing.
 */
describe("AniListAdapter capabilities", () => {
  const adapter = new AniListAdapter({ load: async () => ({}) } as unknown as SyncTokenStore);

  test("claims progress, watchlist and favourite membership only", () => {
    expect(adapter.capabilities).toEqual({
      episodeProgress: true,
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

describe("AniListAdapter startup", () => {
  test("loads the saved session without fetching identity until explicitly requested", async () => {
    const tokenStore = {
      load: async () => ({
        anilist: { accessToken: "saved-token", userId: 42 },
      }),
    } as unknown as SyncTokenStore;
    let fetchCalls = 0;
    const adapter = new AniListAdapter(tokenStore, async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: { Viewer: { id: 42, name: "kitsune" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await adapter.init();

    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getConnection()).toEqual({ state: "connected" });
    expect(fetchCalls).toBe(0);

    await adapter.refreshIdentity();

    expect(fetchCalls).toBe(1);
    expect(adapter.getConnection()).toEqual({ state: "connected", username: "kitsune" });
  });

  /**
   * A refused credential and an unreachable network are different states. The
   * adapter used to drop the access token on any thrown error, so one offline
   * start silently unlinked the account.
   */
  test("keeps the session when identity cannot be fetched, drops it only on refusal", async () => {
    const savedSession = {
      load: async () => ({ anilist: { accessToken: "saved-token", userId: 42 } }),
    } as unknown as SyncTokenStore;

    const offline = new AniListAdapter(savedSession, async () => {
      throw new Error("network down");
    });
    await offline.init();
    await offline.refreshIdentity();
    expect(offline.getConnection()).toEqual({ state: "connected" });

    const refused = new AniListAdapter(
      savedSession,
      async () => new Response("nope", { status: 401 }),
    );
    await refused.init();
    await refused.refreshIdentity();
    expect(refused.getConnection()).toEqual({ state: "needs-reauth", reason: "token-rejected" });
  });
});

/**
 * AniList answers most application-level problems with a 200 and an `errors`
 * array. What separates them is the status inside, and getting that wrong is
 * expensive in both directions: a retried permanent failure cycles until the
 * backoff caps, a dead-lettered transient one loses the write.
 */
describe("AniListAdapter GraphQL error classification", () => {
  const applyWith = async (error: Record<string, unknown>) => {
    const tokenStore = {
      load: async () => ({ anilist: { accessToken: "tok", userId: 1 } }),
      patchAniList: async () => {},
    } as unknown as SyncTokenStore;
    // A fresh Response per call: a body can only be consumed once.
    const adapter = new AniListAdapter(
      tokenStore,
      async () =>
        new Response(JSON.stringify({ data: null, errors: [error] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await adapter.init();
    return adapter.apply(
      {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
        present: true,
      },
      { signal: new AbortController().signal },
    );
  };

  /** A validation failure can never succeed on redelivery. */
  test("dead-letters a validation rejection instead of retrying it", async () => {
    const outcome = await applyWith({
      message: "validation",
      status: 400,
      validation: { score: ["The score may not be greater than 100."] },
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.retryable).toBe(false);
    expect(outcome.status === "failed" && outcome.code).toBe("validation-rejected");
    // The field is named; the offending value never is.
    expect(JSON.stringify(outcome)).toContain("score");
    expect(JSON.stringify(outcome)).not.toContain("may not be greater");
  });

  test("dead-letters 400 and 404 without a validation map", async () => {
    for (const status of [400, 404]) {
      const outcome = await applyWith({ message: "Not Found.", status });
      expect(outcome.status === "failed" && outcome.retryable, String(status)).toBe(false);
    }
  });

  test("treats an in-envelope 429 as a rate limit, not a failure", async () => {
    const outcome = await applyWith({ message: "Too Many Requests.", status: 429 });

    expect(outcome.status).toBe("rate-limited");
  });

  test("demands reauth on 401 and 403", async () => {
    for (const status of [401, 403]) {
      const outcome = await applyWith({ message: "Unauthorized.", status });
      expect(outcome.status, String(status)).toBe("needs-reauth");
    }
  });

  /** Unknown means transient: a wrong retry costs one request, a wrong drop loses data. */
  test("retries an unclassified server error", async () => {
    const outcome = await applyWith({ message: "Internal Error.", status: 500 });

    expect(outcome.status === "failed" && outcome.retryable).toBe(true);
  });
});

/**
 * Both membership writes read before they write. A read that failed is not an
 * answer, and treating it as one is silent: the row completes, the remote never
 * changed, and nothing reports a problem.
 */
describe("AniListAdapter membership lookups", () => {
  const adapterReturning = async (body: unknown, status = 200) => {
    const tokenStore = {
      load: async () => ({ anilist: { accessToken: "tok", userId: 1 } }),
      patchAniList: async () => {},
    } as unknown as SyncTokenStore;
    const calls: string[] = [];
    const adapter = new AniListAdapter(tokenStore, async (_input, init) => {
      calls.push(String((init?.body as string) ?? ""));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
    await adapter.init();
    return { adapter, calls };
  };

  const target = { tracker: "anilist", anilistId: 7, mediaKind: "anime" } as const;

  test("does not report a removal as done when the lookup was rejected", async () => {
    const { adapter, calls } = await adapterReturning({
      data: null,
      errors: [{ message: "Invalid token", status: 401 }],
    });

    const outcome = await adapter.apply(
      { version: 1, kind: "list-membership:set", target, list: "watchlist", present: false },
      signal(),
    );

    expect(outcome.status).toBe("needs-reauth");
    // The delete mutation must never have been attempted.
    expect(calls.some((body) => body.includes("DeleteMediaListEntry"))).toBe(false);
  });

  test("reports an unreadable membership rather than guessing absent", async () => {
    const { adapter } = await adapterReturning({ data: {} });

    const outcome = await adapter.apply(
      { version: 1, kind: "list-membership:set", target, list: "watchlist", present: false },
      signal(),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.code).toBe("entry-state-unknown");
  });

  /** ToggleFavourite is a flip: firing it blind turns redelivery into flip-flop. */
  test("never toggles a favourite it could not read", async () => {
    const { adapter, calls } = await adapterReturning({ data: { Media: { id: 7 } } });

    const outcome = await adapter.apply(
      { version: 1, kind: "favorite-membership:set", target, present: true },
      signal(),
    );

    expect(outcome.status === "failed" && outcome.code).toBe("favourite-state-unknown");
    expect(calls.some((body) => body.includes("ToggleFavourite"))).toBe(false);
  });
});
