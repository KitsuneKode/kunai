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

  test("a queued movie has no episode label (no SundefinedEundefined)", async () => {
    const container = {
      queueService: {
        // Movie queue items carry undefined, not null, for season/episode.
        peekNext: () => ({ title: "The Odyssey", titleId: "tmdb:11", mediaKind: "movie" }),
      },
      releaseProgressCache: {
        summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
        getByTitleIds: () => new Map(),
      },
      offlineAssetService: { listNextReadyByTitleCursors: () => [] },
      historyRepository: { listLatestByTitle: () => [] },
      config: { lastCalendarVisitAt: 0 },
      followedTitleRepository: { listByPreference: () => [] },
      listService: { getWatchlist: () => [] },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const { idleContext } = await buildBrowseIdleContext(container as never, {
      preloadedHistory: {},
    });

    expect(idleContext?.playlistNext?.title).toBe("The Odyssey");
    expect(idleContext?.playlistNext?.ep).toBeUndefined();
  });

  test("Continue hero uses the resume floor (>10s), the same as --continue, and skips did-not-start rows", async () => {
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
          positionSeconds: 10,
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
          positionSeconds: 11,
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

  describe("next up after a finished episode", () => {
    function containerWith(input: {
      readonly releases?: ReadonlyMap<string, unknown>;
      readonly readyNext?: readonly unknown[];
    }) {
      return {
        queueService: { peekNext: () => null },
        releaseProgressCache: {
          summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
          getByTitleIds: () => input.releases ?? new Map(),
        },
        offlineAssetService: { listNextReadyByTitleCursors: () => input.readyNext ?? [] },
        historyRepository: { listLatestByTitle: () => [] },
        listService: { getWatchlist: () => [] },
        config: { lastCalendarVisitAt: 0 },
        followedTitleRepository: { listByPreference: () => [] },
      };
    }

    const finishedEp3 = {
      key: "tmdb:show:1:3",
      titleId: "tmdb:show",
      title: "Binge Show",
      season: 1,
      episode: 3,
      positionSeconds: 1380,
      durationSeconds: 1400,
      completed: true,
      createdAt: "2026-11-20T09:00:00.000Z",
      updatedAt: "2026-11-20T10:00:00.000Z",
      mediaKind: "series" as const,
    };
    const olderUnfinished = {
      key: "tmdb:older:1:1",
      titleId: "tmdb:older",
      title: "Older Unfinished",
      season: 1,
      episode: 1,
      positionSeconds: 300,
      durationSeconds: 1400,
      completed: false,
      createdAt: "2026-11-10T09:00:00.000Z",
      updatedAt: "2026-11-10T10:00:00.000Z",
      mediaKind: "series" as const,
    };
    // An old backlog: reconciliation calls it caught-up because nothing aired
    // since the last watch, but episodes 4–10 exist.
    const backlog = {
      titleId: "tmdb:show",
      mediaKind: "series",
      source: "tmdb",
      title: "Binge Show",
      anchorSeason: 1,
      anchorEpisode: 3,
      latestAiredSeason: 1,
      latestAiredEpisode: 10,
      newEpisodeCount: 0,
      status: "caught-up",
      checkedAt: "2026-11-20T11:00:00.000Z",
      nextCheckAt: "2026-11-21T11:00:00.000Z",
      staleAfterAt: "2999-01-01T00:00:00.000Z",
      sourceFingerprint: "series:10",
      errorCount: 0,
    };

    test("the row offers the next aired episode, and Enter starts it", async () => {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const { idleContext, continueWatchingSelection } = await buildBrowseIdleContext(
        containerWith({ releases: new Map([["tmdb:show", backlog]]) }) as never,
        { preloadedHistory: { "tmdb:show": finishedEp3, "tmdb:older": olderUnfinished } },
      );

      expect(idleContext?.continueWatching).toMatchObject({
        title: "Binge Show",
        ep: "S01E04",
        nextUp: true,
        titleId: "tmdb:show",
      });
      expect(idleContext?.continueWatching?.remainingLabel).toBeUndefined();
      expect(continueWatchingSelection?.targetEpisode).toEqual({
        season: 1,
        episode: 4,
        reason: "new-episode",
      });
      expect(continueWatchingSelection?.entry).toBe(finishedEp3);
    });

    test("without release evidence it never guesses an episode; the next title continues", async () => {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const { idleContext } = await buildBrowseIdleContext(containerWith({}) as never, {
        preloadedHistory: { "tmdb:show": finishedEp3, "tmdb:older": olderUnfinished },
      });

      expect(idleContext?.continueWatching).toMatchObject({
        title: "Older Unfinished",
        ep: "S01E01",
      });
      expect(idleContext?.continueWatching?.nextUp).toBeFalsy();
    });

    test("a downloaded next episode stays on the offline row, not the streaming one", async () => {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const { idleContext } = await buildBrowseIdleContext(
        containerWith({
          releases: new Map([["tmdb:show", backlog]]),
          readyNext: [{ titleId: "tmdb:show", season: 1, episode: 4, originJobId: "job-4" }],
        }) as never,
        { preloadedHistory: { "tmdb:show": finishedEp3, "tmdb:older": olderUnfinished } },
      );

      expect(idleContext?.offlineReadyNext).toMatchObject({
        title: "Binge Show",
        ep: "S01E04",
        offlineJobId: "job-4",
      });
      expect(idleContext?.continueWatching?.title).toBe("Older Unfinished");
    });
  });

  test("airing today counts by local date, and never a muted title", async () => {
    // 00:30 local today is the previous UTC day east of UTC and can be the
    // next one west of it; the calendar this nudge opens files it under today.
    const earlyToday = new Date();
    earlyToday.setHours(0, 30, 0, 0);
    const projections = new Map([
      ["tmdb:1", { titleId: "tmdb:1", nextAiringAt: earlyToday.toISOString() }],
      ["tmdb:2", { titleId: "tmdb:2", nextAiringAt: earlyToday.toISOString() }],
    ]);
    const container = {
      queueService: { peekNext: () => null },
      releaseProgressCache: {
        summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
        getByTitleIds: () => projections,
      },
      offlineAssetService: { listNextReadyByTitleCursors: () => [] },
      historyRepository: { listLatestByTitle: () => [] },
      config: { lastCalendarVisitAt: 0 },
      followedTitleRepository: {
        listByPreference: (preference: string) =>
          preference === "muted" ? [{ titleId: "tmdb:2" }] : [],
      },
      listService: { getWatchlist: () => [] },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const { idleContext } = await buildBrowseIdleContext(container as never, {
      preloadedHistory: {},
    });

    expect(idleContext?.calendarNudge).toEqual({ airingTodayCount: 1 });
  });
});
