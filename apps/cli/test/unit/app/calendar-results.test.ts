import { expect, test } from "bun:test";

import { loadCalendarResults } from "@/app/search/calendar-results";

function withCalendarServices(input: {
  readonly stateManager: { readonly getState: () => { readonly mode: "anime" | "series" } };
  readonly timelineService: Record<string, unknown>;
  readonly releaseProgressCache?: Record<string, unknown>;
  readonly releaseProgressWriter?: Record<string, unknown>;
  readonly historyRepository?: Record<string, unknown>;
  readonly continueWatchingService?: Record<string, unknown>;
}) {
  return {
    ...input,
    listService: { isInWatchlist: () => false },
  };
}

test("loadCalendarResults maps releasing-today items into structured calendar candidates", async () => {
  let requestedDays = 0;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayIso = today.toISOString();
  const tomorrowIso = tomorrow.toISOString();
  const todayYear = String(today.getFullYear());
  const animeRows = [
    {
      source: "anilist",
      titleId: "22",
      titleName: "Popular Tomorrow",
      type: "anime",
      episode: 6,
      releaseAt: tomorrowIso,
      releasePrecision: "timestamp",
      status: "upcoming",
      posterPath: null,
      popularity: 9000,
    },
    {
      source: "anilist",
      titleId: "21",
      titleName: "Frieren",
      type: "anime",
      episode: 29,
      episodeTitle: "A new journey",
      releaseAt: todayIso,
      releasePrecision: "timestamp",
      status: "upcoming",
      posterPath: "https://img.example/frieren.jpg",
      popularity: 1000,
      averageScore: 92,
    },
  ];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        // Unified loader asks for anime + series; only anime has fixtures here.
        loadReleaseWindow: async (mode: string, days: number) => {
          requestedDays = days;
          return mode === "anime" ? animeRows : [];
        },
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
  );

  expect(requestedDays).toBe(7);
  expect(results.subtitle).toBe("2 this week · 1 airing today · 0 released");
  // Sorted by releaseAt → Frieren (today) before Popular Tomorrow.
  expect(results.results[0]).toMatchObject({
    id: "21",
    type: "series",
    isAnime: true,
    externalIds: { anilistId: "21" },
    title: "Frieren",
    year: todayYear,
    metadataSource: "AniList calendar",
    posterPath: "https://img.example/frieren.jpg",
    rating: 9.2,
    popularity: 1000,
  });
  expect(results.results[0]?.calendar).toMatchObject({
    contentKind: "anime",
    reason: "airing-today",
    releaseStatus: "upcoming",
    providerConfirmed: false,
  });
  expect(results.results[0]?.calendar?.display.episodeCode).toBe("E29");
  expect(results.results[0]?.calendar?.display.statusLabel).toContain("airs today");
  expect(results.results[0]?.calendar?.display.badge).toBe("E29");
  expect(results.results[1]?.calendar?.reason).toBe("upcoming-episode");
  expect(results.results[1]?.calendar?.display.statusLabel).toContain("airs");
});

test("loadCalendarResults distinguishes already released rows from timed upcoming rows", async () => {
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "series" }) },
      timelineService: {
        loadReleasingToday: async (mode: string) =>
          mode === "series"
            ? [
                {
                  source: "tmdb",
                  titleId: "tv-1",
                  titleName: "Slow Horses",
                  type: "series",
                  season: 5,
                  episode: 3,
                  episodeTitle: "Signals",
                  releaseAt: todayDate,
                  releasePrecision: "date",
                  status: "released",
                  posterPath: null,
                },
              ]
            : [],
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
  );

  expect(results.subtitle).toBe("1 this week · 0 airing today · 1 released");
  expect(results.results[0]?.calendar).toMatchObject({
    contentKind: "series",
    releaseStatus: "released",
  });
  expect(results.results[0]?.calendar?.display.episodeCode).toBe("S05E03");
  expect(results.results[0]?.overview).toContain("S05E03");
});

