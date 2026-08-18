import { describe, expect, test } from "bun:test";

import {
  transitionPlaybackStatus,
  type PlaybackStatusSnapshot,
} from "@/app/playback/playback-status-policy";
import {
  INITIAL_PLAYBACK_GENERATION,
  isPlaybackGenerationAfter,
  isSamePlaybackGeneration,
  type PlaybackGeneration,
} from "@/domain/playback/playback-generation";
import { createInitialState, reduceState } from "@/domain/session/SessionState";

const GEN: PlaybackGeneration = { process: 2, cycle: 7 };

function snapshot(
  status: PlaybackStatusSnapshot["status"],
  generation: PlaybackGeneration = GEN,
): PlaybackStatusSnapshot {
  return { status, generation };
}

describe("playback generation comparison", () => {
  test("initial generation is process 0 / cycle 0", () => {
    expect(INITIAL_PLAYBACK_GENERATION).toEqual({ process: 0, cycle: 0 });
  });

  test("same generation compares equal", () => {
    expect(isSamePlaybackGeneration({ process: 1, cycle: 2 }, { process: 1, cycle: 2 })).toBe(true);
    expect(isSamePlaybackGeneration({ process: 1, cycle: 2 }, { process: 1, cycle: 3 })).toBe(
      false,
    );
    expect(isSamePlaybackGeneration({ process: 1, cycle: 2 }, { process: 2, cycle: 2 })).toBe(
      false,
    );
  });

  test("comparison is lexicographic on process then cycle", () => {
    expect(isPlaybackGenerationAfter({ process: 2, cycle: 0 }, { process: 1, cycle: 99 })).toBe(
      true,
    );
    expect(isPlaybackGenerationAfter({ process: 1, cycle: 99 }, { process: 2, cycle: 0 })).toBe(
      false,
    );
    expect(isPlaybackGenerationAfter({ process: 1, cycle: 3 }, { process: 1, cycle: 2 })).toBe(
      true,
    );
    expect(isPlaybackGenerationAfter({ process: 1, cycle: 2 }, { process: 1, cycle: 2 })).toBe(
      false,
    );
  });
});

describe("transitionPlaybackStatus — fresh progress recovery", () => {
  test.each(["buffering", "stalled", "seeking"] as const)(
    "fresh progress recovers %s",
    (status) => {
      const decision = transitionPlaybackStatus(snapshot(status), {
        kind: "player-event",
        generation: GEN,
        event: {
          type: "playback-progress",
          positionSeconds: 12,
          durationSeconds: 24,
        },
      });

      expect(decision).toEqual({
        accepted: true,
        snapshot: { status: "playing", generation: GEN },
        statusChanged: true,
        clearFeedback: true,
      });
    },
  );

  test.each(["paused", "idle", "finished", "error"] as const)(
    "fresh progress is rejected in %s",
    (status) => {
      const decision = transitionPlaybackStatus(snapshot(status), {
        kind: "player-event",
        generation: GEN,
        event: { type: "playback-progress", positionSeconds: 5, durationSeconds: 10 },
      });

      expect(decision.accepted).toBe(false);
      expect(decision.snapshot).toEqual(snapshot(status));
      expect(decision.statusChanged).toBe(false);
      expect(decision.clearFeedback).toBe(false);
    },
  );

  test("duplicate progress in playing is accepted without another status write", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "playback-progress", positionSeconds: 30, durationSeconds: 60 },
    });

    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(false);
    expect(decision.clearFeedback).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("playing"));
  });
});

