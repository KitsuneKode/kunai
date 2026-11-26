import { describe, expect, test } from "bun:test";

import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import type { PlayerStatsSample } from "@/infra/player/mpv-stats";
import {
  createPlaybackOutputGate,
  readMpvVideoOutput,
  readPlaybackOutputReadiness,
  readSelectedVideoTrack,
  videoNotDecodingEvent,
} from "@/infra/player/playback-output-gate";

const VIDEO_TRACKS = [
  { id: 1, type: "video", selected: true, codec: "hevc" },
  { id: 1, type: "audio", selected: true, codec: "aac" },
];
const AUDIO_TRACKS = [{ id: 1, type: "audio", selected: true, codec: "aac" }];

function sample(overrides: Partial<PlayerStatsSample> = {}): PlayerStatsSample {
  return { source: "ipc", observedAt: 0, positionSeconds: 1, durationSeconds: 1400, ...overrides };
}

describe("readPlaybackOutputReadiness", () => {
  test("a frame at the output is decoded video, whichever property carried it", () => {
    expect(readPlaybackOutputReadiness(sample({ videoOutParams: { w: 1920, h: 1080 } }))).toBe(
      "decoded-video",
    );
    expect(readPlaybackOutputReadiness(sample({ voConfigured: true }))).toBe("decoded-video");
  });

  test("a selected video track with no frame is awaiting video", () => {
    expect(readPlaybackOutputReadiness(sample({ trackList: VIDEO_TRACKS }))).toBe("awaiting-video");
  });

  test("no selected video track is audio-only, an unknown track list is unverified", () => {
    expect(readPlaybackOutputReadiness(sample({ trackList: AUDIO_TRACKS }))).toBe("audio-only");
    expect(readPlaybackOutputReadiness(sample())).toBe("unverified");
  });

  test("the selected video track carries its codec", () => {
    expect(readSelectedVideoTrack(VIDEO_TRACKS)).toEqual({ selected: true, codec: "hevc" });
    expect(readSelectedVideoTrack(AUDIO_TRACKS)).toEqual({ selected: false });
    expect(readSelectedVideoTrack(undefined)).toBeUndefined();
  });
});

