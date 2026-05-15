import { expect, test } from "bun:test";

import { loadCalendarResults } from "@/app/calendar-results";

test("loadCalendarResults maps releasing-today items into playable browse candidates", async () => {
  let requestedDays = 0;
  const results = await loadCalendarResults({
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
            releaseAt: "2026-05-16T12:00:00.000Z",
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
            releaseAt: "2026-05-15T12:00:00.000Z",
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
          releaseAt: "2026-05-15T12:00:00.000Z",
          releasePrecision: "timestamp",
          status: "upcoming",
          posterPath: "https://img.example/frieren.jpg",
        },
      ],
    },
  } as never);

  expect(requestedDays).toBe(7);
  expect(results.subtitle).toBe("2 this week · 1 today · 0 released · anime schedule");
  expect(results.results[0]).toMatchObject({
    id: "21",
    type: "series",
    title: "Frieren",
    year: "2026",
    metadataSource: "AniList calendar · Today · airs today · timestamp",
    episodeCount: 29,
    posterPath: "https://img.example/frieren.jpg",
    rating: 9.2,
    popularity: 1000,
  });
  expect(results.results[0]?.overview).toContain("Today. Episode 29 · A new journey");
  expect(results.results[0]?.overview).toContain("airs today at");
  expect(results.results[0]?.overview).toContain("Availability is checked only when you choose");
  expect(results.results[1]?.metadataSource).toContain("Tomorrow");
  expect(results.results[1]?.metadataSource).toContain("airs tomorrow");
  expect(results.results[1]?.overview).toContain("airs tomorrow at");
});

test("loadCalendarResults distinguishes already released rows from timed upcoming rows", async () => {
  const results = await loadCalendarResults({
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
          releaseAt: "2026-05-15",
          releasePrecision: "date",
          status: "released",
          posterPath: null,
        },
      ],
    },
  } as never);

  expect(results.subtitle).toBe("0 airing today · 1 released · series schedule");
  expect(results.results[0]?.metadataSource).toBe("TMDB calendar · Today · new today · date");
  expect(results.results[0]?.overview).toContain("S05E03");
  expect(results.results[0]?.overview).toContain("available today");
});
