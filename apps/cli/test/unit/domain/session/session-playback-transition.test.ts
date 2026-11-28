import { describe, expect, test } from "bun:test";

import type { PlaybackFailoverNotice } from "@/domain/playback/playback-failover-notice";
import { createInitialState, reduceState, type SessionState } from "@/domain/session/SessionState";

const profiles = {
  anime: { audio: "original", subtitle: "en" },
  series: { audio: "original", subtitle: "none" },
  movie: { audio: "original", subtitle: "en" },
} as const;

function session(): SessionState {
  return createInitialState("vidking", "allanime", profiles);
}

const midStream: PlaybackFailoverNotice = {
  phase: "mid-stream",
  fromLabel: "VidKing",
  toLabel: "Rivestream",
  preservedSeconds: 14 * 60 + 22,
  tone: "warn",
};

const startupError: PlaybackFailoverNotice = {
  phase: "startup",
  fromLabel: "VidKing",
  toLabel: null,
  preservedSeconds: null,
  tone: "error",
};

describe("playback failover notice lifetime", () => {
  test("a mid-stream notice clears on the next transition to playing", () => {
    let state = reduceState(session(), { type: "SET_PLAYBACK_STATUS", status: "loading" });
    state = reduceState(state, { type: "SET_PLAYBACK_FAILOVER", failover: midStream });
    expect(state.playbackFailover).toEqual(midStream);

    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "buffering" });
    expect(state.playbackFailover).toEqual(midStream);

    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "playing" });
    expect(state.playbackFailover).toBeNull();
    expect(state.failoverAwaitingPlayback).toBe(false);
  });

  test("a mid-stream notice published while already playing survives that dispatch", () => {
    let state = reduceState(session(), { type: "SET_PLAYBACK_STATUS", status: "playing" });
    state = reduceState(state, { type: "SET_PLAYBACK_FAILOVER", failover: midStream });

    expect(state.playbackStatus).toBe("playing");
    expect(state.playbackFailover).toEqual(midStream);
    expect(state.failoverAwaitingPlayback).toBe(true);

    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "playing" });
    expect(state.playbackFailover).toBeNull();
    expect(state.failoverAwaitingPlayback).toBe(false);
  });

  test("a startup error notice stays across playing until playback leaves", () => {
    let state = reduceState(session(), { type: "SET_PLAYBACK_FAILOVER", failover: startupError });
    expect(state.failoverAwaitingPlayback).toBe(false);

    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "playing" });
    expect(state.playbackFailover).toEqual(startupError);

    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "idle" });
    expect(state.playbackFailover).toBeNull();
    expect(state.failoverAwaitingPlayback).toBe(false);
  });
});
