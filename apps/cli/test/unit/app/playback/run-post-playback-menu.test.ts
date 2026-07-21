import { describe, expect, test } from "bun:test";

import { createPlaybackIteration } from "@/app/playback/playback-iteration";
import { alignPostPlayProviderRestart } from "@/app/playback/playback-provider-align";
import { createPlaybackRunState } from "@/app/playback/playback-run-state";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import { startFromBeginning } from "@/app/playback/playback-start-intent";
import {
  runPostPlaybackMenu,
  type PostPlaybackMenuDeps,
} from "@/app/playback/run-post-playback-menu";
import type { Container } from "@/container";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";

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

function createRun() {
  return createPlaybackRunState({
    playbackSession: createPlaybackSessionState({ autoNextEnabled: true }),
    pendingStart: startFromBeginning(),
  });
}

function createBaseIteration(input?: {
  result?: PlaybackResult;
  stopAfterCurrentAtMenuEntry?: boolean;
  openRecoverySourcePanelOnPostPlay?: boolean;
  streams?: unknown[];
  episodeAvailability?: EpisodeAvailability;
}) {
  const preparedStream = {
    url: "https://example.com/stream",
    providerResolveResult: input?.streams
      ? { streams: input.streams, selectedStreamId: "s1" }
      : undefined,
  } as StreamInfo;

  return createPlaybackIteration({
    title,
    currentEpisode,
    episodeAvailability: input?.episodeAvailability ?? availability,
    result:
      input?.result ??
      ({
        endReason: "eof",
        watchedSeconds: 1400,
        duration: 1400,
        lastNonZeroPositionSeconds: 1400,
        lastNonZeroDurationSeconds: 1400,
        playerExitCode: 0,
        playerExitSignal: null,
      } satisfies PlaybackResult),
    effectiveTimingCurrent: null,
    nextEpisode: null,
    catalogAutoplayEndBanner: undefined,
    shellEpisodePicker: { options: [], subtitle: "", initialIndex: 0 },
    watchedEntries: [],
    prefetchedRecommendationItems: null,
    currentAnimeEpisodes: undefined,
    preparedStream,
    resolvedProviderId: "allanime",
    openRecoverySourcePanelOnPostPlay: input?.openRecoverySourcePanelOnPostPlay ?? false,
    stopAfterCurrentAtMenuEntry: input?.stopAfterCurrentAtMenuEntry ?? false,
  });
}

type TestDeps = PostPlaybackMenuDeps & {
  dispatchCalls: Array<{ type: string; value: unknown }>;
};

function createDeps(overrides: Partial<PostPlaybackMenuDeps> = {}): TestDeps {
  const dispatchCalls: Array<{ type: string; value: unknown }> = [];
  const base: TestDeps = {
    container: {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      config: { autoplayRecommendations: true, showWatchTimeStats: false },
      queueService: { peekNext: () => null },
      stateManager: {
        getState: () => ({
          mode: "series",
          autoplaySessionPaused: false,
          autoskipSessionPaused: false,
          provider: "allanime",
          animeLanguageProfile: { subtitle: "en" },
          seriesLanguageProfile: { subtitle: "en" },
        }),
        dispatch: () => {},
      },
    } as unknown as Container,
    signal: new AbortController().signal,
    quitNearEndBehavior: "continue",
    quitNearEndThresholdMode: "credits-or-90-percent",
    recommendationRail: {
      resolveRailItems: async () => [],
    } as unknown as PostPlaybackMenuDeps["recommendationRail"],
    historyRepository: {
      listByTitle: () => [],
    } as unknown as PostPlaybackMenuDeps["historyRepository"],
    diagnosticsService: {
      record: () => {},
    } as unknown as PostPlaybackMenuDeps["diagnosticsService"],
    getMode: () => "series",
    getAutoplaySessionPaused: () => false,
    getAutoskipSessionPaused: () => false,
    getProvider: () => "allanime",
    getAnimeSubtitlePreference: () => "en",
    getSeriesSubtitlePreference: () => "en",
    dispatchAutoplayPaused: (paused) => dispatchCalls.push({ type: "autoplay", value: paused }),
    dispatchAutoskipPaused: () => {},
    dispatchStopAfterCurrent: () => {},
    dispatchWatchTimeSummary: () => {},
    resolvePostPlaybackCommands: () => [],
    routeShellAction: async (action) => action,
    updatePlaybackFeedback: () => {},
    transitionPlaybackSession: (session) => session,
    runAutoNextCountdown: async () => "cancelled",
    navigatePlaybackEpisode: async () => startFromBeginning(),
    completeSourceTrackPick: async () => startFromBeginning(),
    handoffNextEpisodePrefetch: async () => {},
    buildPrefetchTarget: (episode, providerId) => ({
      titleId: title.id,
      episode,
      providerId,
    }),
    invalidateRecentEpisodeStream: () => {},
    openPlaybackShell: async () => "quit",
    openTracksPanel: async () => null,
    chooseEpisodeFromMetadata: async () => null,
    episodeInfoFromSelection: (input) => ({
      season: input.season,
      episode: input.episode,
    }),
    readAutoAdvanceGuards: () => ({
      endReason: "eof",
      autoplayPaused: false,
      autoplaySessionPaused: false,
      signalAborted: false,
    }),
    getCompatibleProviders: () => [],
    switchPlaybackProviderFallback: async () => ({
      fromProviderId: "allanime",
      providerId: "videasy",
    }),
    teardownPlaybackForPostPlayExit: async () => {},
    enqueuePostPlaybackRecommendation: async () => {},
    openPostPlaybackRecommendationActionPanel: async () => {},
    handleShellAction: async () => "handled" as const,
    enqueueCurrentPlaybackDownload: async () => true,
    dispatchCalls,
    ...overrides,
  };
  return base;
}

