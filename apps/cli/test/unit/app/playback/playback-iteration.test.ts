import { describe, expect, test } from "bun:test";

import { createPlaybackIteration, type PlaybackIteration } from "@/app/playback/playback-iteration";
import { createPlaybackRunState } from "@/app/playback/playback-run-state";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import { startFromBeginning } from "@/app/playback/playback-start-intent";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";

const title: TitleInfo = { id: "1396", name: "Test Show", type: "series" };
const currentEpisode: EpisodeInfo = { season: 1, episode: 5 };
const nextEpisode: EpisodeInfo = { season: 1, episode: 6 };

const availability: EpisodeAvailability = {
  nextEpisode,
  previousEpisode: { season: 1, episode: 4 },
  nextSeasonEpisode: null,
  upcomingNext: null,
  animeNextReleaseUnknown: false,
  tmdbUnavailable: false,
};

const baseResult: PlaybackResult = {
  endReason: "quit",
  watchedSeconds: 1200,
  duration: 1400,
  lastNonZeroPositionSeconds: 1200,
  lastNonZeroDurationSeconds: 1400,
  playerExitCode: 0,
  playerExitSignal: null,
};

function createIteration(overrides: Partial<PlaybackIteration> = {}): PlaybackIteration {
  return createPlaybackIteration({
    title,
    currentEpisode,
    episodeAvailability: availability,
    result: baseResult,
    effectiveTimingCurrent: null,
    nextEpisode: null,
    catalogAutoplayEndBanner: undefined,
    shellEpisodePicker: { options: [], subtitle: "", initialIndex: 0 },
    watchedEntries: [],
    prefetchedRecommendationItems: null,
    currentAnimeEpisodes: undefined,
    preparedStream: { url: "https://example.com/stream" } as StreamInfo,
    resolvedProviderId: "allanime",
    openRecoverySourcePanelOnPostPlay: false,
    stopAfterCurrentAtMenuEntry: false,
    ...overrides,
  });
}

describe("playback iteration", () => {
  test("snapshots stopAfterCurrentAtMenuEntry independently of later session clears", () => {
    const iteration = createIteration({ stopAfterCurrentAtMenuEntry: true });
    expect(iteration.stopAfterCurrentAtMenuEntry).toBe(true);
    expect(iteration.nearEndAutoNextDeclined).toBe(false);
    expect(iteration.postPlayProviderId).toBe("allanime");
  });

  test("initializes nearEndAutoNextDeclined false and postPlayProviderId from resolved provider", () => {
    const iteration = createIteration({ resolvedProviderId: "videasy" });
    expect(iteration.nearEndAutoNextDeclined).toBe(false);
    expect(iteration.postPlayProviderId).toBe("videasy");
  });
});

describe("playback run state with iteration", () => {
  test("run state pairs with iteration for post-play menu entry", () => {
    const run = createPlaybackRunState({
      playbackSession: createPlaybackSessionState({ autoNextEnabled: true }),
      pendingStart: startFromBeginning(),
    });
    const iteration = createIteration({
      stopAfterCurrentAtMenuEntry: true,
      openRecoverySourcePanelOnPostPlay: true,
    });
    expect(run.playbackSession.mode).toBe("autoplay-chain");
    expect(iteration.openRecoverySourcePanelOnPostPlay).toBe(true);
  });
});
