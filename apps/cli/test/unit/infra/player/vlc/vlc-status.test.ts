import { describe, expect, test } from "bun:test";

import { createPlayerStatsState } from "@/infra/player/mpv-stats";
import { readPlaybackOutputReadiness } from "@/infra/player/playback-output-gate";
import { applyVlcStatus, parseVlcStatus, vlcTrackList } from "@/infra/player/vlc/vlc-status";

// Trimmed from a real VLC 3.0.24 `status.json` (healthy H.264 + AAC clip).
const HEALTHY = {
  state: "playing",
  time: 1,
  length: 6,
  position: 0.19172616302967,
  version: "3.0.24 Vetinari",
  apiversion: 3,
  stats: { decodedvideo: 91, displayedpictures: 27, decodedaudio: 197, lostpictures: 0 },
  information: {
    category: {
      "Stream 0": { Type: "Video", Codec: "H264 - MPEG-4 AVC (part 10) (avc1)" },
      "Stream 1": { Type: "Audio", Codec: "MPEG AAC Audio (mp4a)" },
      meta: { filename: "av.mp4" },
    },
  },
};

describe("parseVlcStatus", () => {
  test("reads state, a sub-second position and the video stream", () => {
    const status = parseVlcStatus(HEALTHY);
    expect(status?.state).toBe("playing");
    // `time` is whole seconds; position × length is the finer clock.
    expect(status?.positionSeconds).toBeCloseTo(1.15, 2);
    expect(status?.durationSeconds).toBe(6);
    expect(status?.video).toEqual({ codec: "H264 - MPEG-4 AVC (part 10) (avc1)" });
    expect(status?.displayedPictures).toBe(27);
  });

  test("an audio-only input has no video stream", () => {
    const status = parseVlcStatus({
      ...HEALTHY,
      stats: { displayedpictures: 0 },
      information: { category: { "Stream 0": { Type: "Audio", Codec: "AAC" } } },
    });
    expect(status?.video).toBeUndefined();
    expect(vlcTrackList(status!)).toEqual([{ type: "audio", selected: true }]);
  });

  test("before VLC opens the input the track list is unknown, not audio-only", () => {
    const status = parseVlcStatus({ state: "stopped", time: 0, length: 0, information: {} });
    expect(status?.state).toBe("stopped");
    expect(vlcTrackList(status!)).toBeUndefined();
  });

  test("anything that is not a VLC status is rejected", () => {
    expect(parseVlcStatus(null)).toBeNull();
    expect(parseVlcStatus({ error: "nope" })).toBeNull();
  });
});

describe("applyVlcStatus", () => {
  test("a healthy status reads as decoded video through the shared output gate", () => {
    const stats = createPlayerStatsState();
    applyVlcStatus(stats, parseVlcStatus(HEALTHY)!, 0, 1_000);
    expect(stats.latestIpcSample?.positionSeconds).toBeCloseTo(1.15, 2);
    expect(stats.latestIpcSample?.durationSeconds).toBe(6);
    expect(readPlaybackOutputReadiness(stats.latestIpcSample)).toBe("decoded-video");
  });

  test("a video stream with no pictures is awaiting video (VLC without a decoder)", () => {
    // Measured: with no H.264 decoder installed, VLC lists the video stream,
    // plays the audio, and displayedpictures stays 0.
    const stats = createPlayerStatsState();
    applyVlcStatus(
      stats,
      parseVlcStatus({ ...HEALTHY, stats: { decodedvideo: 0, displayedpictures: 0 } })!,
      0,
      1_000,
    );
    expect(readPlaybackOutputReadiness(stats.latestIpcSample)).toBe("awaiting-video");
  });

  test("frames arriving means a rise since the last poll, so a frozen picture shows", () => {
    const stats = createPlayerStatsState();
    const at = (displayed: number) =>
      parseVlcStatus({ ...HEALTHY, stats: { displayedpictures: displayed } })!;
    applyVlcStatus(stats, at(27), 10, 1_000);
    expect(stats.latestIpcSample?.voConfigured).toBe(true);
    // Same running total as last poll while playing: no new frames.
    applyVlcStatus(stats, at(27), 27, 1_500);
    expect(stats.latestIpcSample?.voConfigured).toBe(false);
    // Paused on a shown frame is not a lost picture.
    applyVlcStatus(stats, { ...at(27), state: "paused" }, 27, 2_000);
    expect(stats.latestIpcSample?.voConfigured).toBe(true);
    expect(stats.latestIpcSample?.paused).toBe(true);
  });
});
