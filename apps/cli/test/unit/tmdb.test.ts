import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

function setFetchJson(payload: unknown): void {
  const fetchFixture = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
    });
  globalThis.fetch = Object.assign(fetchFixture, {
    preconnect: originalFetch.preconnect,
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TMDB series artwork", () => {
  test("captures episode still paths from season payloads", async () => {
    const { fetchEpisodes } = await import("@/tmdb");
    setFetchJson({
      episodes: [
        {
          episode_number: 1,
          name: "Pilot",
          air_date: "2008-01-20",
          overview: "First episode.",
          still_path: "/episode-still.jpg",
        },
      ],
    });

    const episodes = await fetchEpisodes("artwork-series-episodes", 1);

    expect(episodes?.[0]?.stillPath).toBe("/episode-still.jpg");
  });

  test("captures season poster paths while preserving fetchSeasons number output", async () => {
    const { fetchSeasonSummaries, fetchSeasons } = await import("@/tmdb");
    setFetchJson({
      seasons: [
        { season_number: 0, episode_count: 2, name: "Specials", poster_path: "/specials.jpg" },
        { season_number: 2, episode_count: 8, name: "Season 2", poster_path: "/s2.jpg" },
        { season_number: 1, episode_count: 10, name: "Season 1", poster_path: "/s1.jpg" },
      ],
    });

    const summaries = await fetchSeasonSummaries("artwork-series-seasons");
    const seasons = await fetchSeasons("artwork-series-seasons");

    expect(summaries?.map((season) => [season.number, season.posterPath])).toEqual([
      [1, "/s1.jpg"],
      [2, "/s2.jpg"],
    ]);
    expect(seasons).toEqual([1, 2]);
  });
});
