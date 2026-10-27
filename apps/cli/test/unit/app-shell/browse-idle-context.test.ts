import { describe, expect, test } from "bun:test";

import { buildBrowseIdleContext } from "@/app-shell/browse-idle-context";

describe("buildBrowseIdleContext", () => {
  test("resume and saved titles follow the active mode without changing queue order", async () => {
    const row = (mediaKind: "movie" | "anime" | "video", title: string, updatedAt: string) => ({
      key: title,
      titleId: title,
      title,
      mediaKind,
      providerId: mediaKind === "anime" ? "hianime" : mediaKind === "video" ? "youtube" : "vidlink",
      positionSeconds: 90,
      durationSeconds: 600,
      completed: false,
      createdAt: updatedAt,
      updatedAt,
    });
    const history = [
      row("video", "Newest video", "2026-06-13T12:00:00Z"),
      row("anime", "Anime resume", "2026-06-13T11:00:00Z"),
      row("movie", "Movie resume", "2026-06-13T10:00:00Z"),
    ];
    const queued = { titleId: "queue-video", title: "Queued video", mediaKind: "video" };
    const container = {
      queueService: { peekNext: () => queued },
      releaseProgressCache: {
        summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
        getByTitleIds: () => new Map(),
      },
      offlineAssetService: { listNextReadyByTitleCursors: () => [] },
      historyRepository: { listLatestByTitle: () => history },
      config: { lastCalendarVisitAt: 0 },
      followedTitleRepository: { listByPreference: () => [] },
      listService: {
        getWatchlist: () => history.map((entry) => ({ ...entry, addedAt: entry.createdAt })),
      },
    };
    // SAFETY: the read-only container stub implements every reader used by the idle builder.
    const idleContainer = container as never;
    for (const [mode, expected] of [
      ["series", "Movie resume"],
      ["anime", "Anime resume"],
      ["youtube", "Newest video"],
      ["anime", "Anime resume"],
    ] as const) {
      const result = await buildBrowseIdleContext(idleContainer, { mode });
      expect(result.idleContext?.continueWatching?.title).toBe(expected);
      expect(result.continueWatchingSelection?.entry.title).toBe(expected);
      expect(result.idleContext?.savedNext?.title).toBe(expected);
      expect(result.idleContext?.savedNext?.total).toBe(1);
      expect(result.idleContext?.playlistNext?.title).toBe(
        mode === "youtube" ? "Queued video" : undefined,
      );
      expect(container.queueService.peekNext()).toBe(queued);
    }
    const empty = await buildBrowseIdleContext(idleContainer, {
      mode: "anime",
      preloadedHistory: { video: history[0]! },
    });
    expect(empty.continueWatchingSelection).toBeNull();
    expect(empty.idleContext?.continueWatching).toBeUndefined();
  });

  test("prioritizes local resume and offline-ready reads without provider calls", async () => {
    const container = {
      queueService: {
        peekNext: () => ({
          title: "Queued",
          titleId: "tmdb:9",
          mediaKind: "series",
          season: 1,
          episode: 3,
        }),
      },
      releaseProgressCache: {
        summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
        getByTitleIds: () => new Map(),
      },
      offlineAssetService: {
        listNextReadyByTitleCursors: () => [
          {
            titleId: "tmdb:2",
            season: 1,
            episode: 6,
            originJobId: "job-offline-2",
          },
        ],
      },
      historyRepository: {
        listLatestByTitle: () => [],
      },
      config: {
        lastCalendarVisitAt: 0,
      },
      followedTitleRepository: {
        listByPreference: () => [],
      },
      listService: {
        getWatchlist: () => [
          {
            titleId: "tmdb:7",
            title: "Saved For Later",
            addedAt: "2026-06-10T09:00:00.000Z",
          },
          {
            titleId: "tmdb:8",
            title: "Second Saved",
            addedAt: "2026-06-11T09:00:00.000Z",
          },
        ],
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const { idleContext } = await buildBrowseIdleContext(container as never, {
      preloadedHistory: {
        "tmdb:1": {
          key: "tmdb:1",
          titleId: "tmdb:1",
          title: "Resume Me",
          season: 1,
          episode: 2,
          positionSeconds: 600,
          durationSeconds: 1200,
          completed: false,
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T10:00:00.000Z",
          mediaKind: "series",
        },
        "tmdb:2": {
          key: "tmdb:2",
          titleId: "tmdb:2",
          title: "Offline Next",
          season: 1,
          episode: 5,
          positionSeconds: 1200,
          durationSeconds: 1200,
          completed: true,
          createdAt: "2026-06-12T09:00:00.000Z",
          updatedAt: "2026-06-12T10:00:00.000Z",
          mediaKind: "series",
        },
      },
    });

    expect(idleContext?.continueWatching?.title).toBe("Resume Me");
    expect(idleContext?.offlineReadyNext?.title).toBe("Offline Next");
    expect(idleContext?.playlistNext?.title).toBe("Queued");
    expect(idleContext?.savedNext).toEqual({
      title: "Saved For Later",
      titleId: "tmdb:7",
      total: 2,
    });
  });

  test("Continue hero requires engage gate (>30s) and ignores DNS-short rows", async () => {
    const container = {
      queueService: {
        peekNext: () => null,
      },
      releaseProgressCache: {
        summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
        getByTitleIds: () => new Map(),
      },
      offlineAssetService: {
        listNextReadyByTitleCursors: () => [],
      },
      historyRepository: {
        listLatestByTitle: () => [],
      },
      listService: {
        getWatchlist: () => [],
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const { idleContext } = await buildBrowseIdleContext(container as never, {
      preloadedHistory: {
        "tmdb:short": {
          key: "tmdb:short",
          titleId: "tmdb:short",
          title: "Too Short",
          season: 1,
          episode: 1,
          positionSeconds: 30,
          durationSeconds: 1200,
          completed: false,
          createdAt: "2026-07-21T09:00:00.000Z",
          updatedAt: "2026-07-21T10:00:00.000Z",
          mediaKind: "series",
        },
        "tmdb:engaged": {
          key: "tmdb:engaged",
          titleId: "tmdb:engaged",
          title: "Engaged Title",
          season: 1,
          episode: 2,
          positionSeconds: 31,
          durationSeconds: 1200,
          completed: false,
          createdAt: "2026-07-21T09:00:00.000Z",
          updatedAt: "2026-07-21T09:30:00.000Z",
          mediaKind: "series",
        },
      },
    });
    expect(idleContext?.continueWatching?.title).toBe("Engaged Title");
  });
});
