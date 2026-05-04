import { describe, expect, test } from "bun:test";

import type { EpisodeAvailability } from "@/app/playback-policy";
import {
  createPlaybackSessionState,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  resolvePlaybackResultDecision,
  resolvePostPlaybackSessionAction,
  syncPlaybackSessionState,
} from "@/app/playback-session-controller";
import type { PlaybackResult, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

const seriesTitle: TitleInfo = {
  id: "1396",
  type: "series",
  name: "Breaking Bad",
};

const nextSeasonAvailability: EpisodeAvailability = {
  previousEpisode: { season: 2, episode: 4 },
  nextEpisode: { season: 3, episode: 1 },
  nextSeasonEpisode: { season: 3, episode: 1 },
  upcomingNext: null,
  animeNextReleaseUnknown: false,
};

const baseResult: PlaybackResult = {
  watchedSeconds: 1200,
  duration: 1210,
  endReason: "eof",
};

const creditsTiming: PlaybackTimingMetadata = {
  tmdbId: "1396",
  type: "series",
  intro: [],
  recap: [],
  credits: [{ startMs: 1_200_000, endMs: null }],
  preview: [],
};

describe("resolvePlaybackResultDecision", () => {
  test("marks manual stop as interrupted autoplay pause unless the user already paused it", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      resolvePlaybackResultDecision({
        result: { ...baseResult, endReason: "quit" },
        controlAction: "stop",
        session,
      }),
    ).toMatchObject({
      session: {
        mode: "autoplay-chain",
        autoplayPauseReason: "interrupted",
        autoplayPaused: true,
        stopAfterCurrent: false,
      },
      shouldRefreshSource: false,
      shouldFallbackProvider: false,
      shouldTreatAsInterrupted: true,
    });

    expect(
      resolvePlaybackResultDecision({
        result: { ...baseResult, endReason: "quit" },
        controlAction: "stop",
        session: {
          ...session,
          autoplayPauseReason: "user",
          autoplayPaused: true,
        },
      }).session.autoplayPauseReason,
    ).toBe("user");
  });

  test("keeps refresh and fallback decisions explicit without forcing interruption", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      resolvePlaybackResultDecision({
        result: baseResult,
        controlAction: "refresh",
        session,
      }),
    ).toMatchObject({
      session: {
        autoplayPauseReason: null,
        autoplayPaused: false,
      },
      shouldRefreshSource: true,
      shouldFallbackProvider: false,
      shouldTreatAsInterrupted: false,
    });

    expect(
      resolvePlaybackResultDecision({
        result: baseResult,
        controlAction: "fallback",
        session,
      }),
    ).toMatchObject({
      session: {
        autoplayPauseReason: null,
        autoplayPaused: false,
      },
      shouldRefreshSource: false,
      shouldFallbackProvider: true,
      shouldTreatAsInterrupted: false,
    });
  });

  test("does not treat a near-end quit as an interruption by default", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      resolvePlaybackResultDecision({
        result: {
          watchedSeconds: 1205,
          duration: 1210,
          endReason: "quit",
        },
        controlAction: "stop",
        session,
      }),
    ).toMatchObject({
      session: {
        autoplayPauseReason: null,
        autoplayPaused: false,
      },
      shouldTreatAsInterrupted: false,
    });
  });

  test("treats a quit after credits timing as complete instead of interrupted", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      resolvePlaybackResultDecision({
        result: {
          watchedSeconds: 1201,
          duration: 1500,
          endReason: "quit",
        },
        controlAction: "stop",
        session,
        timing: creditsTiming,
      }),
    ).toMatchObject({
      session: {
        autoplayPauseReason: null,
        autoplayPaused: false,
      },
      shouldTreatAsInterrupted: false,
    });
  });
});

describe("resolvePostPlaybackSessionAction", () => {
  test("toggle-autoplay flips between explicit user pause and active autoplay", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(resolvePostPlaybackSessionAction("toggle-autoplay", session)).toEqual({
      session: {
        mode: "autoplay-chain",
        autoplayPauseReason: "user",
        autoplayPaused: true,
        stopAfterCurrent: false,
      },
    });

    expect(
      resolvePostPlaybackSessionAction("toggle-autoplay", {
        ...session,
        autoplayPauseReason: "user",
        autoplayPaused: true,
      }),
    ).toEqual({
      session: {
        mode: "autoplay-chain",
        autoplayPauseReason: null,
        autoplayPaused: false,
        stopAfterCurrent: false,
      },
    });
  });

  test("resume and replay only clear interruption pauses", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      resolvePostPlaybackSessionAction("resume", {
        ...session,
        autoplayPauseReason: "interrupted",
        autoplayPaused: true,
      }),
    ).toEqual({
      session: {
        mode: "autoplay-chain",
        autoplayPauseReason: null,
        autoplayPaused: false,
        stopAfterCurrent: false,
      },
    });

    expect(
      resolvePostPlaybackSessionAction("replay", {
        ...session,
        autoplayPauseReason: "user",
        autoplayPaused: true,
      }),
    ).toEqual({
      session: {
        mode: "autoplay-chain",
        autoplayPauseReason: "user",
        autoplayPaused: true,
        stopAfterCurrent: false,
      },
    });
  });
});