test("loadCalendarResults surfaces cached new-episode counts without fetching providers", async () => {
  const releaseAt = new Date("2099-05-23T12:00:00.000Z").toISOString();
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async (mode: string) =>
          mode === "anime"
            ? [
                {
                  source: "anilist",
                  titleId: "anilist:21",
                  titleName: "Frieren",
                  type: "anime",
                  episode: 31,
                  releaseAt,
                  releasePrecision: "timestamp",
                  status: "released",
                  posterPath: null,
                },
              ]
            : [],
        loadMovieReleaseWindow: async () => [],
      },
      releaseProgressCache: {
        getByTitleIds: (ids: readonly string[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                titleId: id,
                mediaKind: "anime",
                source: "anilist",
                title: "Frieren",
                anchorSeason: 1,
                anchorEpisode: 28,
                latestAiredSeason: 1,
                latestAiredEpisode: 31,
                newEpisodeCount: 3,
                status: "new-episodes",
                checkedAt: "2099-05-23T11:00:00.000Z",
                nextCheckAt: "2099-05-23T14:00:00.000Z",
                staleAfterAt: "2099-05-24T11:00:00.000Z",
                sourceFingerprint: "anilist:21:31",
                errorCount: 0,
              },
            ]),
          ),
      },
    }) as never,
  );

  expect(results.subtitle).toContain("3 new for you");
  expect(results.results[0]?.calendar?.display.badge).toBe("3 new");
});

test("loadCalendarResults projects already-loaded released rows without another schedule fetch", async () => {
  const writes: unknown[] = [];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async (mode: string) =>
          mode === "anime"
            ? [
                {
                  source: "anilist",
                  titleId: "anilist:21",
                  titleName: "Frieren",
                  type: "anime",
                  episode: 31,
                  releaseAt: "2026-05-23T10:00:00.000Z",
                  releasePrecision: "timestamp",
                  status: "released",
                },
              ]
            : [],
        loadMovieReleaseWindow: async () => [],
      },
      historyRepository: {
        listLatestByTitle: () => [
          {
            key: "anime:anilist:21:1:28:none",
            titleId: "anilist:21",
            title: "Frieren",
            mediaKind: "anime",
            season: 1,
            episode: 28,
            positionSeconds: 1200,
            durationSeconds: 1400,
            completed: true,
            providerId: "allmanga",
            updatedAt: "2026-05-20T00:00:00.000Z",
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
      releaseProgressCache: {
        getByTitleIds: () => new Map(),
        upsert: (projection: unknown) => writes.push(projection),
      },
      releaseProgressWriter: {
        upsertOptimistic: (projection: unknown) => writes.push(projection),
      },
    }) as never,
  );

  expect(writes).toHaveLength(1);
  expect(results.results[0]?.calendar?.display.badge).toBe("3 new");
});

test("loadCalendarResults annotates released tracked rows with continuation decisions", async () => {
  const titleDecisionCalls: unknown[] = [];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async (mode: string) =>
          mode === "anime"
            ? [
                {
                  source: "anilist",
                  titleId: "anilist:21",
                  titleName: "Frieren",
                  type: "anime",
                  episode: 31,
                  releaseAt: "2026-05-23T10:00:00.000Z",
                  releasePrecision: "timestamp",
                  status: "released",
                },
              ]
            : [],
        loadMovieReleaseWindow: async () => [],
      },
      historyRepository: {
        listLatestByTitle: () => [
          {
            key: "anime:anilist:21:1:28:none",
            titleId: "anilist:21",
            title: "Frieren",
            mediaKind: "anime",
            season: 1,
            episode: 28,
            positionSeconds: 1200,
            durationSeconds: 1400,
            completed: true,
            providerId: "allmanga",
            updatedAt: "2026-05-20T00:00:00.000Z",
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
      releaseProgressCache: {
        getByTitleIds: () =>
          new Map([
            [
              "anilist:21",
              {
                titleId: "anilist:21",
                mediaKind: "anime",
                source: "anilist",
                title: "Frieren",
                anchorSeason: 1,
                anchorEpisode: 28,
                latestAiredSeason: 1,
                latestAiredEpisode: 31,
                newEpisodeCount: 3,
                status: "new-episodes",
                checkedAt: "2026-05-23T11:00:00.000Z",
                nextCheckAt: "2026-05-23T14:00:00.000Z",
                staleAfterAt: "2099-05-24T11:00:00.000Z",
                sourceFingerprint: "anilist:21:31",
                errorCount: 0,
              },
            ],
          ]),
      },
      continueWatchingService: {
        titleDecision: (titleId: string, signals: unknown) => {
          titleDecisionCalls.push({ titleId, signals });
          return {
            state: "new-episodes",
            badge: "3 new",
            target: {
              titleId,
              title: "Frieren",
              mediaKind: "series",
              season: 1,
              episode: 31,
            },
            primaryAction: {
              kind: "select-online",
              target: {
                titleId,
                title: "Frieren",
                mediaKind: "series",
                season: 1,
                episode: 31,
              },
            },
            secondaryActions: [],
            freshness: "cached",
          };
        },
      },
    }) as never,
  );

  expect(titleDecisionCalls).toHaveLength(1);
  expect(results.results[0]?.calendar?.continuation).toMatchObject({
    state: "new-episodes",
    badge: "3 new",
    playable: true,
    targetTitleId: "anilist:21",
    season: 1,
    episode: 31,
  });
});

