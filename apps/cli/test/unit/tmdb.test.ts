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

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTmdbSessionCache();
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
});

describe("TMDB session caches are bounded", () => {
  /**
   * `epCache`/`seasonCache`/`showLanguageCache` were plain Maps — one entry per
   * series browsed, kept forever. Now LRU-bounded at 500: filling past the
   * ceiling evicts the oldest write, so re-reading it pays a fresh fetch while
   * the newest entry still answers from memory.
   */
  test("an evicted episode entry refetches; a still-cached one does not", async () => {
    const { fetchEpisodes } = await import("@/tmdb");
    let fetches = 0;
    setFetchRouter(() => {
      fetches += 1;
      // A complete episode row (real name + synopsis) keeps this to one fetch
      // per key — no original-language enrichment pass.
      return {
        episodes: [
          { episode_number: 1, name: "Aired", air_date: "2020-01-01", overview: "Synopsis." },
        ],
      };
    });

    // 501 distinct series — one past the ceiling.
    for (let i = 0; i <= 500; i++) {
      await fetchEpisodes(`bound-series-${i}`, 1);
    }
    const afterFill = fetches;

    // The newest key still answers without a fetch.
    await fetchEpisodes("bound-series-500", 1);
    expect(fetches).toBe(afterFill);

    // The oldest key was evicted — it must go back to the network.
    await fetchEpisodes("bound-series-0", 1);
    expect(fetches).toBeGreaterThan(afterFill);
  });
});
