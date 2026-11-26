import { isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

import { isMpvPropertyUnavailable, type MpvIpcCommandResult, type MpvIpcSession } from "./mpv-ipc";
import {
  applyObservedPropertySample,
  readVideoOutParams,
  type PlayerStatsSample,
  type PlayerStatsState,
} from "./mpv-stats";
import type { PlayerPlaybackEvent } from "./PlayerService";

/**
 * Whether mpv is actually producing what the user came for.
 *
 * mpv's clock (`time-pos`) moves as soon as audio plays, so a stream whose
 * video never decodes (unsupported codec, corrupt packets, a dead hardware
 * decoder) looked exactly like a healthy start. `video-params` is no proof
 * either: it comes from container metadata. The proof is a frame reaching the
 * video output — `video-out-params` (or `vo-configured`), measured against mpv
 * 0.42 with generated media in the readiness change.
 *
 * - `decoded-video`: a frame reached the output.
 * - `audio-only`: no video track is selected (audio file, `--vid=no`).
 * - `unverified`: the track list is unknown, so there is no evidence either
 *   way; behaves as before (the clock decides).
 * - `awaiting-video`: a video track is selected and no frame has arrived.
 */
export type PlaybackOutputReadiness =
  | "decoded-video"
  | "audio-only"
  | "unverified"
  | "awaiting-video";

/**
 * Media-clock seconds a selected video track may play without one decoded
 * frame before the stream counts as not decoding. Clock time, not wall time:
 * a slow network stalls the clock too and is the startup-stall watchdog's job.
 * Ten seconds covers a long keyframe interval after a corrupt start.
 */
export const VIDEO_DECODE_GRACE_SECONDS = 10;

export type SelectedVideoTrack = { readonly selected: boolean; readonly codec?: string };

/** The selected video track from mpv's `track-list`, or undefined when unknown. */
export function readSelectedVideoTrack<T>(trackList: T): SelectedVideoTrack | undefined {
  if (!Array.isArray(trackList)) return undefined;
  for (const entry of trackList) {
    if (!isJsonObject(entry) || entry.type !== "video" || entry.selected !== true) continue;
    return isJsonString(entry.codec) ? { selected: true, codec: entry.codec } : { selected: true };
  }
  return { selected: false };
}

export function hasDecodedVideo(sample: PlayerStatsSample | null | undefined): boolean {
  return Boolean(sample?.videoOutParams) || sample?.voConfigured === true;
}

export function readPlaybackOutputReadiness(
  sample: PlayerStatsSample | null | undefined,
): PlaybackOutputReadiness {
  if (hasDecodedVideo(sample)) return "decoded-video";
  const video = readSelectedVideoTrack(sample?.trackList);
  if (!video) return "unverified";
  return video.selected ? "awaiting-video" : "audio-only";
}

/** What the caller should do after the gate looks at a sample. */
export type PlaybackOutputGateStep =
  | { readonly kind: "none" }
  /** Confirm playback: emit `playback-started`, then allow progress events. */
  | {
      readonly kind: "start";
      readonly readiness: Exclude<PlaybackOutputReadiness, "awaiting-video">;
    }
  /**
   * Read `video-out-params`, `vo-configured` and `track-list` straight from
   * mpv, apply them to the sample, then call `afterVerify`. On a cold start mpv
   * can report the clock before the track list, and a new file's property
   * events can land before its cycle accepts them; nothing is concluded from a
   * gap in the event stream without asking mpv directly.
   */
  | { readonly kind: "verify"; readonly reason: "first-clock" | "grace" }
  /** A selected video track played `secondsWithoutVideo` of clock with no frame. */
  | {
      readonly kind: "not-decoding";
      readonly secondsWithoutVideo: number;
      readonly codec?: string;
    };

export type PlaybackOutputGate = {
  /** Feed every accepted sample. */
  observe(sample: PlayerStatsSample): PlaybackOutputGateStep;
  /**
   * Feed the sample after the direct read a `verify` step asked for.
   * `answered` is false when the read itself failed (timeout, closed socket).
   */
  afterVerify(
    sample: PlayerStatsSample,
    reason: "first-clock" | "grace",
    answered: boolean,
  ): PlaybackOutputGateStep;
  /** True once playback is confirmed; progress events wait for this. */
  readonly started: boolean;
};

/** One gate per playback cycle (file). */
export function createPlaybackOutputGate(
  graceSeconds: number = VIDEO_DECODE_GRACE_SECONDS,
): PlaybackOutputGate {
  let started = false;
  let firstClockSeconds: number | null = null;
  let firstClockVerifyIssued = false;
  let graceVerifyIssued = false;
  let concluded = false;

  const start = (readiness: Exclude<PlaybackOutputReadiness, "awaiting-video">) => {
    started = true;
    return { kind: "start", readiness } as const;
  };

  return {
    get started() {
      return started;
    },
    observe(sample) {
      if (started || concluded || !(sample.positionSeconds > 0)) return { kind: "none" };
      const readiness = readPlaybackOutputReadiness(sample);
      if (readiness === "decoded-video" || readiness === "audio-only") return start(readiness);
      firstClockSeconds ??= sample.positionSeconds;
      // Unverified or awaiting: ask mpv once before deciding either way.
      if (!firstClockVerifyIssued) {
        firstClockVerifyIssued = true;
        return { kind: "verify", reason: "first-clock" };
      }
      if (
        readiness === "awaiting-video" &&
        !graceVerifyIssued &&
        sample.positionSeconds - firstClockSeconds >= graceSeconds
      ) {
        graceVerifyIssued = true;
        return { kind: "verify", reason: "grace" };
      }
      return { kind: "none" };
    },
    afterVerify(sample, reason, answered) {
      if (started || concluded) return { kind: "none" };
      const readiness = readPlaybackOutputReadiness(sample);
      // Still no track evidence after asking (or no answer): the clock
      // decides, exactly as before this gate existed.
      if (readiness !== "awaiting-video") return start(readiness);
      if (reason !== "grace" || !answered) return { kind: "none" };
      concluded = true;
      const codec = readSelectedVideoTrack(sample.trackList)?.codec;
      const secondsWithoutVideo = Math.round(
        Math.max(0, sample.positionSeconds - (firstClockSeconds ?? sample.positionSeconds)),
      );
      return codec
        ? { kind: "not-decoding", secondsWithoutVideo, codec }
        : { kind: "not-decoding", secondsWithoutVideo };
    },
  };
}

/** The player event a `not-decoding` step becomes, shared by both mpv emitters. */
export function videoNotDecodingEvent(
  step: Extract<PlaybackOutputGateStep, { kind: "not-decoding" }>,
): Extract<PlayerPlaybackEvent, { type: "video-not-decoding" }> {
  return step.codec
    ? {
        type: "video-not-decoding",
        secondsWithoutVideo: step.secondsWithoutVideo,
        codec: step.codec,
      }
    : { type: "video-not-decoding", secondsWithoutVideo: step.secondsWithoutVideo };
}

/** What a direct read found about the output and the selected tracks. */
export type MpvVideoOutputRead = {
  readonly videoOutParams: { readonly w: number; readonly h: number } | undefined;
  readonly voConfigured: boolean;
  /** mpv's `track-list`, or undefined when mpv had none to give. */
  readonly trackList: readonly JsonValue[] | undefined;
};

/**
 * Read `video-out-params`, `vo-configured` and `track-list` straight from mpv.
 *
 * mpv answers "property unavailable" when a property has no value (no frame
 * yet), and that is evidence. Any other failure — timeout, closed socket — is
 * not: it returns null so the gate concludes nothing.
 */
export async function readMpvVideoOutput(
  ipc: Pick<MpvIpcSession, "send"> | null,
): Promise<MpvVideoOutputRead | null> {
  if (!ipc) return null;
  const [params, configured, tracks] = await Promise.all([
    ipc.send(["get_property", "video-out-params"]),
    ipc.send(["get_property", "vo-configured"]),
    ipc.send(["get_property", "track-list"]),
  ]);
  const answered = (result: MpvIpcCommandResult) => result.ok || isMpvPropertyUnavailable(result);
  if (!answered(params) || !answered(configured) || !answered(tracks)) return null;
  return {
    videoOutParams: params.ok ? readVideoOutParams(params.response.data) : undefined,
    voConfigured: configured.ok && configured.response.data === true,
    trackList: tracks.ok && Array.isArray(tracks.response.data) ? tracks.response.data : undefined,
  };
}

/** Fold a direct read into the cycle's stats, as if mpv had sent the events. */
export function applyVideoOutputRead(stats: PlayerStatsState, read: MpvVideoOutputRead): void {
  const observedAt = Date.now();
  const accept = { acceptPlaybackProperties: true };
  applyObservedPropertySample(
    stats,
    { name: "video-out-params", value: read.videoOutParams, observedAt },
    accept,
  );
  applyObservedPropertySample(
    stats,
    { name: "vo-configured", value: read.voConfigured, observedAt },
    accept,
  );
  if (read.trackList) {
    applyObservedPropertySample(
      stats,
      { name: "track-list", value: read.trackList, observedAt },
      accept,
    );
  }
}

export type PlaybackOutputDriver = {
  /** Feed every accepted sample of this cycle. */
  observe(sample: PlayerStatsSample): void;
  /** True once playback is confirmed; progress events wait for this. */
  readonly started: boolean;
};

/** The events a driver emits: `playback-started` once, or `video-not-decoding`. */
export type PlaybackOutputEvent = Extract<
  PlayerPlaybackEvent,
  { type: "playback-started" } | { type: "video-not-decoding" }
>;

/**
 * Runs one cycle's gate: turns its steps into a direct read, `playback-started`
 * or `video-not-decoding`. The one loop both mpv emitters share. The gate
 * starts at most once, so `playback-started` needs no guard at the caller.
 */
export function createPlaybackOutputDriver(input: {
  readonly gate?: PlaybackOutputGate;
  readonly stats: PlayerStatsState;
  readonly readVideoOutput: () => Promise<MpvVideoOutputRead | null>;
  /** False once the cycle was replaced or ended: a late read is then dropped. */
  readonly isCurrent: () => boolean;
  readonly emit: (event: PlaybackOutputEvent) => void;
}): PlaybackOutputDriver {
  const gate = input.gate ?? createPlaybackOutputGate();
  const apply = (step: PlaybackOutputGateStep): void => {
    if (step.kind === "start") input.emit({ type: "playback-started" });
    else if (step.kind === "not-decoding") input.emit(videoNotDecodingEvent(step));
    else if (step.kind === "verify") void verify(step.reason);
  };
  const verify = async (reason: "first-clock" | "grace"): Promise<void> => {
    const read = await input.readVideoOutput();
    if (!input.isCurrent()) return;
    if (read) applyVideoOutputRead(input.stats, read);
    const sample = input.stats.latestIpcSample;
    if (sample) apply(gate.afterVerify(sample, reason, read !== null));
  };
  return {
    observe: (sample) => apply(gate.observe(sample)),
    get started() {
      return gate.started;
    },
  };
}
