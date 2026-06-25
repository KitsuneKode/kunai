import { describe, expect, test } from "bun:test";

import { shouldOfferAutoAdvance } from "@/app/playback/playback-advance";
import {
  canAutoContinueIntoRecommendation,
  isNearEndVoluntaryQuit,
} from "@/app/playback/playback-postplay-policy";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import {
  explainAutoplayBlockReason,
  resolveAutoplayAdvanceEpisode,
} from "@/app/playback/policies/playback-result-policy";
import {
  planEpisodeIterationDirective,
  type ProviderResolveFailurePlanInput,
} from "@/app/playback/run-playback-episode-iteration";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";

const title: TitleInfo = { id: "1396", name: "Test Show", type: "series" };
const currentEpisode: EpisodeInfo = { season: 1, episode: 5 };

const availability: EpisodeAvailability = {
  nextEpisode: { season: 1, episode: 6 },
  previousEpisode: { season: 1, episode: 4 },
  nextSeasonEpisode: null,
  upcomingNext: null,
  animeNextReleaseUnknown: false,
  tmdbUnavailable: false,
};

const eofResult: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 1400,
  duration: 1400,
  lastNonZeroPositionSeconds: 1400,
  lastNonZeroDurationSeconds: 1400,
  playerExitCode: 0,
  playerExitSignal: null,
};

function autoAdvanceArgs(overrides: {
  session?: ReturnType<typeof createPlaybackSessionState>;
  result?: PlaybackResult;
}) {
  return {
    result: overrides.result ?? eofResult,
    title,
    currentEpisode,
    session: overrides.session ?? createPlaybackSessionState({ autoNextEnabled: true }),
    availability,
    timing: null,
    endPolicy: {
      quitNearEndBehavior: "continue" as const,
      quitNearEndThresholdMode: "credits-or-90-percent" as const,
    },
  };
}

describe("outer loop autoplay predicates", () => {
  test("shouldOfferAutoAdvance: live guards block when autoplay session paused", () => {
    expect(
      shouldOfferAutoAdvance({
        endReason: "eof",
        autoplayPaused: false,
        autoplaySessionPaused: true,
        signalAborted: false,
      }),
    ).toBe(false);
  });

  test("resolveAutoplayAdvanceEpisode: stopAfterCurrent blocks catalog auto-next", async () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    const blockedSession = { ...session, stopAfterCurrent: true };

    await expect(
      resolveAutoplayAdvanceEpisode(autoAdvanceArgs({ session: blockedSession })),
    ).resolves.toBeNull();
    expect(explainAutoplayBlockReason(autoAdvanceArgs({ session: blockedSession }))).toBe(
      "stop-after-current",
    );
  });

  test("isNearEndVoluntaryQuit: stopAfterCurrent snapshot blocks near-end auto-next", () => {
    const liveCleared = false;
    const snapshotStillSet = true;
    expect(
      isNearEndVoluntaryQuit({
        endReason: "quit",
        quitNearEndBehavior: "continue",
        sessionMode: "autoplay-chain",
        autoplayPaused: false,
        stopAfterCurrent: liveCleared,
        hasNextEpisode: true,
        endedNearNaturalEnd: true,
      }),
    ).toBe(true);
    expect(
      isNearEndVoluntaryQuit({
        endReason: "quit",
        quitNearEndBehavior: "continue",
        sessionMode: "autoplay-chain",
        autoplayPaused: false,
        stopAfterCurrent: snapshotStillSet,
        hasNextEpisode: true,
        endedNearNaturalEnd: true,
      }),
    ).toBe(false);
  });

  test("canAutoContinueIntoRecommendation: series-end eof with recommendations enabled", () => {
    expect(
      canAutoContinueIntoRecommendation({
        sessionMode: "autoplay-chain",
        hasNextEpisode: false,
        endReason: "eof",
        autoplayPaused: false,
        autoplaySessionPaused: false,
        aborted: false,
        hasQueuedNext: false,
        autoplayRecommendationsEnabled: true,
      }),
    ).toBe(true);
    expect(
      canAutoContinueIntoRecommendation({
        sessionMode: "autoplay-chain",
        hasNextEpisode: false,
        endReason: "eof",
        autoplayPaused: true,
        autoplaySessionPaused: false,
        aborted: false,
        hasQueuedNext: false,
        autoplayRecommendationsEnabled: true,
      }),
    ).toBe(false);
  });
});

describe("planEpisodeIterationDirective (resolve failure)", () => {
  const base: ProviderResolveFailurePlanInput = {
    streamResolved: false,
    resolveAborted: false,
    sessionAborted: false,
    streamSwitchSelection: null,
    resolveAbortIntent: null,
    hasCompatibleFallbackProvider: false,
    problemAction: null,
  };

  test("resolved stream continues the outer loop", () => {
    expect(planEpisodeIterationDirective({ ...base, streamResolved: true })).toEqual({
      kind: "continue",
    });
  });

  test("user-aborted resolve with stream pick restarts", () => {
    expect(
      planEpisodeIterationDirective({
        ...base,
        resolveAborted: true,
        streamSwitchSelection: { sourceId: "s1", streamId: "st1" },
      }),
    ).toEqual({ kind: "restart", reason: "stream-switch-during-resolve" });
  });

  test("fallback skip restarts when a compatible provider exists", () => {
    expect(
      planEpisodeIterationDirective({
        ...base,
        resolveAborted: true,
        resolveAbortIntent: "fallback",
        hasCompatibleFallbackProvider: true,
      }),
    ).toEqual({ kind: "restart", reason: "provider-fallback-skip" });
  });

  test("user-aborted resolve without fallback exits to results", () => {
    expect(
      planEpisodeIterationDirective({
        ...base,
        resolveAborted: true,
        resolveAbortIntent: "cancel",
      }),
    ).toEqual({ kind: "exit", result: "back_to_results" });
  });

  test("resolve failure retry restarts; dismiss exits", () => {
    expect(
      planEpisodeIterationDirective({
        ...base,
        problemAction: "retry",
      }),
    ).toEqual({ kind: "restart", reason: "resolve-retry" });
    expect(
      planEpisodeIterationDirective({
        ...base,
        problemAction: "dismiss",
      }),
    ).toEqual({ kind: "exit", result: "back_to_results" });
  });
});
