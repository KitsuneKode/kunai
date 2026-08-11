import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { AniListAdapter } from "@/services/sync/AniListAdapter";
import type { TrackerProgress } from "@/services/sync/types";

interface GqlCall {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

/** Token store stub that records what the adapter persisted. */
function tokenStore(initial: Record<string, unknown> = {}): SyncTokenStore & {
  saved: Record<string, unknown>[];
} {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    load: async () => initial,
    save: async () => {},
    clear: async () => {},
    patchAniList: async (data: unknown) => {
      saved.push({ anilist: data });
    },
    patchTmdb: async () => {},
  } as unknown as SyncTokenStore & { saved: Record<string, unknown>[] };
}

/**
 * Build an adapter whose GraphQL responses are chosen per operation, so tests
 * describe the remote list state rather than a response sequence.
 */
function adapterWith(options: {
  readonly media?: unknown;
  readonly viewer?: unknown;
  readonly saveResult?: unknown;
  readonly status?: number;
  readonly errors?: readonly { message: string }[];
  readonly throwOnFetch?: boolean;
  readonly tokens?: Record<string, unknown>;
}): { adapter: AniListAdapter; calls: GqlCall[]; store: ReturnType<typeof tokenStore> } {
  const calls: GqlCall[] = [];
  const store = tokenStore(
    options.tokens ?? { anilist: { accessToken: "token", userId: 1, username: "kitsune" } },
  );

  const adapter = new AniListAdapter(store, async (_input, init) => {
    if (options.throwOnFetch) throw new Error("network unreachable");

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    calls.push({ query: body.query, variables: body.variables ?? {} });

    if (options.errors) {
      return new Response(JSON.stringify({ errors: options.errors }), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (options.status && options.status >= 400) {
      return new Response(JSON.stringify({}), { status: options.status });
    }

    const data = body.query.includes("Viewer")
      ? { Viewer: options.viewer ?? { id: 1, name: "kitsune" } }
      : body.query.includes("SaveMediaListEntry")
        ? { SaveMediaListEntry: options.saveResult ?? { id: 99 } }
        : { Media: options.media ?? null };

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  return { adapter, calls, store };
}

function progress(overrides: Partial<TrackerProgress> = {}): TrackerProgress {
  return {
    titleId: "anilist:21",
    title: "One Piece",
    mediaKind: "anime",
    externalIds: { anilistId: "21" },
    episode: 5,
    season: 1,
    completed: true,
    ...overrides,
  };
}

function savedVariables(calls: GqlCall[]): Record<string, unknown> | undefined {
  return calls.find((call) => call.query.includes("SaveMediaListEntry"))?.variables;
}

describe("AniListAdapter startup", () => {
  test("loads the saved session without hitting the network", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getConnectedUsername()).toBe("kitsune");
    expect(calls).toHaveLength(0);
  });

  test("refreshIdentity confirms the account and caches the name", async () => {
    const { adapter, calls } = adapterWith({
      tokens: { anilist: { accessToken: "token", userId: 1 } },
    });
    await adapter.init();
    expect(adapter.getConnectedUsername()).toBeUndefined();

    await adapter.refreshIdentity();

    expect(calls).toHaveLength(1);
    expect(adapter.getConnectedUsername()).toBe("kitsune");
  });

  // A transient failure must not look like a logout, or an offline launch
  // silently disconnects the account.
  test("a network failure during refresh keeps the session connected", async () => {
    const { adapter } = adapterWith({ throwOnFetch: true });
    await adapter.init();

    await adapter.refreshIdentity();

    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getConnection().state).toBe("connected");
  });

  test("a rejected token moves the adapter to needs-reauth", async () => {
    const { adapter } = adapterWith({ status: 401 });
    await adapter.init();

    await adapter.refreshIdentity();

    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getConnection().state).toBe("needs-reauth");
  });

  test("an expired stored token is flagged before any request is made", async () => {
    const { adapter } = adapterWith({
      tokens: {
        anilist: {
          accessToken: "token",
          userId: 1,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    await adapter.init();

    expect(adapter.getConnection().state).toBe("needs-reauth");
  });
});

describe("AniListAdapter.pushProgress", () => {
  test("advances progress on a watched episode", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 4, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 5 }));

    expect(result.status).toBe("ok");
    expect(savedVariables(calls)).toMatchObject({ mediaId: 21, status: "CURRENT", progress: 5 });
  });

  // Rewatching episode 3 of a show sitting at 12 must never rewrite it to 3.
  // There is nothing to advance, so the correct outcome is no write at all.
  test("never lowers remote progress", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 12, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 3 }));

    expect(result.status).toBe("skipped");
    expect(savedVariables(calls)).toBeUndefined();
  });

  test("advancing past a stale remote value still writes", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 12, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 13 }));

    expect(result.status).toBe("ok");
    expect(savedVariables(calls)).toMatchObject({ progress: 13, status: "CURRENT" });
  });

  test("marks a series COMPLETED once the final episode is watched", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 12,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 11, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 12 }));

    expect(result.status).toBe("ok");
    expect(savedVariables(calls)).toMatchObject({ status: "COMPLETED", progress: 12 });
  });

  test("marks a movie COMPLETED", async () => {
    const { adapter, calls } = adapterWith({
      media: { id: 431, episodes: 1, format: "MOVIE", mediaListEntry: null },
    });
    await adapter.init();

    const result = await adapter.pushProgress(
      progress({
        mediaKind: "movie",
        episode: undefined,
        titleId: "anilist:431",
        externalIds: { anilistId: "431" },
      }),
    );

    expect(result.status).toBe("ok");
    expect(savedVariables(calls)).toMatchObject({ status: "COMPLETED", progress: 1 });
  });

  // AniList tracks a rewatch by resetting progress to 0, which would destroy the
  // completion record if the rewatch is abandoned. An automatic scrobble must
  // never make that trade on the user's behalf.
  test("leaves a completed entry untouched when re-watching", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "COMPLETED", progress: 24, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 2 }));

    expect(result.status).toBe("skipped");
    expect(savedVariables(calls)).toBeUndefined();
  });

  test("a partially watched episode counts only the previous one", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 3, repeat: 0 },
      },
    });
    await adapter.init();

    await adapter.pushProgress(progress({ episode: 5, completed: false }));

    expect(savedVariables(calls)).toMatchObject({ progress: 4 });
  });

  test("skips the write when AniList already matches", async () => {
    const { adapter, calls } = adapterWith({
      media: {
        id: 21,
        episodes: 24,
        format: "TV",
        mediaListEntry: { id: 5, status: "CURRENT", progress: 5, repeat: 0 },
      },
    });
    await adapter.init();

    const result = await adapter.pushProgress(progress({ episode: 5 }));

    expect(result.status).toBe("skipped");
    expect(savedVariables(calls)).toBeUndefined();
  });

  test("reports a mapping failure rather than guessing an id", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushProgress(
      progress({ titleId: "tmdb:1399", mediaKind: "series", externalIds: { tmdbId: "1399" } }),
    );

    expect(result).toMatchObject({ status: "failed", kind: "mapping" });
    expect(calls).toHaveLength(0);
  });

  test("classifies a network error as retryable", async () => {
    const { adapter } = adapterWith({ throwOnFetch: true });
    await adapter.init();

    const result = await adapter.pushProgress(progress());

    expect(result).toMatchObject({ status: "failed", kind: "network" });
  });

  test("classifies an invalid token as an auth failure", async () => {
    const { adapter } = adapterWith({ status: 401 });
    await adapter.init();

    const result = await adapter.pushProgress(progress());

    expect(result).toMatchObject({ status: "failed", kind: "auth" });
    expect(adapter.getConnection().state).toBe("needs-reauth");
  });

  test("classifies a rate limit as a retryable remote failure", async () => {
    const { adapter } = adapterWith({ status: 429 });
    await adapter.init();

    const result = await adapter.pushProgress(progress());

    expect(result).toMatchObject({ status: "failed", kind: "remote" });
  });

  test("skips standalone video, which AniList does not catalog", async () => {
    const { adapter } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushProgress(progress({ mediaKind: "video" }));

    expect(result.status).toBe("skipped");
  });
});