describe("runPostPlaybackMenu", () => {
  test("near-end auto-next uses stopAfterCurrentAtMenuEntry snapshot (B1)", async () => {
    let countdownOffered = false;
    const run = createRun();
    const iteration = createBaseIteration({
      stopAfterCurrentAtMenuEntry: true,
      result: {
        endReason: "quit",
        watchedSeconds: 1380,
        duration: 1400,
        lastNonZeroPositionSeconds: 1380,
        lastNonZeroDurationSeconds: 1400,
        playerExitCode: 0,
        playerExitSignal: null,
      },
    });
    run.playbackSession = { ...run.playbackSession, stopAfterCurrent: false };

    const deps = createDeps({
      runAutoNextCountdown: async () => {
        countdownOffered = true;
        return "cancelled";
      },
      openPlaybackShell: async () => "quit",
    });

    await runPostPlaybackMenu(run, iteration, deps);
    expect(countdownOffered).toBe(false);
  });

  test("near-end cancel declines the advance without pausing autoplay (B3)", async () => {
    const run = createRun();
    const iteration = createBaseIteration({
      result: {
        endReason: "quit",
        watchedSeconds: 1380,
        duration: 1400,
        lastNonZeroPositionSeconds: 1380,
        lastNonZeroDurationSeconds: 1400,
        playerExitCode: 0,
        playerExitSignal: null,
      },
    });
    let countdownCalls = 0;
    const deps = createDeps({
      runAutoNextCountdown: async () => {
        countdownCalls += 1;
        return "cancelled";
      },
      openPlaybackShell: async () => "quit",
    });

    await runPostPlaybackMenu(run, iteration, deps);
    expect(countdownCalls).toBe(1);
    expect(iteration.nearEndAutoNextDeclined).toBe(true);
    // Quitting/declining the advance must not flip the session autoplay
    // preference — only an explicit `a` toggle does.
    expect(run.playbackSession.autoplayPaused).toBe(false);
    expect(deps.dispatchCalls.some((c) => c.type === "autoplay" && c.value === true)).toBe(false);
  });

  test("degraded recovery without streams sets recompute flag (B6)", async () => {
    const run = createRun();
    const iteration = createBaseIteration({
      openRecoverySourcePanelOnPostPlay: true,
      streams: [],
      result: {
        endReason: "quit",
        watchedSeconds: 0,
        duration: 0,
        lastNonZeroPositionSeconds: 0,
        lastNonZeroDurationSeconds: 0,
        playerExitCode: 1,
        playerExitSignal: null,
      },
    });
    let panelOpened = false;
    const deps = createDeps({
      openTracksPanel: async () => {
        panelOpened = true;
        return null;
      },
      openPlaybackShell: async () => "quit",
    });

    await runPostPlaybackMenu(run, iteration, deps);
    expect(panelOpened).toBe(false);
    expect(run.pendingRecomputeSources).toBe(true);
    expect(run.pendingSourceRefreshAction).toBe("recover");
  });

  test("provider switch on handled restarts instead of staying in menu (B5)", async () => {
    const run = createRun();
    const iteration = createBaseIteration();
    iteration.postPlayProviderId = "allanime";
    const deps = createDeps({
      routeShellAction: async () => "handled",
      getProvider: () => "videasy",
      openPlaybackShell: async () => "settings",
    });

    const result = await runPostPlaybackMenu(run, iteration, deps);
    expect(result.kind).toBe("restart");
    expect(run.pendingSourceRefreshAction).toBe("recover");
    expect(iteration.resolvedProviderId).toBe("videasy");
  });

  test("exit action returns exit directive", async () => {
    const run = createRun();
    const iteration = createBaseIteration();
    const deps = createDeps({
      routeShellAction: async () => "quit",
      openPlaybackShell: async () => "quit",
    });

    const result = await runPostPlaybackMenu(run, iteration, deps);
    expect(result).toEqual({ kind: "exit", result: { status: "quit" } });
  });

  test("auto-presents title control on series-complete before post-play shell (TC4)", async () => {
    const run = createRun();
    const endAvailability: EpisodeAvailability = {
      nextEpisode: null,
      previousEpisode: { season: 1, episode: 4 },
      nextSeasonEpisode: null,
      upcomingNext: null,
      animeNextReleaseUnknown: false,
      tmdbUnavailable: false,
    };
    const iteration = createBaseIteration({ episodeAvailability: endAvailability });
    let shellCalls = 0;
    const deps = createDeps({
      openPlaybackShell: async () => {
        shellCalls += 1;
        return "quit";
      },
      routeShellAction: async (action) => action,
      teardownPlaybackForPostPlayExit: async () => {},
    });

    // End-of-catalog states used to auto-present a bare title-control list
    // *instead of* post-play, so the states with purpose-built screens were the
    // only ones that never rendered them. Post-play now always owns the surface.
    await runPostPlaybackMenu(run, iteration, deps);
    expect(shellCalls).toBe(1);
  });

  test("navigation action returns restart directive", async () => {
    const run = createRun();
    const iteration = createBaseIteration();
    const deps = createDeps({
      openPlaybackShell: async () => "next",
      navigatePlaybackEpisode: async () => startFromBeginning(),
    });

    const result = await runPostPlaybackMenu(run, iteration, deps);
    expect(result.kind).toBe("restart");
  });

  test("play-queue-entry claims the advertised id via beginPlayback, not a reordered head", async () => {
    const run = createRun();
    const endAvailability: EpisodeAvailability = {
      nextEpisode: null,
      previousEpisode: { season: 1, episode: 4 },
      nextSeasonEpisode: null,
      upcomingNext: null,
      animeNextReleaseUnknown: false,
      tmdbUnavailable: false,
    };
    const iteration = createBaseIteration({ episodeAvailability: endAvailability });

    const advertised = {
      id: "qe-advertised",
      title: "Advertised Title",
      mediaKind: "series" as const,
      titleId: "tmdb:99",
      season: 1,
      episode: 3,
    };
    const reorderedHead = {
      id: "qe-reordered-head",
      title: "Reordered Head",
      mediaKind: "series" as const,
      titleId: "tmdb:1",
      season: 1,
      episode: 1,
    };
    let peekCalls = 0;
    const beginCalls: Array<{ id: string; source: string }> = [];
    const deps = createDeps({
      container: {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        config: { autoplayRecommendations: true, showWatchTimeStats: false },
        queueService: {
          peekNext: () => {
            peekCalls += 1;
            // After the menu snapshots the advertised head, reorder so a later
            // peek would return a different row — claim must still use the id.
            return peekCalls === 1 ? advertised : reorderedHead;
          },
          beginPlayback: (id: string, source: string) => {
            beginCalls.push({ id, source });
            if (id !== advertised.id) return undefined;
            return {
              queueEntryId: advertised.id,
              titleId: advertised.titleId,
              mediaKind: "series",
              season: advertised.season,
              episode: advertised.episode,
              source,
            };
          },
          getAll: () => [reorderedHead, advertised],
        },
        stateManager: {
          getState: () => ({
            mode: "series",
            autoplaySessionPaused: false,
            autoskipSessionPaused: false,
            provider: "allanime",
            animeLanguageProfile: { subtitle: "en" },
            seriesLanguageProfile: { subtitle: "en" },
            videoMeta: null,
          }),
          dispatch: () => {},
        },
      } as unknown as Container,
      openPlaybackShell: async (input) => {
        expect(input.state.queueNextEntryId).toBe("qe-advertised");
        expect(input.state.queueNextLabel).toContain("Advertised Title");
        return { type: "play-queue-entry", queueEntryId: "qe-advertised" };
      },
      teardownPlaybackForPostPlayExit: async () => {},
    });

    const result = await runPostPlaybackMenu(run, iteration, deps);
    expect(result).toEqual({
      kind: "playlist-advance",
      value: {
        type: "playlist-advance",
        titleInfo: {
          id: "tmdb:99",
          name: "Advertised Title",
          type: "series",
          queuePlaybackIntent: {
            queueEntryId: "qe-advertised",
            titleId: "tmdb:99",
            mediaKind: "series",
            season: 1,
            episode: 3,
            source: "post-play",
          },
        },
        mode: "series",
        season: 1,
        episode: 3,
      },
    });
    expect(beginCalls).toEqual([{ id: "qe-advertised", source: "post-play" }]);
  });
});

describe("alignPostPlayProviderRestart", () => {
  test("stages recover navigation for provider switch (B7)", () => {
    const run = createRun();
    const iteration = createBaseIteration();
    const invalidated: EpisodeInfo[] = [];

    alignPostPlayProviderRestart({
      run,
      iteration,
      currentEpisode,
      nextProviderId: "videasy",
      resumeSeconds: 42,
      invalidateRecentEpisodeStream: (episode) => invalidated.push(episode),
    });

    expect(run.sessionSoftProviderId).toBeNull();
    expect(run.pendingSourceRefreshAction).toBe("recover");
    expect(run.pendingRecomputeSources).toBe(false);
    expect(run.pendingStart.resumePromptAt).toBe(42);
    expect(iteration.resolvedProviderId).toBe("videasy");
    expect(iteration.postPlayProviderId).toBe("videasy");
    expect(invalidated).toEqual([currentEpisode]);
  });
});
