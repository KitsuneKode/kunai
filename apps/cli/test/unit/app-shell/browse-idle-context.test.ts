import { describe, expect, test } from "bun:test";

import { buildBrowseIdleContext } from "@/app-shell/browse-idle-context";

describe("buildBrowseIdleContext", () => {
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
    };

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
  });
});