describe("AniListAdapter.pullList", () => {
  test("flattens the media list collection into tracker items", async () => {
    const store = tokenStore({ anilist: { accessToken: "token", userId: 7, username: "kitsune" } });
    const adapter = new AniListAdapter(
      store,
      async () =>
        new Response(
          JSON.stringify({
            data: {
              MediaListCollection: {
                lists: [
                  {
                    entries: [
                      {
                        id: 1,
                        status: "CURRENT",
                        progress: 4,
                        score: 85,
                        updatedAt: 1_700_000_000,
                        media: {
                          id: 21,
                          idMal: 21,
                          episodes: 24,
                          format: "TV",
                          title: { userPreferred: "One Piece", romaji: null, english: null },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await adapter.init();

    const items = await adapter.pullList();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "One Piece",
      mediaKind: "anime",
      status: "watching",
      progress: 4,
      totalEpisodes: 24,
      externalIds: { anilistId: "21", malId: "21" },
    });
  });
});

describe("AniListAdapter.connect", () => {
  test("fails with an actionable message when no application id is configured", async () => {
    const adapter = new AniListAdapter(
      tokenStore({}),
      async () => new Response("{}", { status: 200 }),
      "",
    );

    const result = await adapter.connect({
      signal: new AbortController().signal,
      onPrompt: () => {},
    });

    expect(result).toMatchObject({ status: "failed", kind: "auth" });
    expect(result.status === "failed" && result.error).toContain("anilist.co/settings/developer");
  });
});
