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

// Characterization coverage for the full describePlayerEvent feedback surface.
// This locks the user-facing playback feedback across the resolve -> play ->
// post-play lifecycle so refactors that move playback policy/copy out of the
// phase cannot silently change what the shell tells the user.
type DescribePlayerEvent = (event: Record<string, unknown> & { type: string }) => {
  detail?: string | null;
  note?: string | null;
};

function describePlayerEventFor(): DescribePlayerEvent {
  const phase = new PlaybackPhase();
  return (
    phase as unknown as {
      describePlayerEvent: DescribePlayerEvent;
    }
  ).describePlayerEvent.bind(phase);
}

test("describePlayerEvent labels media materialization by container kind", () => {
  const describe = describePlayerEventFor();
  expect(describe({ type: "media-materialized", kind: "dash-mpd" }).detail).toBe(
    "Preparing DASH media",
  );
  expect(describe({ type: "media-materialized", kind: "hls-manifest" }).detail).toBe(
    "Preparing HLS playlist for mpv",
  );
  expect(describe({ type: "media-materialized", kind: "direct" }).detail).toBe("Preparing media");
});

test("describePlayerEvent formats network buffering percent and cache-ahead", () => {
  const describe = describePlayerEventFor();
  expect(describe({ type: "network-buffering", percent: 42.4, cacheAheadSeconds: 3.2 })).toEqual({
    detail: "Building playback buffer",
    note: "42% / 3.2s cached ahead",
  });
  expect(describe({ type: "network-buffering" })).toEqual({
    detail: "Building playback buffer",
    note: "Filling demuxer cache",
  });
});

test("describePlayerEvent distinguishes a dead network read from generic stall", () => {
  const describe = describePlayerEventFor();
  const dead = describe({
    type: "stream-stalled",
    stallKind: "network-read-dead",
    secondsWithoutProgress: 12,
  });
  expect(dead.detail).toBe("Stream stalled (network read idle)");
  expect(dead.note).toContain("Demuxer underrun with no incoming bytes");

  const stalled = describe({
    type: "stream-stalled",
    stallKind: "no-progress",
    secondsWithoutProgress: 8,
  });
  expect(stalled.detail).toBe("Stream stalled");
  expect(stalled.note).toContain("No playback progress for 8s");
});

test("describePlayerEvent narrates in-process reconnect phases", () => {
  const describe = describePlayerEventFor();
  expect(describe({ type: "mpv-in-process-reconnect", phase: "started", attempt: 1 }).detail).toBe(
    "Reloading same stream in mpv",
  );
  expect(describe({ type: "mpv-in-process-reconnect", phase: "complete", attempt: 2 }).detail).toBe(
    "Reload finished",
  );
  expect(
    describe({
      type: "mpv-in-process-reconnect",
      phase: "failed",
      attempt: 3,
      detail: "socket gone",
    }),
  ).toEqual({ detail: "Reload failed", note: "Attempt 3 · socket gone" });
});

test("describePlayerEvent reports subtitle inventory and segment skips", () => {
  const describe = describePlayerEventFor();
  expect(describe({ type: "subtitle-inventory-ready", trackCount: 3 }).note).toContain(
    "3 alternate subtitle tracks are ready",
  );
  expect(describe({ type: "subtitle-inventory-ready", trackCount: 0 }).note).toBe(
    "Primary subtitle is ready",
  );
  expect(describe({ type: "segment-skipped", kind: "intro", automatic: true }).note).toBe(
    "Intro skipped automatically",
  );
  expect(describe({ type: "segment-skipped", kind: "recap", automatic: false }).note).toBe(
    "Recap skipped",
  );
});

test("describePlayerEvent surfaces player control failures verbatim", () => {
  const describe = describePlayerEventFor();
  expect(
    describe({ type: "ipc-command-failed", command: "set_property", error: "timeout" }).note,
  ).toBe("Player command failed: set_property (timeout)");
  expect(describe({ type: "ipc-stalled", command: "get_property" })).toEqual({
    detail: "Player control stalled",
    note: "mpv did not answer get_property; playback may still be alive",
  });
});

test("describePlayerEvent returns empty descriptors for silent telemetry", () => {
  const describe = describePlayerEventFor();
  expect(describe({ type: "network-sample" })).toEqual({});
});
