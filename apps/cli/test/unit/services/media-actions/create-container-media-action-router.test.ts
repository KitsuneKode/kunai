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
        processQueue: () => {},
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
