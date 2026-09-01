import { expect, test } from "bun:test";

import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import {
  isAdvancingRemoteClock,
  splitRemoteSourcePosition,
  SplitAudioPlaybackBackend,
} from "@/services/playback/split-audio-playback-backend";

test("split audio starts muted local video at the receiver position and couples seeks", async () => {
  const seeks: Array<[string, number]> = [];
  let localPauseToggles = 0;
  let active: ActivePlayerControl | null = null;
  let resolveActive!: () => void;
  const activeReady = new Promise<void>((resolve) => (resolveActive = resolve));
  let resolveLocal!: (value: any) => void;
  const localResult = new Promise<any>((resolve) => (resolveLocal = resolve));
  const localControl: ActivePlayerControl = {
    id: "local-1",
    stop: async () => {},
    togglePause: async () => {
      localPauseToggles += 1;
    },
    seekAbsolute: async (seconds) => void seeks.push(["local", seconds]),
    getStatsSnapshot: () => ({ positionSeconds: 12, durationSeconds: 120, updatedAt: Date.now() }),
  };
  const playerControl = {
    setActive: (control: ActivePlayerControl | null) => {
      active = control;
      if (control) resolveActive();
    },
    getActive: () => active,
    waitForActivePlayer: async () => localControl,
  };
  let localOptions: any;
  let castStream: any;
  let audioGatewayClosed = false;
  const player = {
    play: (_stream: any, options: any) => {
      localOptions = options;
      options.onPlayerReady?.();
      return localResult;
    },
  };
  const cast = {
    play: async (request: any) => {
      castStream = request.stream;
      request.options.onPlaybackEvent?.({
        generation: { process: 1, cycle: 1 },
        event: { type: "playback-started" },
      });
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener("abort", () => resolve()),
      );
      return { endReason: "quit" };
    },
    stop: async () => {},
    getPosition: () => 12,
    togglePause: async () => {},
    seek: async (seconds: number) => void seeks.push(["cast", seconds]),
  };
  const audioGateway = {
    start: async () => ({
      mediaUrl: "http://192.168.1.10:41000/cast-audio/token/audio.mp3",
      contentType: "audio/mpeg" as const,
      close: async () => {
        audioGatewayClosed = true;
      },
    }),
  };
  const backend = new SplitAudioPlaybackBackend(
    player as any,
    playerControl as any,
    cast as any,
    audioGateway,
  );
  const playing = backend.play(
    {
      stream: {
        url: "https://media.example/video.m3u8",
        headers: {},
        timestamp: 1,
        isLive: false,
      },
      options: { url: "https://media.example/video.m3u8", displayTitle: "Example" },
    },
    {
      kind: "split-audio",
      id: "split-audio:tv-1",
      name: "This device + Living Room TV",
      capabilities: ["audio", "video"],
      audioTarget: {
        kind: "google-cast",
        id: "tv-1",
        name: "Living Room TV",
        host: "192.168.1.50",
        capabilities: ["audio", "video"],
      },
    },
  );

  await activeReady;
  expect(castStream).toMatchObject({
    url: "http://192.168.1.10:41000/cast-audio/token/audio.mp3",
    headers: {},
    isLive: true,
  });
  expect(localOptions).toMatchObject({ videoOnly: true, startAt: 0 });
  expect(localPauseToggles).toBe(2);
  await active!.seekAbsolute!(45);
  expect(seeks).toEqual([
    ["local", 12],
    ["local", 45],
    ["cast", 45],
  ]);
  resolveLocal({ endReason: "quit" });
  await playing;
  expect(audioGatewayClosed).toBe(true);
});

test("split audio ignores a stalled receiver clock and maps advancing time to the source", () => {
  expect(isAdvancingRemoteClock(null, 0)).toBe(false);
  expect(isAdvancingRemoteClock(0, 0)).toBe(false);
  expect(isAdvancingRemoteClock(0, 0.2)).toBe(true);
  expect(splitRemoteSourcePosition(120, 3.5)).toBe(123.5);
});
