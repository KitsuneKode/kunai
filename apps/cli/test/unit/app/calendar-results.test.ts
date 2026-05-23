import { expect, test } from "bun:test";

import { loadCalendarResults } from "@/app/calendar-results";

function withCalendarServices(input: {
  readonly stateManager: { readonly getState: () => { readonly mode: "anime" | "series" } };
  readonly timelineService: Record<string, unknown>;
  readonly releaseProgressCache?: Record<string, unknown>;
  readonly historyStore?: Record<string, unknown>;
}) {
  return {
    ...input,
    listService: { isInWatchlist: () => false },
  };
}

test("loadCalendarResults maps releasing-today items into playable browse candidates", async () => {
  let requestedDays = 0;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayIso = today.toISOString();
  const tomorrowIso = tomorrow.toISOString();
  const todayYear = String(today.getFullYear());
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleaseWindow: async (_mode: string, days: number) => {
          requestedDays = days;
          return [
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
        },
        loadReleasingToday: async () => [
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
          },
        ],
      },
    }) as never,
  );

  expect(requestedDays).toBe(7);
  expect(results.subtitle).toBe("2 this week · 1 airing today · 0 released · anime schedule");
  expect(results.results[0]).toMatchObject({
    id: "21",
    type: "series",
    title: "Frieren",
    year: todayYear,
    metadataSource: "AniList calendar · Today · airs today · timestamp",
    episodeCount: 29,
    posterPath: "https://img.example/frieren.jpg",
    rating: 9.2,
    popularity: 1000,
    displayGroup: expect.stringContaining("Today"),
    displayTime: expect.any(String),
    displayBadge: "E29",
    // status "upcoming" but releasing today → airing-today (not released, not future)
    displayReleaseStatus: "airing-today",
  });
  expect(results.results[0]?.overview).toContain("E29 · A new journey");
  expect(results.results[0]?.overview).toContain("airs today at");
  expect(results.results[1]?.metadataSource).toContain("Tomorrow");
  expect(results.results[1]?.metadataSource).toContain("airs tomorrow");
  expect(results.results[1]?.overview).toContain("airs tomorrow at");
});

test("loadCalendarResults distinguishes already released rows from timed upcoming rows", async () => {
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "series" }) },
      timelineService: {
        loadReleasingToday: async () => [
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
        ],
      },
    }) as never,
  );

  expect(results.subtitle).toBe("1 this week · 0 airing today · 1 released · series schedule");
  expect(results.results[0]?.metadataSource).toBe("TMDB calendar · Today · new today · date");
  expect(results.results[0]?.overview).toContain("S05E03");
  expect(results.results[0]?.overview).toContain("available today");
  expect(results.results[0]?.overview).not.toContain("Availability is checked");
});

test("loadCalendarResults surfaces cached new-episode counts without fetching providers", async () => {
  const releaseAt = new Date("2099-05-23T12:00:00.000Z").toISOString();
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async () => [
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
        ],
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
  expect(results.results[0]?.displayBadge).toBe("3 new");
});

test("loadCalendarResults projects already-loaded released rows without another schedule fetch", async () => {
  const writes: unknown[] = [];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async () => [
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
        ],
      },
      historyStore: {
        getAll: async () => ({
          "anilist:21": {
            title: "Frieren",
            type: "series",
            mediaKind: "anime",
            season: 1,
            episode: 28,
            timestamp: 1200,
            duration: 1400,
            completed: true,
            provider: "allmanga",
            watchedAt: "2026-05-20T00:00:00.000Z",
          },
        }),
      },
      releaseProgressCache: {
        getByTitleIds: () => new Map(),
        upsert: (projection: unknown) => writes.push(projection),
      },
    }) as never,
  );

  expect(writes).toHaveLength(1);
  expect(results.results[0]?.displayBadge).toBe("3 new");
});

test("loadCalendarResults joins AniList schedule rows to provider-native history identities", async () => {
  const writes: Array<{ titleId?: string }> = [];
  const results = await loadCalendarResults(
    withCalendarServices({
      stateManager: { getState: () => ({ mode: "anime" }) },
      timelineService: {
        loadReleasingToday: async () => [
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
        ],
      },
      historyStore: {
        getAll: async () => ({
          "allmanga:opaque": {
            title: "Frieren",
            type: "series",
            mediaKind: "anime",
            externalIds: { anilistId: "21" },
            season: 1,
            episode: 28,
            timestamp: 1200,
            duration: 1400,
            completed: true,
            provider: "allmanga",
            watchedAt: "2026-05-20T00:00:00.000Z",
          },
        }),
      },
      releaseProgressCache: {
        getByTitleIds: () => new Map(),
        upsert: (projection: { titleId?: string }) => writes.push(projection),
      },
    }) as never,
  );

  expect(writes[0]?.titleId).toBe("allmanga:opaque");
  expect(results.results[0]?.displayBadge).toBe("3 new");
});
