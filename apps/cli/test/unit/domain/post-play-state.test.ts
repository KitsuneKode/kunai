import { describe, expect, test } from "bun:test";

import { resolvePostPlayState } from "@/domain/playback/post-play-state";

describe("resolvePostPlayState", () => {
  test("mid-series: more episodes in season → state is 'mid-series'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: true,
      isSeasonFinale: false,
      isSeriesComplete: false,
      isCaughtUpOnAiring: false,
    });
    expect(state.kind).toBe("mid-series");
  });

  test("caught-up: current on airing show, no next episode yet → 'caught-up'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: false,
      isSeriesComplete: false,
      isCaughtUpOnAiring: true,
      nextAirDate: "2026-05-30",
    });
    expect(state.kind).toBe("caught-up");
    if (state.kind === "caught-up") {
      expect(state.nextAirDate).toBe("2026-05-30");
    }
  });

  test("season-finale: last ep of season, next season available → 'season-finale'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: true,
      isSeriesComplete: false,
      isCaughtUpOnAiring: false,
      hasNextSeason: true,
    });
    expect(state.kind).toBe("season-finale");
  });

  test("series-complete: last ep of last season → 'series-complete'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: true,
      isSeriesComplete: true,
      isCaughtUpOnAiring: false,
    });
    expect(state.kind).toBe("series-complete");
  });

  test("did-not-start: playback never started overrides completion (no false 'finished')", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: false,
      isSeriesComplete: true, // a movie would set this
      isCaughtUpOnAiring: false,
      playbackStarted: false,
    });
    expect(state.kind).toBe("did-not-start");
  });

  test("playbackStarted defaults to started: completion semantics preserved when omitted", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: false,
      isSeriesComplete: true,
      isCaughtUpOnAiring: false,
    });
    expect(state.kind).toBe("series-complete");
  });
});
