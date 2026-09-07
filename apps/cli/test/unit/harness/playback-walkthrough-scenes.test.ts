import { describe, expect, test } from "bun:test";

import {
  PLAYBACK_WALKTHROUGH_RATE,
  PLAYBACK_WALKTHROUGH_SCENES,
  browseQueryFor,
  browseResultsFor,
  playingPositionSeconds,
  playingState,
  postPlayProps,
  providerFor,
  resolveStageAt,
  resolvingState,
  titleCardCopy,
  walkthroughAt,
  walkthroughTotalDurationMs,
} from "../../harness/playback-walkthrough-scenes";

describe("playback walkthrough scenes", () => {
  test("covers series then anime with a way into and out of playback", () => {
    const phasesByLane = {
      series: PLAYBACK_WALKTHROUGH_SCENES.filter((scene) => scene.lane === "series").map(
        (scene) => scene.phase,
      ),
      anime: PLAYBACK_WALKTHROUGH_SCENES.filter((scene) => scene.lane === "anime").map(
        (scene) => scene.phase,
      ),
    };

    expect(phasesByLane.series).toEqual([
      "title",
      "browse",
      "episodes",
      "resolving",
      "playing",
      "post-play",
    ]);
    expect(phasesByLane.anime.slice(0, 6)).toEqual([
      "title",
      "browse",
      "episodes",
      "resolving",
      "playing",
      "post-play",
    ]);
    expect(phasesByLane.anime.at(-1)).toBe("done");
  });

  test("clock lands on the named scene and reports scene-local elapsed time", () => {
    const seriesBrowse = walkthroughAt(1400);
    expect(seriesBrowse?.scene.id).toBe("series-browse");
    expect(seriesBrowse?.sceneElapsedMs).toBe(0);

    const beforeEnd = walkthroughTotalDurationMs() - 1;
    expect(walkthroughAt(beforeEnd)?.scene.phase).toBe("done");
    expect(walkthroughAt(walkthroughTotalDurationMs())).toBeNull();
  });

  test("series and anime lanes keep distinct catalog identity", () => {
    expect(browseQueryFor("series")).toBe("Andor");
    expect(browseQueryFor("anime")).toBe("Frieren");
    expect(providerFor("series")).toBe("videasy");
    expect(providerFor("anime")).toBe("allmanga");
    expect(browseResultsFor("series")[0]?.label).toContain("Andor");
    expect(browseResultsFor("anime")[0]?.label).toContain("Frieren");
    expect(titleCardCopy("series").title).toBe("Series playback");
    expect(titleCardCopy("anime").title).toBe("Anime playback");
  });

  test("resolve stages walk the four bootstrap steps", () => {
    expect(resolveStageAt(0, 2800)).toBe("finding-stream");
    expect(resolveStageAt(700, 2800)).toBe("preparing-provider");
    expect(resolveStageAt(1400, 2800)).toBe("preparing-player");
    expect(resolveStageAt(2100, 2800)).toBe("starting-playback");
    expect(resolvingState("series", 0).operation).toBe("resolving");
    expect(resolvingState("anime", 2000).providerId).toBe("allmanga");
  });

  test("playing progress advances at 1.5x and post-play is reversible", () => {
    expect(PLAYBACK_WALKTHROUGH_RATE).toBe(1.5);
    const start = playingPositionSeconds("series", 0);
    const later = playingPositionSeconds("series", 2000);
    expect(later - start).toBeCloseTo(3, 5);

    const playing = playingState("anime", 1000);
    expect(playing.operation).toBe("playing");
    expect(playing.currentPosition).toBe(playingPositionSeconds("anime", 1000));

    const postPlay = postPlayProps("series");
    expect(postPlay.postPlayState.kind).toBe("mid-series");
    expect(postPlay.nextEpisodeLabel).toContain("Aldhani");
    expect(postPlayProps("anime").contentKind).toBe("anime");
  });
});
