import { describe, expect, test } from "bun:test";

import {
  createContainerMediaActionRouter,
  queueDownloadFromMediaItem,
} from "@/services/media-actions/create-container-media-action-router";

describe("createContainerMediaActionRouter", () => {
  test("routes watchlist, follow, unfollow, and queue actions through container services", async () => {
    const calls: string[] = [];
    const preferences: string[] = [];
    const container = {
      queueService: {
        enqueueMediaItem: () => {
          calls.push("queue");
        },
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      syncService: {
        enqueueListMembershipIfEnabled: (input: { present: boolean }) => {
          calls.push(`sync:watchlist:${input.present}`);
          return 1;
        },
        enqueueFavoriteMembershipIfEnabled: (input: { present: boolean }) => {
          calls.push(`sync:favorite:${input.present}`);
          return 1;
        },
      },
      listService: {
        addToWatchlist: () => {
          calls.push("watchlist");
        },
        toggleFavorites: () => {
          calls.push("favorite");
          return "added" as const;
        },
      },
      followedTitleRepository: {
        upsert: (record: { preference: string }) => {
          preferences.push(record.preference);
          calls.push("follow");
        },
      },
      notificationService: {
        listActive: () => [],
      },
      stateManager: {
        dispatch: () => {},
      },
    };

    const router = createContainerMediaActionRouter(container as never, {
      playlists: {
        addToPlaylist: async () => {
          calls.push("playlist");
        },
      },
    });
    await router.run({
      actionId: "queue-end",
      item: {
        mediaKind: "series",
        titleId: "tmdb:1",
        title: "Example",
        season: 1,
        episode: 2,
      },
      source: "notification",
    });
    await router.run({
      actionId: "follow",
      item: {
        mediaKind: "series",
        titleId: "tmdb:1",
        title: "Example",
      },
      source: "notification",
    });
    await router.run({
      actionId: "unfollow",
      item: {
        mediaKind: "series",
        titleId: "tmdb:1",
        title: "Example",
      },
      source: "notification",
    });
    await router.run({
      actionId: "add-to-watchlist",
      item: {
        mediaKind: "series",
        titleId: "tmdb:1",
        title: "Example",
      },
      source: "notification",
    });

    await expect(
      router.run({
        actionId: "add-to-playlist",
        item: {
          mediaKind: "series",
          titleId: "tmdb:1",
          title: "Example",
        },
        source: "notification",
      }),
    ).resolves.toMatchObject({ status: "handled", actionId: "add-to-playlist" });

    // Watchlisting also hands the change to the outbox, so a connected tracker
    // mirrors it. Enqueue is unconditional: the work waits rather than being
    // lost because nothing happened to be linked at that moment.
    expect(calls).toEqual([
      "queue",
      "follow",
      "follow",
      "watchlist",
      "sync:watchlist:true",
      "playlist",
    ]);
    expect(preferences).toEqual(["following", "implicit"]);
  });

  test("allows callers to override the download executor", async () => {
    const calls: string[] = [];
    const container = {
      queueService: {
        enqueueMediaItem: () => {},
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      listService: {
        addToWatchlist: () => {},
      },
      followedTitleRepository: {
        upsert: () => {},
      },
      notificationService: {
        listActive: () => [],
      },
      stateManager: {
        dispatch: () => {
          calls.push("default-download");
        },
      },
    };

    const router = createContainerMediaActionRouter(container as never, {
      downloads: {
        queueDownload: (item) => {
          calls.push(`custom-download:${item.titleId}`);
        },
      },
    });

    await router.run({
      actionId: "download",
      item: {
        mediaKind: "series",
        titleId: "tmdb:2",
        title: "Custom",
      },
      source: "post-playback-recommendation",
      confirmedProviderResolution: true,
    });

    expect(calls).toEqual(["custom-download:tmdb:2"]);
  });
});

/**
 * The router is the non-interactive download path. It carries the item's own
 * content kind through to the intent service instead of letting the service
 * re-derive one from `TitleInfo.type`, which cannot distinguish video from
 * series or a movie from a one-episode show.
 */
describe("queueDownloadFromMediaItem authoritative kind", () => {
  function harness() {
    const enqueued: Record<string, unknown>[] = [];
    const container = {
      config: {
        offlineDefaultRunwayTarget: 2,
        downloadPath: "",
        offlineArtworkCacheEnabled: false,
      },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async (input: Record<string, unknown>) => {
          enqueued.push(input);
          return { id: `job-${enqueued.length}` };
        },
        kickQueue: () => {},
      },
      offlineTitlePolicies: { get: () => undefined, upsert: () => {} },
      offlineRunwayService: { enqueueEvaluation: () => {} },
      diagnosticsService: { record: () => {} },
      stateManager: {
        getState: () => ({
          provider: "vidking",
          mode: "series",
          seriesLanguageProfile: { audio: "en", subtitle: "en", quality: "best" },
          animeLanguageProfile: { audio: "en", subtitle: "en", quality: "best" },
          movieLanguageProfile: { audio: "en", subtitle: "en", quality: "best" },
        }),
        dispatch: () => {},
      },
    } as never;
    return { container, enqueued };
  }

  test("a movie item commits a title-level download with no episode", async () => {
    const { container, enqueued } = harness();

    await queueDownloadFromMediaItem(container, {
      mediaKind: "movie",
      titleId: "tmdb:693134",
      title: "Dune: Part Two",
      season: 1,
      episode: 1,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ episode: undefined });
    expect(enqueued[0]?.title).toMatchObject({ type: "movie", name: "Dune: Part Two" });
  });

  test("a video item commits title-level through youtube mode", async () => {
    const { container, enqueued } = harness();

    await queueDownloadFromMediaItem(container, {
      mediaKind: "video",
      titleId: "yt:1",
      title: "Kunai Release Trailer",
    });

    expect(enqueued[0]).toMatchObject({ episode: undefined, mode: "youtube" });
  });

  test("an anime item keeps its episode and anime mode", async () => {
    const { container, enqueued } = harness();

    await queueDownloadFromMediaItem(container, {
      mediaKind: "anime",
      titleId: "anilist:1",
      title: "Frieren",
      season: 1,
      episode: 3,
    });

    expect(enqueued[0]).toMatchObject({
      mode: "anime",
      episode: { season: 1, episode: 3 },
    });
  });
});

/**
 * Favourites are a desired state, not a nudge: the local list decides, and the
 * tracker is told the resulting value. Sending "toggle" instead would let a
 * redelivery undo what the user just did.
 */
describe("createContainerMediaActionRouter favourites", () => {
  function harness(toggleResult: "added" | "removed") {
    const calls: string[] = [];
    const container = {
      queueService: { enqueueMediaItem: () => {} },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      syncService: {
        enqueueListMembershipIfEnabled: () => 1,
        enqueueFavoriteMembershipIfEnabled: (input: { present: boolean }) => {
          calls.push(`sync:favorite:${input.present}`);
          return 1;
        },
      },
      listService: {
        toggleFavorites: () => {
          calls.push("local:toggle");
          return toggleResult;
        },
      },
      followedTitleRepository: { upsert: () => {} },
      notificationService: { listActive: () => [] },
      stateManager: { dispatch: () => {} },
    } as unknown as Parameters<typeof createContainerMediaActionRouter>[0];

    return { calls, router: createContainerMediaActionRouter(container) };
  }

  const item = { titleId: "tmdb:123", mediaKind: "series", title: "Test" } as const;

  /**
   * `sync.startup` was the only automatic drain, so a change queued mid-session
   * waited for the next launch — which, from the user's side, looks exactly like
   * a change that was never queued.
   */
  test("delivers the queued change instead of waiting for the next launch", async () => {
    let drains = 0;
    const container = {
      queueService: { enqueueMediaItem: () => {} },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      syncService: {
        enqueueFavoriteMembershipIfEnabled: () => 1,
        deliverSoon: () => {
          drains += 1;
        },
      },
      listService: { toggleFavorites: () => "added" as const },
      followedTitleRepository: { upsert: () => {} },
      notificationService: { listActive: () => [] },
      stateManager: { dispatch: () => {} },
    } as unknown as Parameters<typeof createContainerMediaActionRouter>[0];

    await createContainerMediaActionRouter(container).run({
      actionId: "toggle-favorite",
      item,
      source: "browse",
    });

    expect(drains).toBe(1);
  });

  /** Nothing queued, nothing to deliver — an empty drain is wasted work. */
  test("does not drain when no tracker could address the title", async () => {
    let drains = 0;
    const container = {
      queueService: { enqueueMediaItem: () => {} },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      catalogIdentityService: {
        enrich: async () => ({ graph: { confidence: "low", source: "arm" } }),
      },
      syncService: {
        enqueueFavoriteMembershipIfEnabled: () => 0,
        deliverSoon: () => {
          drains += 1;
        },
      },
      diagnosticsService: { record: () => {} },
      listService: { toggleFavorites: () => "added" as const },
      followedTitleRepository: { upsert: () => {} },
      notificationService: { listActive: () => [] },
      stateManager: { dispatch: () => {} },
    } as unknown as Parameters<typeof createContainerMediaActionRouter>[0];

    await createContainerMediaActionRouter(container).run({
      actionId: "toggle-favorite",
      item: { titleId: "allanime:xyz", mediaKind: "anime", title: "Test" },
      source: "browse",
    });

    expect(drains).toBe(0);
  });

  test("mirrors the resulting state, not the gesture", async () => {
    for (const [result, expected] of [
      ["added", "sync:favorite:true"],
      ["removed", "sync:favorite:false"],
    ] as const) {
      const { calls, router } = harness(result);
      await router.run({ actionId: "toggle-favorite", item, source: "browse" });

      expect(calls, result).toEqual(["local:toggle", expected]);
    }
  });

  /** The local write already happened; a broken outbox must not undo the key. */
  test("still reports handled when the outbox rejects the mirror", async () => {
    const calls: string[] = [];
    const container = {
      queueService: { enqueueMediaItem: () => {} },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: false, reason: "disabled", code: "disabled" }),
      },
      syncService: {
        enqueueFavoriteMembershipIfEnabled: () => {
          throw new Error("database is closed");
        },
      },
      listService: {
        toggleFavorites: () => {
          calls.push("local:toggle");
          return "added" as const;
        },
      },
      followedTitleRepository: { upsert: () => {} },
      notificationService: { listActive: () => [] },
      stateManager: { dispatch: () => {} },
    } as unknown as Parameters<typeof createContainerMediaActionRouter>[0];

    const result = await createContainerMediaActionRouter(container).run({
      actionId: "toggle-favorite",
      item,
      source: "browse",
    });

    expect(result.status).toBe("handled");
    expect(calls).toEqual(["local:toggle"]);
  });
});
