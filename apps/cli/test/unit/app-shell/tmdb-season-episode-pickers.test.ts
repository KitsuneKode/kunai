import { describe, expect, test } from "bun:test";

import {
  buildEpisodePickerOptions,
  buildSeasonPickerOptions,
} from "@/app-shell/pickers/tmdb-season-episode-pickers";

describe("TMDB season and episode picker artwork", () => {
  test("threads season poster paths into picker preview images", () => {
    const options = buildSeasonPickerOptions(
      [
        { number: 1, name: "Season 1", posterPath: "/s1.jpg" },
        { number: 2, name: "Season 2", posterPath: "/s2.jpg" },
      ],
      2,
    );

    expect(options).toEqual([
      { value: "1", label: "Season 1", previewImageUrl: "/s1.jpg" },
      { value: "2", label: "Season 2  ·  current", previewImageUrl: "/s2.jpg" },
    ]);
  });

  test("threads episode still paths into picker preview images", async () => {
    const options = await buildEpisodePickerOptions({
      episodes: [
        {
          number: 1,
          name: "Pilot",
          airDate: "2008-01-20",
          overview: "First episode.",
          stillPath: "/still.jpg",
        },
      ],
      season: 1,
      currentEpisode: 1,
    });

    expect(options[0]).toMatchObject({
      value: "1",
      previewImageUrl: "/still.jpg",
    });
  });
});
