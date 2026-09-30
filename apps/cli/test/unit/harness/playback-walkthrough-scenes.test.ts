import { describe, expect, test } from "bun:test";

import {
  RESOLVE_DURATION_MS,
  browseQueryFor,
  browseResultsFor,
  clampPostPlayActionIndex,
  episodeRowsFor,
  laneAfterShellAction,
  playingPositionSeconds,
  playingState,
  postPlayProps,
  providerFor,
  resolveStageAt,
  resolvingState,
  searchResultsFor,
  selectedEpisodeIndex,
} from "../../harness/playback-walkthrough-scenes";

describe("playback walkthrough scenes", () => {
  test("series and anime lanes keep distinct catalog identity", () => {
    expect(browseQueryFor("series")).toBe("Andor");
    expect(browseQueryFor("anime")).toBe("Frieren");
    expect(providerFor("series")).toBe("videasy");
    expect(providerFor("anime")).toBe("allmanga");
    expect(browseResultsFor("series")[0]?.label).toContain("Andor");
    expect(browseResultsFor("anime")[0]?.label).toContain("Frieren");
  });

  test("typed search ranks the matching title first and keeps the rest of the lane", () => {
    const series = searchResultsFor("series", "Andor");
    expect(series[0]?.label).toContain("Andor");
    expect(series.map((row) => row.label).join(" ")).toContain("Mandalorian");
    expect(series).toHaveLength(3);

    const anime = searchResultsFor("anime", "Frieren");
    expect(anime[0]?.label).toContain("Frieren");
    expect(anime).toHaveLength(3);
  });

  test("episode picker starts above the tape target so arrows are visible", () => {
    expect(selectedEpisodeIndex("series")).toBe(2);
    expect(episodeRowsFor("series")[0]?.label).toContain("Kassa");
    expect(episodeRowsFor("series")[2]?.label).toContain("Reckoning");
    expect(selectedEpisodeIndex("anime")).toBe(3);
    expect(episodeRowsFor("anime")[0]?.label).toContain("Journey");
    expect(episodeRowsFor("anime")[3]?.label).toContain("Sword Village");
  });

  test("resolve stages walk the four bootstrap steps", () => {
    expect(resolveStageAt(0, RESOLVE_DURATION_MS)).toBe("finding-stream");
    expect(resolveStageAt(800, RESOLVE_DURATION_MS)).toBe("preparing-provider");
    expect(resolveStageAt(1600, RESOLVE_DURATION_MS)).toBe("preparing-player");
    expect(resolveStageAt(2400, RESOLVE_DURATION_MS)).toBe("starting-playback");
    expect(resolvingState("series", 0).operation).toBe("resolving");
    expect(resolvingState("anime", 2000).providerId).toBe("allmanga");
  });

  test("playing progress advances at 1x and post-play is reversible", () => {
    const start = playingPositionSeconds("series", 0);
    const later = playingPositionSeconds("series", 2000);
    expect(later - start).toBeCloseTo(2, 5);

    const playing = playingState("anime", 1000);
    expect(playing.operation).toBe("playing");
    expect(playing.currentPosition).toBe(playingPositionSeconds("anime", 1000));

    const postPlay = postPlayProps("series");
    expect(postPlay.postPlayState.kind).toBe("mid-series");
    expect(postPlay.nextEpisodeLabel).toContain("Aldhani");
    expect(postPlayProps("anime").contentKind).toBe("anime");
    expect(clampPostPlayActionIndex(-1)).toBe(0);
    expect(clampPostPlayActionIndex(9)).toBe(4);
  });

  test("palette lane switches wrap series and anime without dropping into youtube", () => {
    expect(laneAfterShellAction("series", "anime-mode")).toBe("anime");
    expect(laneAfterShellAction("anime", "series-mode")).toBe("series");
    expect(laneAfterShellAction("series", "toggle-mode")).toBe("anime");
    expect(laneAfterShellAction("anime", "toggle-mode")).toBe("series");
    expect(laneAfterShellAction("series", "search")).toBeNull();
  });
});
