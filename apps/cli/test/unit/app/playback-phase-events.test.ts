import { expect, test } from "bun:test";

import { PlaybackPhase, playbackStartupStageForPlayerEvent } from "@/app/PlaybackPhase";

test("PlaybackPhase describes mpv track-changed events for user feedback", () => {
  const phase = new PlaybackPhase();
  const describe = (
    phase as unknown as {
      describePlayerEvent: (event: {
        type: "track-changed";
        trackType: "audio" | "sub";
        id: number;
      }) => {
        detail?: string | null;
        note?: string | null;
      };
    }
  ).describePlayerEvent.bind(phase);

  expect(describe({ type: "track-changed", trackType: "audio", id: 2 }).note).toContain(
    "Audio track switched in mpv",
  );
  expect(describe({ type: "track-changed", trackType: "sub", id: 0 }).note).toContain(
    "Subtitle track switched in mpv",
  );
});

test("PlaybackPhase distinguishes a slow network source from ordinary buffering", () => {
  const phase = new PlaybackPhase();
  const describe = (
    phase as unknown as {
      describePlayerEvent: (event: {
        type: "stream-slow";
        state: "buffering-observed" | "slow-network-suspected";
        secondsBuffering: number;
      }) => {
        detail?: string | null;
        note?: string | null;
      };
    }
  ).describePlayerEvent.bind(phase);

  expect(
    describe({
      type: "stream-slow",
      state: "buffering-observed",
      secondsBuffering: 1,
    }),
  ).toEqual({
    detail: "Building playback buffer",
    note: "1s buffering",
  });
  expect(
    describe({
      type: "stream-slow",
      state: "slow-network-suspected",
      secondsBuffering: 6,
    }),
  ).toEqual({
    detail: "Slow source (network read)",
    note: "6s buffering",
  });
});

test("playback startup timing ends at first trusted progress", () => {
  expect(
    playbackStartupStageForPlayerEvent({
      type: "playback-progress",
      positionSeconds: 1,
      durationSeconds: 1200,
    }),
  ).toBe("first-progress");
  expect(
    playbackStartupStageForPlayerEvent({ type: "late-subtitles-attached", trackCount: 2 }),
  ).toBe(null);
  expect(playbackStartupStageForPlayerEvent({ type: "player-closed" })).toBe(null);
});
