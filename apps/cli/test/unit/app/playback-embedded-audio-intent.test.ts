import { expect, test } from "bun:test";

import {
  EpisodePrefetchHandle,
  matchesEpisodePrefetchTarget,
  type EpisodePrefetchTarget,
} from "@/app/playback/episode-prefetch";
import { playbackAudioPreference } from "@/app/playback/playback-profile-context";
import { PlaybackPhase } from "@/app/playback/PlaybackPhase";
import {
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesAudioPreference,
  type RecentPlaybackStreamRecord,
} from "@/app/playback/recent-playback-stream";
import { MANAGED_MPV_CAPABILITIES } from "@/domain/playback/player-capabilities";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import { parseMpvAudioIntent } from "@/infra/player/mpv-audio-intent";
import type { PlayerOptions, PlayerPlaybackEvent } from "@/infra/player/PlayerService";

const title = { id: "audio-title", name: "Audio title", type: "series" as const };
const stream = { url: "https://example.test/audio.mkv", headers: {}, timestamp: 1 };
const profiles = {
  anime: { audio: "original", subtitle: "en" },
  series: { audio: "en", subtitle: "none" },
  movie: { audio: "en", subtitle: "en" },
};

test("explicit native audio survives restart and autoplay without rewriting defaults or accepting stale events", async () => {
  let state = reduceState(createInitialState("vidking", "allanime", profiles), {
    type: "SELECT_TITLE",
    title,
  });
  const stateManager = {
    getState: () => state,
    dispatch: (transition: Parameters<typeof reduceState>[1]) => {
      state = reduceState(state, transition);
    },
  };
  const config = {
    animeLanguageProfile: profiles.anime,
    seriesLanguageProfile: profiles.series,
    movieLanguageProfile: profiles.movie,
    youtubeLanguageProfile: profiles.movie,
  };
  const launches: string[] = [];
  let script: (options: PlayerOptions) => void = () => {};
  let cycle = 0;
  const phase = new PlaybackPhase();
  // Presence is independent of track intent; this harness exercises the real
  // playback loop, generation policy, callback and session reducer.
  Object.assign(phase, { updatePresenceInBackground: () => {} });
  // SAFETY: These in-memory collaborators cover playStream with progress/presence disabled; no live services are constructed.
  const context = {
    signal: new AbortController().signal,
    container: {
      config,
      stateManager,
      diagnosticsService: { record: () => {} },
      player: {
        capabilities: {
          ...MANAGED_MPV_CAPABILITIES,
          externalSubtitles: false,
          progressEvents: false,
        },
        play: async (_stream: typeof stream, options: PlayerOptions) => {
          launches.push(options.audioPreference ?? "");
          options.onGenerationActivated?.({ process: 1, cycle: ++cycle });
          script(options);
          return { endReason: "eof", watchedSeconds: 0, duration: 0 };
        },
      },
    },
  } as never;
  const play = phase["playStream"].bind(phase);
  const event = (audioLanguageIntent?: string): PlayerPlaybackEvent => {
    const observation = { type: "track-changed", trackType: "audio", id: 2 } as const;
    return audioLanguageIntent ? { ...observation, audioLanguageIntent } : observation;
  };
  script = (options) => {
    options.onPlaybackEvent?.({ generation: { process: 1, cycle }, event: event() });
    expect(state.playbackTrackPreferences.audio).toBeUndefined();
    options.onPlaybackEvent?.({ generation: { process: 1, cycle }, event: event("ja") });
  };
  await play(stream, title, { season: 1, episode: 1 }, context);
  expect(state.playbackTrackPreferences.audio).toBe("ja");
  script = (options) => {
    options.onPlaybackEvent?.({ generation: { process: 1, cycle }, event: event() });
    options.onPlaybackEvent?.({ generation: { process: 1, cycle: cycle - 1 }, event: event("fr") });
  };
  await play(stream, title, { season: 1, episode: 1 }, context);
  await play(stream, title, { season: 1, episode: 2 }, context, 0, 0, "autoplay-chain");
  expect(launches).toEqual(["en", "ja", "ja"]);
  expect(
    playbackAudioPreference({
      config,
      mode: state.mode,
      title,
      overrides: state.playbackTrackPreferences,
    }),
  ).toBe("ja");
  expect(profiles.series.audio).toBe("en");
  stateManager.dispatch({ type: "RESET_CONTENT" });
  expect(state.playbackTrackPreferences).toEqual({});
  stateManager.dispatch({ type: "SELECT_TITLE", title: { ...title, id: "new-title" } });
  expect(
    playbackAudioPreference({
      config,
      mode: state.mode,
      title,
      overrides: state.playbackTrackPreferences,
    }),
  ).toBe("en");
});