describe("resolveAutoplayAdvanceEpisode", () => {
  test("advances across seasons when autoplay is active and playback finished near EOF", async () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    await expect(
      resolveAutoplayAdvanceEpisode({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session,
        availability: nextSeasonAvailability,
      }),
    ).resolves.toEqual({ season: 3, episode: 1 });
  });

  test("does not auto-advance when autoplay is paused for the session", async () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    await expect(
      resolveAutoplayAdvanceEpisode({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session: {
          ...session,
          autoplayPauseReason: "interrupted",
          autoplayPaused: true,
        },
        availability: nextSeasonAvailability,
      }),
    ).resolves.toBeNull();
  });

  test("does not auto-advance in manual playback mode", async () => {
    await expect(
      resolveAutoplayAdvanceEpisode({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session: createPlaybackSessionState({ autoNextEnabled: false }),
        availability: nextSeasonAvailability,
      }),
    ).resolves.toBeNull();
  });
});

describe("explainAutoplayBlockReason", () => {
  test("explains a session pause blocker", () => {
    const session = createPlaybackSessionState({ autoNextEnabled: true });
    expect(
      explainAutoplayBlockReason({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session: {
          ...session,
          autoplayPauseReason: "interrupted",
          autoplayPaused: true,
        },
        availability: nextSeasonAvailability,
      }),
    ).toBe("autoplay-paused");
  });

  test("explains not-near-end blocker for non-eof quits", () => {
    expect(
      explainAutoplayBlockReason({
        result: {
          watchedSeconds: 500,
          duration: 1200,
          endReason: "quit",
        },
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session: createPlaybackSessionState({ autoNextEnabled: true }),
        availability: nextSeasonAvailability,
      }),
    ).toBe("not-near-end");
  });

  test("explains quit-stops-autoplay when pause policy and quit near natural end", () => {
    expect(
      explainAutoplayBlockReason({
        result: {
          watchedSeconds: 1205,
          duration: 1210,
          endReason: "quit",
        },
        title: seriesTitle,
        currentEpisode: { season: 2, episode: 5 },
        session: createPlaybackSessionState({ autoNextEnabled: true }),
        availability: nextSeasonAvailability,
        endPolicy: {
          quitNearEndBehavior: "pause",
          quitNearEndThresholdMode: "credits-or-90-percent",
        },
      }),
    ).toBe("quit-stops-autoplay");
  });

  test("explains unreleased catalogue successor blocker", () => {
    expect(
      explainAutoplayBlockReason({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 1, episode: 7 },
        session: createPlaybackSessionState({ autoNextEnabled: true }),
        availability: {
          previousEpisode: null,
          nextEpisode: null,
          nextSeasonEpisode: null,
          upcomingNext: { season: 1, episode: 8, airDate: "3099-01-01", name: "Soon" },
          animeNextReleaseUnknown: false,
        },
      }),
    ).toBe("next-episode-not-released-yet");
  });

  test("explains anime uncertain-next blocker", () => {
    expect(
      explainAutoplayBlockReason({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 1, episode: 11 },
        session: createPlaybackSessionState({ autoNextEnabled: true }),
        availability: {
          previousEpisode: null,
          nextEpisode: null,
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: true,
        },
      }),
    ).toBe("anime-next-uncertain");
  });

  test("falls back to no-next when the catalogue reports a true tail", () => {
    expect(
      explainAutoplayBlockReason({
        result: baseResult,
        title: seriesTitle,
        currentEpisode: { season: 1, episode: 8 },
        session: createPlaybackSessionState({ autoNextEnabled: true }),
        availability: {
          previousEpisode: null,
          nextEpisode: null,
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: false,
        },
      }),
    ).toBe("no-next-episode");
  });
});

describe("explainAutoplayNoNextEpisodeCatalogHint", () => {
  const caughtUpAvailability: EpisodeAvailability = {
    previousEpisode: { season: 1, episode: 2 },
    nextEpisode: null,
    nextSeasonEpisode: null,
    upcomingNext: { season: 1, episode: 3, airDate: "2099-03-15", name: "Later" },
    animeNextReleaseUnknown: false,
  };

  test("returns a TMDB upcoming banner when autoplay is blocked only by missing next", () => {
    const args = {
      result: baseResult,
      title: seriesTitle,
      currentEpisode: { season: 1, episode: 2 },
      session: createPlaybackSessionState({ autoNextEnabled: true }),
      availability: caughtUpAvailability,
      isAnime: false,
    };
    expect(explainAutoplayBlockReason(args)).toBe("next-episode-not-released-yet");
    const hint = explainAutoplayNoNextEpisodeCatalogHint(args);
    expect(hint).toContain("S01E03");
    expect(hint).toContain("2099");
  });

  test("returns undefined when autoplay is blocked for a non-catalog reason", () => {
    const args = {
      result: baseResult,
      title: seriesTitle,
      currentEpisode: { season: 1, episode: 2 },
      session: {
        ...createPlaybackSessionState({ autoNextEnabled: true }),
        autoplayPaused: true,
        autoplayPauseReason: "user" as const,
      },
      availability: caughtUpAvailability,
      isAnime: false,
    };
    expect(explainAutoplayBlockReason(args)).toBe("autoplay-paused");
    expect(explainAutoplayNoNextEpisodeCatalogHint(args)).toBeUndefined();
  });
});

describe("syncPlaybackSessionState", () => {
  test("pulls live shell autoplay and stop-after-current state back into the playback session", () => {
    expect(
      syncPlaybackSessionState(createPlaybackSessionState({ autoNextEnabled: true }), {
        autoplaySessionPaused: true,
        stopAfterCurrent: true,
      }),
    ).toMatchObject({
      autoplayPauseReason: "user",
      autoplayPaused: true,
      stopAfterCurrent: true,
    });
  });
});
