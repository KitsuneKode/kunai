import { describe, expect, test } from "bun:test";

import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";

describe("createContainerMediaActionRouter", () => {
  test("routes follow and queue actions through container services", async () => {
    const calls: string[] = [];
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
        upsert: () => {
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

    const router = createContainerMediaActionRouter(container as never);
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
      actionId: "add-to-playlist",
      item: {
        mediaKind: "series",
        titleId: "tmdb:1",
        title: "Example",
      },
      source: "notification",
    });

    expect(calls).toEqual(["queue", "follow", "watchlist"]);
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