test("PlaybackPhase execute-level autoplay advances to next episode with playbackResolveWork receiving chosen language", async () => {
  const animeTitle = {
    id: "anime-audio-title",
    name: "Anime Audio Title",
    type: "series" as const,
    isAnime: true,
    launchSource: "notification" as const,
  };
  let state = reduceState(createInitialState("vidking", "allanime", profiles), {
    type: "SET_MODE",
    mode: "anime",
    provider: "allanime",
  });
  state = reduceState(state, {
    type: "SELECT_TITLE",
    title: animeTitle,
  });
  state = reduceState(state, {
    type: "SELECT_EPISODE",
    episode: { season: 1, episode: 1 },
  });
  const stateManager = {
    getState: () => state,
    dispatch: (transition: Parameters<typeof reduceState>[1]) => {
      state = reduceState(state, transition);
    },
    subscribe: () => () => {},
  };
  const config = {
    animeLanguageProfile: profiles.anime,
    seriesLanguageProfile: profiles.series,
    movieLanguageProfile: profiles.movie,
    youtubeLanguageProfile: profiles.movie,
    autoNext: true,
    recommendationRailEnabled: false,
    powerSaverMode: false,
    startupPriority: "fast" as const,
    favoriteSources: [],
    recoveryMode: "aggressive" as const,
    titleProviderPreferences: {},
    getRaw: () => ({ titleProviderPreferences: {} }),
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => {
      throw new Error("offline");
    },
    { preconnect: () => {} },
  );

  const resolveCalls: Array<{ episode: any; audioPreference?: string }> = [];
  const playbackResolveWork = {
    resolve: async (input: { episode: any; audioPreference?: string }) => {
      resolveCalls.push({
        episode: input.episode,
        audioPreference: input.audioPreference,
      });
      return {
        stream,
        providerId: "allanime",
        sourceId: "src-1",
        streamId: "stream-1",
        provenance: "fresh" as const,
        timing: null,
        duration: 100,
        subtitles: [],
        attempts: [],
      };
    },
  };

  let playCount = 0;
  const stop = new AbortController();
  const player = {
    capabilities: {
      ...MANAGED_MPV_CAPABILITIES,
      externalSubtitles: false,
      progressEvents: false,
    },
    isAvailable: async () => true,
    releasePersistentSession: async () => {},
    play: async (_stream: any, options: PlayerOptions) => {
      playCount++;
      const cycle = playCount;
      options.onGenerationActivated?.({ process: 1, cycle });
      if (playCount === 1) {
        // Exercise the mpv boundary as well as the autoplay session reader.
        const nativeIntent = parseMpvAudioIntent(
          JSON.stringify({ id: 2, language: "jpn", path: stream.url }),
          stream.url,
        );
        if (!nativeIntent) throw new Error("Expected explicit mpv audio intent");
        options.onPlaybackEvent?.({
          generation: { process: 1, cycle },
          event: nativeIntent,
        });
        // Returns natural EOF to trigger auto-next advance
        return {
          endReason: "eof" as const,
          watchedSeconds: 100,
          duration: 100,
          lastNonZeroPositionSeconds: 100,
          lastNonZeroDurationSeconds: 100,
        };
      }
      // Episode 2: abort after resolve and play are verified
      stop.abort("test complete");
      return { endReason: "quit" as const, watchedSeconds: 1, duration: 100 };
    },
  };

  const playerControl = {
    getActive: () => null,
    setEpisodeNavigationAvailability: () => {},
    signalPlaybackAction: () => {},
    consumeLastAction: () => null,
    consumePendingEpisodeSourceOverride: () => null,
    consumePendingStreamSelection: () => null,
    consumePendingEpisodeSelection: () => null,
    consumePendingTitleSelection: () => null,
    clearAction: () => {},
  };

  const container = {
    config,
    stateManager,
    diagnosticsService: { record: () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    providerRegistry: {
      get: (id: string) => ({ metadata: { id, name: id } }),
      getManifest: (id: string) => ({ id, name: id }),
      getCompatible: () => [],
    },
    providerHealth: {
      get: () => ({ status: "healthy" }),
      set: () => {},
    },
    titleProviderHealth: {
      getSwitchSuggestion: () => null,
      recordCleanSuccess: () => {},
      recordFailure: () => {},
    },
    cacheStore: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    },
    sourceInventory: {
      delete: async () => {},
    },
    episodePlaybackSelection: {
      get: async () => null,
      apply: async () => {},
    },
    titlePlaybackSource: {
      get: async () => null,
      apply: async () => {},
    },
    endpointHealth: {
      isQuarantined: () => false,
    },
    historyRepository: {
      getLatestForTitleIdentity: () => null,
      getLatestForTitle: () => null,
      getProgressForTitleIdentity: () => null,
      listByTitleIdentity: () => [],
      upsertProgress: () => {},
      getProgress: () => null,
      findLatestProgress: () => null,
    },
    queueService: {
      peekNext: () => null,
    },
    presence: {
      updatePlayback: async () => {},
      clearPlayback: async () => {},
    },
    playerControl,
    player,
    playbackResolveWork,
    playbackHistoryLedgerFactory: () => ({ start: () => {} }),
    backgroundWorkScheduler: {
      enqueue: () => {},
      drain: async () => {},
    },
    workControl: {
      setActive: () => {},
      isCancelled: () => false,
    },
    offlineTitleIdentity: {
      resolveForTitle: () => "offline-title-id",
    },
    offlineAssetService: {
      listTitleAssets: () => [],
    },
    connectivity: {
      isOnline: () => true,
      recordSuccess: () => {},
    },
    resolveTraceSink: {
      record: () => {},
    },
  };

  const phase = new PlaybackPhase();
  Object.assign(phase, {
    updatePresenceInBackground: () => {},
    clearPresenceInBackground: () => {},
    resolveEpisodePrefetchBundle: async () => null,
    runAutoNextCountdown: async () => "continue",
    getAnimeEpisodeOptions: async () => [
      { index: 1, label: "E1" },
      { index: 2, label: "E2" },
    ],
  });

  try {
    // SAFETY: The in-memory ports above cover this execute path; unexpected production calls fail rather than reaching a real profile or player.
    await phase.execute(animeTitle, { container, signal: stop.signal } as never);
  } finally {
    globalThis.fetch = origFetch;
  }

  expect(resolveCalls.length).toBe(2);
  expect(resolveCalls[0]!.episode.episode).toBe(1);
  expect(resolveCalls[0]!.audioPreference).toBe("original");
  expect(resolveCalls[1]!.episode.episode).toBe(2);
  expect(resolveCalls[1]!.audioPreference).toBe("ja");
  expect(profiles.anime.audio).toBe("original");
});

