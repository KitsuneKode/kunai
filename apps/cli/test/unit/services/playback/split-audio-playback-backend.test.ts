import { expect, test } from "bun:test";

import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import {
  splitAudioVideoCorrection,
  SplitAudioPlaybackBackend,
} from "@/services/playback/split-audio-playback-backend";

test("split audio follows meaningful receiver drift without chasing jitter", () => {
  expect(splitAudioVideoCorrection(undefined, 12)).toBeNull();
  expect(splitAudioVideoCorrection(12, 12.2)).toBeNull();
  expect(splitAudioVideoCorrection(12, 12.25)).toBe(12.25);
  expect(splitAudioVideoCorrection(12, 13.5)).toBe(13.5);
});

test("split audio starts muted local video at the receiver position and couples seeks", async () => {
  const seeks: number[] = [];
  const pausedStates: boolean[] = [];
  let active: ActivePlayerControl | null = null;
  let resolveActive!: () => void;
  const activeReady = new Promise<void>((resolve) => (resolveActive = resolve));
  let resolveLocal!: (value: any) => void;
  const localResult = new Promise<any>((resolve) => (resolveLocal = resolve));
  let localStops = 0;
  const localControl: ActivePlayerControl = {
    id: "local-1",
    stop: async () => {
      localStops += 1;
      resolveLocal({ endReason: "quit" });
    },
    togglePause: async () => {},
    setPaused: async (paused) => void pausedStates.push(paused),
    seekAbsolute: async (seconds) => void seeks.push(seconds),
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
  const castStreams: any[] = [];
  const gatewayStarts: number[] = [];
  let gatewaysClosed = 0;
  const player = {
    play: (_stream: any, options: any) => {
      localOptions = options;
      options.onPlayerReady?.();
      return localResult;
    },
  };
  const cast = {
    play: async (request: any) => {
      castStreams.push(request.stream);
      request.options.onPlaybackEvent?.({
        generation: { process: 1, cycle: 1 },
        event: { type: "playback-started" },
      });
      await new Promise<void>((resolve) =>
        request.options.abortSignal.addEventListener("abort", () => resolve()),
      );
      return { endReason: "quit" };
    },
    getPosition: () => 0.75,
    togglePause: async () => {},
  };
  const audioGateway = {
    start: async ({ startAt }: { startAt?: number }) => {
      gatewayStarts.push(startAt ?? 0);
      return {
        mediaUrl: `http://192.168.1.10:41000/cast-audio/token-${startAt}/audio.mp3`,
        contentType: "audio/mpeg" as const,
        close: async () => {
          gatewaysClosed += 1;
        },
      };
    },
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
  expect(castStreams[0]).toMatchObject({
    url: "http://192.168.1.10:41000/cast-audio/token-0/audio.mp3",
    headers: {},
    isLive: true,
  });
  expect(localOptions).toMatchObject({ videoOnly: true, startAt: 0 });
  expect(pausedStates).toEqual([true, false]);
  await active!.seekAbsolute!(45);
  expect(seeks).toEqual([0.75, 45, 45.75]);
  expect(gatewayStarts).toEqual([0, 45]);
  expect(pausedStates).toEqual([true, false, true, false]);
  await active!.togglePause!();
  expect(gatewaysClosed).toBe(2);
  await active!.togglePause!();
  expect(gatewayStarts).toEqual([0, 45, 12]);
  expect(seeks).toEqual([0.75, 45, 45.75, 12.75]);
  expect(pausedStates).toEqual([true, false, true, false, true, false]);
  await backend.stop();
  await playing;
  expect(localStops).toBe(1);
  expect(gatewaysClosed).toBe(3);
});
