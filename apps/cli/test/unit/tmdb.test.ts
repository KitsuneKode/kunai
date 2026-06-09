import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

type FetchFixture = (input: string | URL | Request) => Promise<Response>;

function setFetchRouter(router: (url: string) => unknown): void {
  const fetchFixture: FetchFixture = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify(router(url)), { status: 200 });
  };
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
    setFetchRouter(() => ({
      episodes: [
        {
          episode_number: 1,
          name: "Pilot",
          air_date: "2008-01-20",
          overview: "First episode.",
          still_path: "/episode-still.jpg",
        },
      ],
    }));

    const episodes = await fetchEpisodes("artwork-series-episodes", 1);

    expect(episodes?.[0]?.stillPath).toBe("/episode-still.jpg");
  });

  test("captures season poster paths while preserving fetchSeasons number output", async () => {
    const { fetchSeasonSummaries, fetchSeasons } = await import("@/tmdb");
    setFetchRouter(() => ({
      seasons: [
        { season_number: 0, episode_count: 2, name: "Specials", poster_path: "/specials.jpg" },
        {
          season_number: 2,
          episode_count: 8,
          name: "Season 2",
          poster_path: "/s2.jpg",
          air_date: "2099-01-01",
        },
        {
          season_number: 1,
          episode_count: 10,
          name: "Season 1",
          poster_path: "/s1.jpg",
          air_date: "2008-01-01",
        },
      ],
    }));

    const summaries = await fetchSeasonSummaries("artwork-series-seasons");
    const seasons = await fetchSeasons("artwork-series-seasons");

    expect(summaries?.map((season) => [season.number, season.posterPath])).toEqual([
      [1, "/s1.jpg"],
    ]);
    expect(seasons).toEqual([1]);
  });

  test("hides unreleased episodes from fetchEpisodes", async () => {
    const { fetchEpisodes } = await import("@/tmdb");
    setFetchRouter(() => ({
      episodes: [
        { episode_number: 1, name: "Aired", air_date: "2026-01-01", overview: "" },
        { episode_number: 2, name: "Future", air_date: "2099-01-01", overview: "" },
      ],
    }));

    const episodes = await fetchEpisodes("mixed-season", 1);
    expect(episodes?.map((episode) => episode.number)).toEqual([1]);
  });
});