describe("transitionPlaybackStatus — generation freshness", () => {
  test("an older cycle event is rejected", () => {
    const decision = transitionPlaybackStatus(snapshot("buffering", { process: 2, cycle: 8 }), {
      kind: "player-event",
      generation: { process: 2, cycle: 7 },
      event: { type: "playback-progress", positionSeconds: 1, durationSeconds: 2 },
    });

    expect(decision.accepted).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("buffering", { process: 2, cycle: 8 }));
  });

  test("an older process event is rejected", () => {
    const decision = transitionPlaybackStatus(snapshot("buffering", { process: 3, cycle: 1 }), {
      kind: "player-event",
      generation: { process: 2, cycle: 99 },
      event: { type: "playback-progress", positionSeconds: 1, durationSeconds: 2 },
    });

    expect(decision.accepted).toBe(false);
  });

  test("a newer-generation player event is rejected — activation is the only way in", () => {
    const decision = transitionPlaybackStatus(snapshot("playing", { process: 2, cycle: 7 }), {
      kind: "player-event",
      generation: { process: 2, cycle: 8 },
      event: { type: "playback-started" },
    });

    expect(decision.accepted).toBe(false);
  });

  test("activation accepts a strictly newer generation and writes loading", () => {
    const decision = transitionPlaybackStatus(snapshot("playing", { process: 2, cycle: 7 }), {
      kind: "activate",
      generation: { process: 2, cycle: 8 },
      status: "loading",
    });

    expect(decision).toEqual({
      accepted: true,
      snapshot: { status: "loading", generation: { process: 2, cycle: 8 } },
      statusChanged: true,
      clearFeedback: false,
    });
  });

  test("activation with the same generation is rejected", () => {
    const decision = transitionPlaybackStatus(snapshot("loading", GEN), {
      kind: "activate",
      generation: GEN,
      status: "loading",
    });

    expect(decision.accepted).toBe(false);
  });

  test("activation with an older generation is rejected", () => {
    const decision = transitionPlaybackStatus(snapshot("playing", { process: 3, cycle: 1 }), {
      kind: "activate",
      generation: { process: 2, cycle: 9 },
      status: "loading",
    });

    expect(decision.accepted).toBe(false);
  });

  test("an activation that keeps the same status still requests a write for the generation", () => {
    const decision = transitionPlaybackStatus(snapshot("loading", { process: 1, cycle: 1 }), {
      kind: "activate",
      generation: { process: 1, cycle: 2 },
      status: "loading",
    });

    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(true);
    expect(decision.snapshot).toEqual({ status: "loading", generation: { process: 1, cycle: 2 } });
  });
});

describe("transitionPlaybackStatus — pause is authoritative", () => {
  test("playback-paused enters paused from active playback", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "playback-paused" },
    });

    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(true);
    expect(decision.snapshot).toEqual(snapshot("paused"));
  });

  test("playback-started does not leave paused", () => {
    const decision = transitionPlaybackStatus(snapshot("paused"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "playback-started" },
    });

    expect(decision.accepted).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("paused"));
  });

  test("playback-resumed leaves paused", () => {
    const decision = transitionPlaybackStatus(snapshot("paused"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "playback-resumed" },
    });

    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(true);
    expect(decision.snapshot).toEqual(snapshot("playing"));
  });

  test("buffer stats while paused is accepted but cannot change status", () => {
    const decision = transitionPlaybackStatus(snapshot("paused"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "network-buffering", percent: 40 },
    });

    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("paused"));
  });
});

describe("transitionPlaybackStatus — degraded states", () => {
  test("network-buffering enters buffering", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "network-buffering", percent: 10 },
    });
    expect(decision.snapshot).toEqual(snapshot("buffering"));
  });

  test.each(["stream-stalled", "ipc-stalled"] as const)("%s enters stalled", (type) => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event:
        type === "stream-stalled"
          ? { type: "stream-stalled", secondsWithoutProgress: 9 }
          : { type: "ipc-stalled", command: "get_property", error: "timeout" },
    });
    expect(decision.snapshot).toEqual(snapshot("stalled"));
  });

  test("seek-stalled enters seeking", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "seek-stalled", secondsSeeking: 4 },
    });
    expect(decision.snapshot).toEqual(snapshot("seeking"));
  });

  test("player-ready enters ready from loading", () => {
    const decision = transitionPlaybackStatus(snapshot("loading"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "player-ready" },
    });
    expect(decision.snapshot).toEqual(snapshot("ready"));
  });

  test("player-ready cannot demote active playback", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "player-event",
      generation: GEN,
      event: { type: "player-ready" },
    });
    expect(decision.accepted).toBe(true);
    expect(decision.statusChanged).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("playing"));
  });

  test.each(["idle", "finished", "error"] as const)(
    "terminal %s rejects player events",
    (status) => {
      const decision = transitionPlaybackStatus(snapshot(status), {
        kind: "player-event",
        generation: GEN,
        event: { type: "playback-started" },
      });
      expect(decision.accepted).toBe(false);
    },
  );
});

describe("transitionPlaybackStatus — startup stall", () => {
  test("a current startup-stall enters stalled", () => {
    const decision = transitionPlaybackStatus(snapshot("loading"), {
      kind: "startup-stall",
      generation: GEN,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.snapshot).toEqual(snapshot("stalled"));
  });

  test("an old startup-stall cannot abort a replacement generation", () => {
    const decision = transitionPlaybackStatus(snapshot("playing", { process: 2, cycle: 8 }), {
      kind: "startup-stall",
      generation: { process: 2, cycle: 7 },
    });
    expect(decision.accepted).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("playing", { process: 2, cycle: 8 }));
  });
});

