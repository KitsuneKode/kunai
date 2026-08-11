import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { TmdbAdapter } from "@/services/sync/TmdbAdapter";
import type { TrackerListItem, TrackerProgress } from "@/services/sync/types";

interface HttpCall {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | undefined;
}

function tokenStore(initial: Record<string, unknown> = {}): SyncTokenStore {
  return {
    load: async () => initial,
    save: async () => {},
    clear: async () => {},
    patchAniList: async () => {},
    patchTmdb: async () => {},
  } as unknown as SyncTokenStore;
}

function adapterWith(options: {
  readonly status?: number;
  readonly json?: unknown;
  readonly throwOnFetch?: boolean;
  readonly tokens?: Record<string, unknown>;
}): { adapter: TmdbAdapter; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const adapter = new TmdbAdapter(
    tokenStore(
      options.tokens ?? { tmdb: { sessionId: "session", accountId: 42, username: "kitsune" } },
    ),
    "test-key",
    async (input, init) => {
      if (options.throwOnFetch) throw new Error("network unreachable");
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      if (options.status && options.status >= 400) {
        return new Response("{}", { status: options.status });
      }
      return new Response(JSON.stringify(options.json ?? { success: true, id: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return { adapter, calls };
}

const movieProgress: TrackerProgress = {
  titleId: "tmdb:603",
  title: "The Matrix",
  mediaKind: "movie",
  externalIds: { tmdbId: "603" },
  completed: true,
};

function listItem(overrides: Partial<TrackerListItem> = {}): TrackerListItem {
  return {
    titleId: "tmdb:1399",
    title: "Game of Thrones",
    mediaKind: "series",
    externalIds: { tmdbId: "1399" },
    listKind: "watchlist",
    ...overrides,
  };
}

describe("TmdbAdapter capabilities", () => {
  test("declares that it cannot record episode progress", () => {
    const { adapter } = adapterWith({});
    expect(adapter.capabilities.episodeProgress).toBe(false);
    expect(adapter.capabilities.lists).toBe(true);
  });
});

describe("TmdbAdapter.pushProgress", () => {
  // The previous implementation POSTed to the watchlist endpoint with
  // `watchlist: false`, which *removed* the title from the user's TMDB
  // watchlist every time an episode finished. TMDB has no progress API, so the
  // only correct answer is to do nothing.
  test("skips instead of writing anything, and makes no request", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushProgress(movieProgress);

    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  test("explains that AniList owns anime progress", async () => {
    const { adapter } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushProgress({ ...movieProgress, mediaKind: "anime" });

    expect(result).toMatchObject({ status: "skipped" });
    expect(result.status === "skipped" && result.reason).toContain("AniList");
  });
});

describe("TmdbAdapter.pushListItem", () => {
  test("adds to the watchlist with the flag set to true", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushListItem(listItem());

    expect(result.status).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/account/42/watchlist");
    expect(calls[0]?.body).toEqual({ media_type: "tv", media_id: 1399, watchlist: true });
  });

  test("uses the favorite flag key on the favorite endpoint", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    await adapter.pushListItem(
      listItem({
        listKind: "favorites",
        mediaKind: "movie",
        titleId: "tmdb:603",
        externalIds: { tmdbId: "603" },
      }),
    );

    expect(calls[0]?.url).toContain("/account/42/favorite");
    expect(calls[0]?.body).toEqual({ media_type: "movie", media_id: 603, favorite: true });
  });

  test("maps anime onto the TV catalog", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    await adapter.pushListItem(listItem({ mediaKind: "anime" }));

    expect(calls[0]?.body).toMatchObject({ media_type: "tv" });
  });

  test("refuses to guess a TMDB id from another namespace", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushListItem(
      listItem({ titleId: "anilist:21", mediaKind: "anime", externalIds: { anilistId: "21" } }),
    );

    expect(result).toMatchObject({ status: "failed", kind: "mapping" });
    expect(calls).toHaveLength(0);
  });

  test("skips media kinds TMDB does not catalog", async () => {
    const { adapter, calls } = adapterWith({});
    await adapter.init();

    const result = await adapter.pushListItem(
      listItem({ mediaKind: "video", titleId: "tmdb:1", externalIds: { tmdbId: "1" } }),
    );

    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  test("classifies a rejected session as an auth failure", async () => {
    const { adapter } = adapterWith({ status: 401 });
    await adapter.init();

    const result = await adapter.pushListItem(listItem());

    expect(result).toMatchObject({ status: "failed", kind: "auth" });
    expect(adapter.getConnection().state).toBe("needs-reauth");
  });

  test("classifies a transport error as retryable", async () => {
    const { adapter } = adapterWith({ throwOnFetch: true });
    await adapter.init();

    const result = await adapter.pushListItem(listItem());

    expect(result).toMatchObject({ status: "failed", kind: "network" });
  });
});

describe("TmdbAdapter session handling", () => {
  test("a network failure during refresh keeps the session connected", async () => {
    const { adapter } = adapterWith({ throwOnFetch: true });
    await adapter.init();

    await adapter.refreshIdentity();

    expect(adapter.isConnected()).toBe(true);
  });
});

describe("TmdbAdapter.pullList", () => {
  test("merges watchlist and favourites across both catalogs", async () => {
    const { adapter } = adapterWith({
      json: { page: 1, total_pages: 1, results: [{ id: 603, title: "The Matrix" }] },
    });
    await adapter.init();

    const items = await adapter.pullList();

    // Same id appears in both the watchlist and favourites sources per kind;
    // the result is de-duplicated to one entry per (kind, id).
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.mediaKind).sort()).toEqual(["movie", "series"]);
    expect(items[0]?.externalIds.tmdbId).toBe("603");
  });
});
