import { describe, expect, test } from "bun:test";

import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";

import { getAutoAdvanceEpisode } from "@/app/playback-policy";

const SERIES_TITLE: TitleInfo = {
  id: "demo-series",
  type: "series",
  name: "Demo Series",
};

const MOVIE_TITLE: TitleInfo = {
  id: "demo-movie",
  type: "movie",
  name: "Demo Movie",
};

const CURRENT_EPISODE: EpisodeInfo = {
  season: 1,
  episode: 7,
};

const EOF_RESULT: PlaybackResult = {
  watchedSeconds: 1440,
  duration: 1440,
  endReason: "eof",
};

describe("getAutoAdvanceEpisode", () => {
  test("advances to the next episode when auto-next is enabled and playback ends at eof", () => {
    expect(getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, CURRENT_EPISODE, true)).toEqual({
      season: 1,
      episode: 8,
    });
  });

  test("does not auto-advance when the title is a movie", () => {
    expect(getAutoAdvanceEpisode(EOF_RESULT, MOVIE_TITLE, CURRENT_EPISODE, true)).toBeNull();
  });

  test("does not auto-advance when playback does not end at eof", () => {
    expect(
      getAutoAdvanceEpisode(
        {
          ...EOF_RESULT,
          endReason: "quit",
        },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
      ),
    ).toBeNull();
  });

  test("does not auto-advance when the setting is disabled", () => {
    expect(getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, CURRENT_EPISODE, false)).toBeNull();
  });
});