describe("transitionPlaybackStatus — completion", () => {
  test("eof completes as finished", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "completed",
      generation: GEN,
      endReason: "eof",
    });
    expect(decision.accepted).toBe(true);
    expect(decision.snapshot).toEqual(snapshot("finished"));
  });

  test("quit completes as idle", () => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "completed",
      generation: GEN,
      endReason: "quit",
    });
    expect(decision.snapshot).toEqual(snapshot("idle"));
  });

  test.each(["error", "unknown"] as const)("%s completes as error", (endReason) => {
    const decision = transitionPlaybackStatus(snapshot("playing"), {
      kind: "completed",
      generation: GEN,
      endReason,
    });
    expect(decision.snapshot).toEqual(snapshot("error"));
  });

  test("a late old completion cannot overwrite a replacement", () => {
    const decision = transitionPlaybackStatus(snapshot("playing", { process: 3, cycle: 1 }), {
      kind: "completed",
      generation: { process: 2, cycle: 9 },
      endReason: "eof",
    });
    expect(decision.accepted).toBe(false);
    expect(decision.snapshot).toEqual(snapshot("playing", { process: 3, cycle: 1 }));
  });

  test("completion into an already terminal status is rejected", () => {
    const decision = transitionPlaybackStatus(snapshot("idle"), {
      kind: "completed",
      generation: GEN,
      endReason: "eof",
    });
    expect(decision.accepted).toBe(false);
  });
});

function initialState() {
  return createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });
}

describe("SessionState playback generation", () => {
  test("initial state starts at the initial generation", () => {
    expect(initialState().playbackGeneration).toEqual(INITIAL_PLAYBACK_GENERATION);
  });

  test("an accepted activation writes status and generation atomically", () => {
    const next = reduceState(initialState(), {
      type: "SET_PLAYBACK_STATUS",
      status: "loading",
      generation: { process: 1, cycle: 1 },
    });

    expect(next.playbackStatus).toBe("loading");
    expect(next.playbackGeneration).toEqual({ process: 1, cycle: 1 });
  });

  test("a lifecycle dispatch that omits generation retains the current generation", () => {
    let state = reduceState(initialState(), {
      type: "SET_PLAYBACK_STATUS",
      status: "loading",
      generation: { process: 4, cycle: 9 },
    });
    state = reduceState(state, { type: "SET_PLAYBACK_STATUS", status: "idle" });

    expect(state.playbackStatus).toBe("idle");
    expect(state.playbackGeneration).toEqual({ process: 4, cycle: 9 });
  });

  test("clearFeedback clears detail and note while preserving playbackProblem", () => {
    let state = reduceState(initialState(), {
      type: "SET_PLAYBACK_STATUS",
      status: "buffering",
      generation: { process: 1, cycle: 1 },
    });
    state = reduceState(state, {
      type: "SET_PLAYBACK_FEEDBACK",
      detail: "Buffering…",
      note: "slow network",
    });
    state = reduceState(state, {
      type: "SET_PLAYBACK_PROBLEM",
      problem: {
        stage: "provider-resolve",
        severity: "recoverable",
        cause: "provider-fallback",
        userMessage: "Trying another source",
        recommendedAction: "try-next-provider",
        secondaryActions: ["diagnostics"],
      },
    });

    const recovered = reduceState(state, {
      type: "SET_PLAYBACK_STATUS",
      status: "playing",
      generation: { process: 1, cycle: 1 },
      clearFeedback: true,
    });

    expect(recovered.playbackDetail).toBeNull();
    expect(recovered.playbackNote).toBeNull();
    expect(recovered.playbackProblem).toEqual(state.playbackProblem);
  });

  test("a status write without clearFeedback keeps active-state feedback", () => {
    let state = reduceState(initialState(), {
      type: "SET_PLAYBACK_STATUS",
      status: "playing",
      generation: { process: 1, cycle: 1 },
    });
    state = reduceState(state, {
      type: "SET_PLAYBACK_FEEDBACK",
      detail: "Playing",
      note: "1080p",
    });
    const next = reduceState(state, {
      type: "SET_PLAYBACK_STATUS",
      status: "buffering",
      generation: { process: 1, cycle: 1 },
    });

    expect(next.playbackDetail).toBe("Playing");
    expect(next.playbackNote).toBe("1080p");
  });
});
