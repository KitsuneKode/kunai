import { describe, expect, test } from "bun:test";

import {
  applyPlaybackEpisodeNavigation,
  buildEpisodeNavigationTransitionContext,
  type PlaybackEpisodeNavigationEffects,
} from "@/app/playback/playback-episode-navigation";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import type { EpisodeInfo } from "@/domain/types";

const episode: EpisodeInfo = { season: 1, episode: 12 };

function createEffects() {
  const calls: string[] = [];
  const effects: PlaybackEpisodeNavigationEffects = {
    cancelPrefetch: (reason) => {
      calls.push(`cancel:${reason}`);
    },
    showLoadingOverlay: async (target) => {
      calls.push(`overlay:${target.season}:${target.episode}`);
    },
    startNavigationToEpisode: async (target) => {
      calls.push(`start:${target.season}:${target.episode}`);
      return { startAt: 0, resumePromptAt: 44, suppressResumePrompt: false };
    },
    selectEpisode: (target) => {
      calls.push(`select:${target.season}:${target.episode}`);
    },
    setStopAfterCurrent: (enabled) => {
      calls.push(`stop-after:${enabled}`);
    },
    setAutoplayPaused: (paused) => {
      calls.push(`autoplay-paused:${paused}`);
    },
  };
  return { calls, effects };
}

describe("playback episode navigation", () => {
  test("preserves before-start overlay ordering for next navigation", async () => {
    const { calls, effects } = createEffects();

    const result = await applyPlaybackEpisodeNavigation({
      episode,
      session: createPlaybackSessionState({ autoNextEnabled: true }),
      loadingOrder: "before-start",
      resetStopAfterCurrent: true,
      resumeInterruptedAutoplay: true,
      effects,
    });

    expect(result.startIntent.resumePromptAt).toBe(44);
    expect(calls).toEqual(["overlay:1:12", "start:1:12", "select:1:12", "stop-after:false"]);
  });

  test("cancels prefetch and preserves after-start overlay ordering for picker navigation", async () => {
    const { calls, effects } = createEffects();

    await applyPlaybackEpisodeNavigation({
      episode,
      session: createPlaybackSessionState({ autoNextEnabled: true }),
      cancelPrefetchReason: "user-navigation",
      loadingOrder: "after-start",
      resetStopAfterCurrent: true,
      effects,
    });

    expect(calls).toEqual([
      "cancel:user-navigation",
      "start:1:12",
      "overlay:1:12",
      "select:1:12",
      "stop-after:false",
    ]);
  });

  test("explicit navigation resumes autoplay only when interruption caused the pause", async () => {
    const { calls, effects } = createEffects();
    const session = {
      ...createPlaybackSessionState({ autoNextEnabled: true }),
      autoplayPaused: true,
      autoplayPauseReason: "interrupted" as const,
      stopAfterCurrent: true,
    };

    const result = await applyPlaybackEpisodeNavigation({
      episode,
      session,
      resetStopAfterCurrent: true,
      resumeInterruptedAutoplay: true,
      effects,
    });

    expect(result.session.autoplayPaused).toBe(false);
    expect(result.session.autoplayPauseReason).toBeNull();
    expect(result.session.stopAfterCurrent).toBe(false);
    expect(calls).toContain("autoplay-paused:false");
  });

  test("builds stable transition metadata for post-play routes", () => {
    expect(
      buildEpisodeNavigationTransitionContext({
        titleId: "1396",
        episode,
        source: "previous",
      }),
    ).toEqual({ titleId: "1396", season: 1, episode: 12, source: "previous" });
  });
});