test("loadCalendarResults joins AniList schedule rows to provider-native history identities", async () => {
  const writes: Array<{ titleId?: string }> = [];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async (mode: string) =>
          mode === "anime"
            ? [
                {
                  source: "anilist",
                  titleId: "21",
                  titleName: "Frieren",
                  type: "anime",
                  episode: 31,
                  releaseAt: "2026-05-23T10:00:00.000Z",
                  releasePrecision: "timestamp",
                  status: "released",
                },
              ]
            : [],
        loadMovieReleaseWindow: async () => [],
      },
      historyRepository: {
        listLatestByTitle: () => [
          {
            key: "anime:allmanga:opaque:1:28:none",
            titleId: "allmanga:opaque",
            title: "Frieren",
            mediaKind: "anime",
            externalIds: { anilistId: "21" },
            season: 1,
            episode: 28,
            positionSeconds: 1200,
            durationSeconds: 1400,
            completed: true,
            providerId: "allmanga",
            updatedAt: "2026-05-20T00:00:00.000Z",
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
      releaseProgressCache: {
        getByTitleIds: () => new Map(),
        upsert: (projection: { titleId?: string }) => writes.push(projection),
      },
      releaseProgressWriter: {
        upsertOptimistic: (projection: { titleId?: string }) => writes.push(projection),
      },
    }) as never,
  );

  expect(writes[0]?.titleId).toBe("allmanga:opaque");
  expect(results.results[0]?.calendar?.display.badge).toBe("3 new");
});

test("loadCalendarResults collapses duplicate releases with the same title and release time", async () => {
  const releaseAt = new Date("2099-07-01T12:00:00.000Z").toISOString();
  const dupRow = {
    source: "anilist",
    titleId: "dup-1",
    titleName: "Twice Listed",
    type: "anime",
    episode: 7,
    releaseAt,
    releasePrecision: "timestamp",
    status: "upcoming",
    posterPath: null,
  };
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async (mode: string) =>
          mode === "anime" ? [dupRow, { ...dupRow }] : [],
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
  );

  const matching = results.results.filter((r) => r.id === "dup-1");
  expect(matching).toHaveLength(1);
});

