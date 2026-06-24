import { describe, expect, test } from "bun:test";

import { evaluateAutoAdvanceNextUp } from "@/app/playback/playback-advance";
import { playbackStartupStageForPlayerEvent } from "@/app/playback/PlaybackPhase";

describe("PlaybackPhase characterization", () => {
  test("playbackStartupStageForPlayerEvent maps player-ready to startup stage", () => {
    expect(
      playbackStartupStageForPlayerEvent({
        type: "player-ready",
      }),
    ).toBe("player-ready");
  });

  test("evaluateAutoAdvanceNextUp advances to the next episode when guards allow", () => {
    const result = evaluateAutoAdvanceNextUp({
      guards: {
        endReason: "eof",
        autoplayPaused: false,
        autoplaySessionPaused: false,
        signalAborted: false,
      },
      nextEpisode: { season: 1, episode: 2 },
      queueHead: undefined,
      topRecommendation: null,
      seriesDone: false,
      autoplayRecommendations: true,
    });

    expect(result).toEqual({
      kind: "episode",
      episode: { season: 1, episode: 2 },
    });
  });
});