test("prefetch isolation ensures prefetch target and bundle match chosen audio", async () => {
  const targetEn: EpisodePrefetchTarget = {
    titleId: "audio-title",
    episode: { season: 1, episode: 2 },
    providerId: "allanime",
    audioPreference: "en",
  };
  const targetJa: EpisodePrefetchTarget = {
    titleId: "audio-title",
    episode: { season: 1, episode: 2 },
    providerId: "allanime",
    audioPreference: "ja",
  };
  expect(matchesEpisodePrefetchTarget(targetEn, targetJa)).toBe(false);
  expect(matchesEpisodePrefetchTarget(targetJa, targetJa)).toBe(true);

  const prefetchHandle = new EpisodePrefetchHandle();
  const ready = await prefetchHandle.awaitFor(
    targetEn,
    async () => ({
      target: targetEn,
      stream: { url: "https://example.test/stream-en.mkv", headers: {}, timestamp: 1 },
      prepared: false,
      resolvedProviderId: "allanime",
    }),
    1_000,
  );
  expect(ready.bundle?.target.audioPreference).toBe("en");
  expect(prefetchHandle.hasReadyFor(targetEn)).toBe(true);

  // When live audio preference changed to "ja", checking or taking ready for targetJa does not take the stale targetEn bundle
  expect(prefetchHandle.hasReadyFor(targetJa)).toBe(false);
  expect(prefetchHandle.peekReadyFor(targetJa)).toBeNull();
  expect(prefetchHandle.takeReadyFor(targetJa)).toBeNull();
  expect(prefetchHandle.takeReadyFor(targetEn)?.target.audioPreference).toBe("en");
});

test("recentEpisodeStreams partitions cached stream by audio preference on backward navigation", () => {
  const currentEpisode = { season: 1, episode: 1 };
  const recentStreams = new Map<string, RecentPlaybackStreamRecord>();
  const initialAudio = "en";
  const initialKey = recentPlaybackStreamKey("audio-title", currentEpisode, initialAudio);

  const record: RecentPlaybackStreamRecord = {
    stream: { url: "https://example.test/audio-en.mkv", headers: {}, timestamp: 1 },
    selectedProviderId: "allanime",
    resolvedProviderId: "allanime",
    provenance: "fresh",
    episode: currentEpisode,
    audioPreference: initialAudio,
  };
  recentStreams.set(initialKey, record);

  // If user explicitly switched audio preference to "ja", lookup under new liveAudioPref misses
  const liveAudioPref = "ja";
  const newKey = recentPlaybackStreamKey("audio-title", currentEpisode, liveAudioPref);
  expect(recentStreams.get(newKey)).toBeUndefined();

  // Even if evaluated directly, matchesAudioPreference rejects the mismatched record
  expect(recentPlaybackStreamMatchesAudioPreference(record, liveAudioPref)).toBe(false);

  // But with matching audio preference "en", it matches and can be reused
  expect(recentStreams.get(initialKey)).toBeDefined();
  expect(recentPlaybackStreamMatchesAudioPreference(record, "en")).toBe(true);
});
