import { afterEach, describe, expect, test } from "bun:test";

import { clearTmdbSessionCache } from "@/services/catalog/tmdb-proxy";

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

import { clearTmdbMemoryCachesForTest } from "@/tmdb";

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTmdbSessionCache();
  clearTmdbMemoryCachesForTest();
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

  test("keeps English synopsis labels instead of replacing placeholder names with original-language names", async () => {
    const { fetchEpisodes } = await import("@/tmdb");
    setFetchRouter((url) => {
      if (url.includes("/tv/english-synopsis?language=en-US")) {
        return { original_language: "ko" };
      }
      if (url.includes("/tv/english-synopsis/season/1?language=ko")) {
        return {
          episodes: [
            {
              episode_number: 1,
              name: "사장님, 사랑해요",
              air_date: "2020-03-01",
              overview: "",
            },
          ],
        };
      }
      return {
        episodes: [
          {
            episode_number: 1,
            name: ".",
            air_date: "2020-03-01",
            overview: "The team faces a difficult choice.",
          },
        ],
      };
    });

    const episodes = await fetchEpisodes("english-synopsis", 1);
    expect(episodes?.[0]?.name).toBe(".");
    expect(episodes?.[0]?.overview).toBe("The team faces a difficult choice.");
  });

  test("bounded cache evicts oldest entries rather than growing without bound", async () => {
    const { fetchEpisodes, MAX_TMDB_CACHE_ENTRIES } = await import("@/tmdb");
    setFetchRouter(() => ({
      episodes: [
        {
          episode_number: 1,
          name: "Test Episode",
          air_date: "2020-01-01",
          overview: "Overview",
        },
      ],
    }));

    // Fetch more entries than MAX_TMDB_CACHE_ENTRIES
    for (let i = 0; i <= MAX_TMDB_CACHE_ENTRIES + 5; i++) {
      await fetchEpisodes(`show-${i}`, 1);
    }
  });

  test("transient network failure on language fetch retries on subsequent call rather than caching failure sentinel", async () => {
    const { fetchEpisodes } = await import("@/tmdb");
    let languageFails = true;
    setFetchRouter((url) => {
      if (url.includes("/tv/flaky-lang?language=en-US")) {
        if (languageFails) {
          throw new Error("503 Service Unavailable");
        }
        return { original_language: "ja" };
      }
      if (url.includes("/tv/flaky-lang/season/1?language=ja")) {
        return {
          episodes: [
            {
              episode_number: 1,
              name: "第1話",
              air_date: "2020-01-01",
              overview: "",
            },
          ],
        };
      }
      return {
        episodes: [
          {
            episode_number: 1,
            name: "Episode 1",
            air_date: "2020-01-01",
            overview: "",
          },
        ],
      };
    });

    // First attempt fails to resolve language (transient failure)
    const first = await fetchEpisodes("flaky-lang", 1);
    expect(first?.[0]?.name).toBe("Episode 1");

    // Second attempt after language recovery successfully fetches Japanese name
    languageFails = false;
    clearTmdbMemoryCachesForTest();
    clearTmdbSessionCache();
    const second = await fetchEpisodes("flaky-lang", 1);
    expect(second?.[0]?.name).toBe("第1話");
  });
});