test("loadCalendarResults merges anime, series, and movie sources into one window", async () => {
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const inThreeDays = new Date(today);
  inThreeDays.setDate(today.getDate() + 3);
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async (mode: string) =>
          mode === "anime"
            ? [
                {
                  source: "anilist",
                  titleId: "a1",
                  titleName: "Anime One",
                  type: "anime",
                  episode: 4,
                  releaseAt: today.toISOString(),
                  releasePrecision: "timestamp",
                  status: "upcoming",
                },
              ]
            : [
                {
                  source: "tmdb",
                  titleId: "s1",
                  titleName: "Series One",
                  type: "series",
                  season: 2,
                  episode: 5,
                  releaseAt: dayKey(inThreeDays),
                  releasePrecision: "date",
                  status: "upcoming",
                },
              ],
        loadMovieReleaseWindow: async () => [
          {
            source: "tmdb",
            titleId: "m1",
            titleName: "Movie One",
            type: "movie",
            releaseAt: dayKey(inThreeDays),
            releasePrecision: "date",
            status: "upcoming",
          },
        ],
      },
    }) as never,
  );

  const kinds = results.results.map((r) => r.calendar?.contentKind);
  expect(kinds).toContain("anime");
  expect(kinds).toContain("series");
  expect(kinds).toContain("movie");
  // Sorted by releaseAt → today's anime first.
  expect(results.results[0]?.calendar?.contentKind).toBe("anime");
  expect(results.results.find((r) => r.calendar?.contentKind === "movie")?.calendar?.reason).toBe(
    "movie-release",
  );
});

// ---------------------------------------------------------------------------
// Abort-safe source aggregation
//
// The calendar merges anime / series / movie windows with `allSettled` so one
// dead source cannot blank the schedule. That tolerance must not also swallow
// "every source failed" or "the user cancelled" into a cheerful empty week.
// ---------------------------------------------------------------------------

function calendarDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

test("keeps partial rows when one supported source fails and another succeeds", async () => {
  const anime = calendarDeferred<unknown[]>();
  const series = calendarDeferred<unknown[]>();
  const pending = loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async (mode: string) =>
          mode === "anime" ? anime.promise : series.promise,
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
  );
  series.reject(new Error("tmdb unavailable"));
  anime.resolve([
    {
      source: "anilist",
      titleId: "21",
      titleName: "Frieren",
      type: "anime",
      episode: 29,
      releaseAt: new Date(Date.now() + 60_000).toISOString(),
      releasePrecision: "timestamp",
      status: "upcoming",
    },
  ]);

  const bundle = await pending;
  expect(bundle.results.map((r) => r.title)).toEqual(["Frieren"]);
});

test("rejects with a bounded aggregate when every real source fails and no movie loader exists", async () => {
  const settledModes: string[] = [];
  await expect(
    loadCalendarResults(
      withCalendarServices({
        stateManager: { getState: () => ({ mode: "anime" }) },
        timelineService: {
          loadReleaseWindow: async (mode: string) => {
            settledModes.push(mode);
            throw new Error(`${mode} source down`);
          },
        },
      }) as never,
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  // A missing optional movie loader contributes neither a success nor a failure;
  // only the two real source tasks may be settled.
  expect(settledModes).toEqual(["anime", "series"]);
});

test("rejects with the same aggregate classification when all three sources fail", async () => {
  let error: unknown;
  try {
    await loadCalendarResults(
      withCalendarServices({
        stateManager: { getState: () => ({ mode: "anime" }) },
        timelineService: {
          loadReleaseWindow: async (mode: string) => {
            throw new Error(`${mode} source down`);
          },
          loadMovieReleaseWindow: async () => {
            throw new Error("movie source down");
          },
        },
      }) as never,
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors.length).toBe(3);
});

test("propagates an abort rather than reporting an empty week", async () => {
  const controller = new AbortController();
  const anime = calendarDeferred<unknown[]>();
  const pending = loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async () => anime.promise,
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
    controller.signal,
  );
  controller.abort();
  // Sources observe the abort and reject; allSettled still completes normally.
  anime.reject(new Error("aborted by caller"));

  let error: unknown;
  try {
    await pending;
  } catch (caught) {
    error = caught;
  }
  expect((error as { name?: string } | undefined)?.name).toBe("AbortError");
});

test("treats three fulfilled empty source responses as a real empty week", async () => {
  const bundle = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async () => [],
        loadMovieReleaseWindow: async () => [],
      },
    }) as never,
  );
  expect(bundle.results).toEqual([]);
  expect(bundle.subtitle).toBe("No releases found for the next week");
});
