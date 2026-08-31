import { describe, expect, test } from "bun:test";

import { LOCAL_PLAYBACK_TARGET } from "@/domain/playback/playback-target";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { PlayerOptions } from "@/infra/player/PlayerService";
import { createLocalPlaybackRouter } from "@/services/playback/LocalPlaybackBackend";
import { PlaybackRouter } from "@/services/playback/PlaybackRouter";

const STREAM: StreamInfo = {
  url: "https://media.example/episode/master.m3u8",
  headers: { Referer: "https://provider.example/" },
  subtitle: "https://media.example/episode/subtitles.vtt",
  timestamp: 1,
};

const RESULT: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 60,
  duration: 60,
  lastNonZeroPositionSeconds: 60,
  lastNonZeroDurationSeconds: 60,
  playerExitCode: 0,
  playerExitSignal: null,
};

describe("PlaybackRouter local route", () => {
  test("forwards the complete stream and options contracts to the existing player", async () => {
    const onPlaybackEvent = () => undefined;
    const options: PlayerOptions = {
      url: STREAM.url,
      headers: STREAM.headers,
      subtitle: STREAM.subtitle,
      displayTitle: "Example - S01E01",
      startAt: 42,
      audioPreference: "orig",
      subtitlePreference: "en",
      playbackMode: "autoplay-chain",
      onPlaybackEvent,
    };
    const calls: Array<{ stream: StreamInfo; options: PlayerOptions }> = [];
    const router = createLocalPlaybackRouter({
      play: async (stream, receivedOptions) => {
        calls.push({ stream, options: receivedOptions });
        return RESULT;
      },
    });

    const result = await router.play(STREAM, options);

    expect(result).toBe(RESULT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stream).toBe(STREAM);
    expect(calls[0]?.options).toBe(options);
    expect(calls[0]?.options.onPlaybackEvent).toBe(onPlaybackEvent);
  });

  test("uses the local target when no target is supplied", async () => {
    const targets: unknown[] = [];
    const router = new PlaybackRouter([
      {
        kind: "local",
        play: async (_request, target) => {
          targets.push(target);
          return RESULT;
        },
      },
    ]);

    await router.play(STREAM, { url: STREAM.url, displayTitle: "Example" });

    expect(targets).toEqual([LOCAL_PLAYBACK_TARGET]);
  });

  test("fails explicitly when the selected backend is not registered", () => {
    const router = new PlaybackRouter([]);

    expect(() => router.play(STREAM, { url: STREAM.url, displayTitle: "Example" })).toThrow(
      "No playback backend is registered for target kind: local",
    );
  });
});