describe("createPlaybackOutputGate", () => {
  test("audio-only and decoded video start on the first clock", () => {
    expect(createPlaybackOutputGate().observe(sample({ trackList: AUDIO_TRACKS })).kind).toBe(
      "start",
    );
    expect(
      createPlaybackOutputGate().observe(
        sample({ trackList: VIDEO_TRACKS, videoOutParams: { w: 640, h: 360 } }),
      ),
    ).toEqual({ kind: "start", readiness: "decoded-video" });
  });

  test("no clock, no decision", () => {
    expect(createPlaybackOutputGate().observe(sample({ positionSeconds: 0 }))).toEqual({
      kind: "none",
    });
  });

  test("an unknown track list is checked with mpv before the clock decides", () => {
    // Cold start: mpv can report time-pos before track-list.
    const raced = createPlaybackOutputGate();
    expect(raced.observe(sample())).toEqual({ kind: "verify", reason: "first-clock" });
    expect(raced.started).toBe(false);
    // The read finds a video track and no frame: keep holding.
    expect(raced.afterVerify(sample({ trackList: VIDEO_TRACKS }), "first-clock", true)).toEqual({
      kind: "none",
    });

    // No track evidence even after asking (or no answer): behave as before.
    const plain = createPlaybackOutputGate();
    plain.observe(sample());
    expect(plain.afterVerify(sample(), "first-clock", true)).toEqual({
      kind: "start",
      readiness: "unverified",
    });
    const silent = createPlaybackOutputGate();
    silent.observe(sample());
    expect(silent.afterVerify(sample(), "first-clock", false)).toEqual({
      kind: "start",
      readiness: "unverified",
    });
  });

  test("a clock without frames holds, then a direct read that finds a frame starts", () => {
    const gate = createPlaybackOutputGate();
    // Resume seek: the clock beats the first frame by a few milliseconds.
    expect(gate.observe(sample({ positionSeconds: 600, trackList: VIDEO_TRACKS }))).toEqual({
      kind: "verify",
      reason: "first-clock",
    });
    expect(
      gate.afterVerify(
        sample({ positionSeconds: 600, trackList: VIDEO_TRACKS, videoOutParams: { w: 1, h: 1 } }),
        "first-clock",
        true,
      ),
    ).toEqual({ kind: "start", readiness: "decoded-video" });
    expect(gate.started).toBe(true);
    expect(gate.observe(sample({ positionSeconds: 601, trackList: VIDEO_TRACKS }))).toEqual({
      kind: "none",
    });
  });

  test("a late frame event starts playback while holding", () => {
    const gate = createPlaybackOutputGate();
    gate.observe(sample({ trackList: VIDEO_TRACKS }));
    gate.afterVerify(sample({ trackList: VIDEO_TRACKS }), "first-clock", true);
    expect(
      gate.observe(sample({ positionSeconds: 2, trackList: VIDEO_TRACKS, voConfigured: true })),
    ).toEqual({ kind: "start", readiness: "decoded-video" });
  });

  test("ten seconds of clock with no frame, confirmed by mpv, is not decoding", () => {
    const gate = createPlaybackOutputGate();
    const at = (positionSeconds: number) => sample({ positionSeconds, trackList: VIDEO_TRACKS });
    expect(gate.observe(at(30)).kind).toBe("verify");
    expect(gate.afterVerify(at(30), "first-clock", true)).toEqual({ kind: "none" });
    expect(gate.observe(at(39.5))).toEqual({ kind: "none" });
    expect(gate.observe(at(40))).toEqual({ kind: "verify", reason: "grace" });
    expect(gate.afterVerify(at(40.1), "grace", true)).toEqual({
      kind: "not-decoding",
      secondsWithoutVideo: 10,
      codec: "hevc",
    });
    // Concluded once; nothing more from this cycle.
    expect(gate.observe(at(45))).toEqual({ kind: "none" });
    expect(gate.started).toBe(false);
  });

  test("an unanswered read at the grace point concludes nothing", () => {
    const gate = createPlaybackOutputGate(2);
    const at = (positionSeconds: number) => sample({ positionSeconds, trackList: VIDEO_TRACKS });
    gate.observe(at(1));
    gate.afterVerify(at(1), "first-clock", true);
    expect(gate.observe(at(3)).kind).toBe("verify");
    expect(gate.afterVerify(at(3), "grace", false)).toEqual({ kind: "none" });
    expect(gate.started).toBe(false);
  });

  test("a direct read at the grace point that finds a frame rescues the stream", () => {
    const gate = createPlaybackOutputGate(2);
    const at = (positionSeconds: number) => sample({ positionSeconds, trackList: VIDEO_TRACKS });
    gate.observe(at(1));
    gate.afterVerify(at(1), "first-clock", true);
    expect(gate.observe(at(3)).kind).toBe("verify");
    expect(
      gate.afterVerify(
        sample({ positionSeconds: 3, trackList: VIDEO_TRACKS, videoOutParams: { w: 2, h: 2 } }),
        "grace",
        true,
      ),
    ).toEqual({ kind: "start", readiness: "decoded-video" });
  });

  test("the not-decoding event keeps the codec only when known", () => {
    expect(videoNotDecodingEvent({ kind: "not-decoding", secondsWithoutVideo: 10 })).toEqual({
      type: "video-not-decoding",
      secondsWithoutVideo: 10,
    });
    expect(
      videoNotDecodingEvent({ kind: "not-decoding", secondsWithoutVideo: 10, codec: "av1" }),
    ).toEqual({ type: "video-not-decoding", secondsWithoutVideo: 10, codec: "av1" });
  });
});

describe("readMpvVideoOutput", () => {
  // mpv's real replies, as the IPC layer maps them: an unset property arrives
  // as a failed get_property carrying "property unavailable".
  const ipcAnswering = (
    answer: (property: string) => { readonly data: unknown } | "unavailable" | "timeout",
  ): Pick<MpvIpcSession, "send"> => ({
    async send(command) {
      const reply = answer(String(command[1]));
      if (reply === "unavailable") {
        return { ok: false, command, requestId: 1, error: "property unavailable" };
      }
      if (reply === "timeout") return { ok: false, command, requestId: 1, error: "timeout" };
      return { ok: true, command, requestId: 1, response: { error: "success", data: reply.data } };
    },
  });

  test("mpv's property-unavailable answer is evidence of no frame", async () => {
    const read = await readMpvVideoOutput(
      ipcAnswering((property) => (property === "vo-configured" ? { data: false } : "unavailable")),
    );
    expect(read).toEqual({ videoOutParams: undefined, voConfigured: false, trackList: undefined });
  });

  test("a decoded frame comes back as its size", async () => {
    const read = await readMpvVideoOutput(
      ipcAnswering((property) =>
        property === "video-out-params"
          ? { data: { w: 1280, h: 720, pixelformat: "yuv420p" } }
          : property === "track-list"
            ? { data: VIDEO_TRACKS }
            : { data: true },
      ),
    );
    expect(read).toEqual({
      videoOutParams: { w: 1280, h: 720 },
      voConfigured: true,
      trackList: VIDEO_TRACKS,
    });
  });

  test("a failed send is no evidence either way", async () => {
    expect(await readMpvVideoOutput(ipcAnswering(() => "timeout"))).toBeNull();
    expect(await readMpvVideoOutput(null)).toBeNull();
  });
});
