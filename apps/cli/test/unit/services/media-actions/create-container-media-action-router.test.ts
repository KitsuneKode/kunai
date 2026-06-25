import { describe, expect, test } from "bun:test";

import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";

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
      listService: {
        addToWatchlist: () => {
          calls.push("watchlist");
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

    expect(calls).toEqual(["queue", "follow", "follow", "watchlist", "playlist"]);
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
