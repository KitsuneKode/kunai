import { describe, expect, test } from "bun:test";

import { episodeIdentityForHistory } from "@/app/playback/playback-history-identity";

describe("episodeIdentityForHistory", () => {
  test("movies have title-level history", () => {
    expect(
      episodeIdentityForHistory({ type: "movie" }, { season: 1, episode: 1, absoluteEpisode: 1 }),
    ).toBeUndefined();
  });

  test("series preserve season and episode", () => {
    expect(episodeIdentityForHistory({ type: "series" }, { season: 2, episode: 4 })).toEqual({
      season: 2,
      episode: 4,
    });
  });

  test("anime-style series preserve absolute episode identity", () => {
    expect(
      episodeIdentityForHistory({ type: "series" }, { season: 1, episode: 3, absoluteEpisode: 27 }),
    ).toEqual({ season: 1, episode: 3, absoluteEpisode: 27 });
  });
});
