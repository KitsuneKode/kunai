import { expect, test } from "bun:test";

import { playbackAudioPreference } from "@/app/playback/playback-profile-context";
import { PlaybackPhase } from "@/app/playback/PlaybackPhase";
import { MANAGED_MPV_CAPABILITIES } from "@/domain/playback/player-capabilities";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
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
