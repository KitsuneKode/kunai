import { describe, expect, test } from "bun:test";

import {
  transitionPlaybackStatus,
  type PlaybackStatusDecision,
  type PlaybackStatusSignal,
  type PlaybackStatusSnapshot,
} from "@/app/playback/playback-status-policy";
import { runMpvPlaybackSession } from "@/app/playback/run-mpv-playback-session";
import { INITIAL_PLAYBACK_GENERATION } from "@/domain/playback/playback-generation";
import type { EpisodeInfo, PlaybackResult, StreamInfo, TitleInfo } from "@/domain/types";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerService,
} from "@/infra/player/PlayerService";

const TITLE: TitleInfo = { id: "1396", name: "Test", type: "series" };
const EPISODE: EpisodeInfo = { season: 1, episode: 1 };
const STREAM: StreamInfo = {
  url: "https://example.test/stream.m3u8",
  headers: {},
  timestamp: Date.now(),
};

const FINISHED: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 10,
  duration: 10,
  lastNonZeroPositionSeconds: 10,
  lastNonZeroDurationSeconds: 10,
  playerExitCode: 0,
  playerExitSignal: null,
};

const GEN_1 = { process: 1, cycle: 1 } as const;
const GEN_2 = { process: 1, cycle: 2 } as const;

/**
 * A real policy-backed status store: the point of these tests is the wiring
 * between the session loop and the policy, so the policy itself is not faked.
 */
function createStatusStore() {
  let snapshot: PlaybackStatusSnapshot = {
    status: "loading",
    generation: INITIAL_PLAYBACK_GENERATION,
  };
  const writes: PlaybackStatusSnapshot[] = [];
  const clearFeedbackWrites: boolean[] = [];

  return {
    get snapshot() {
      return snapshot;
    },
    writes,
    clearFeedbackWrites,
    apply(signal: PlaybackStatusSignal): PlaybackStatusDecision {
      const decision = transitionPlaybackStatus(snapshot, signal);
      if (decision.accepted && decision.statusChanged) {
        snapshot = decision.snapshot;
        writes.push(decision.snapshot);
        clearFeedbackWrites.push(decision.clearFeedback);
      }
      return decision;
    },
  };
}

type Emit = (event: PlayerPlaybackEvent, generation?: { process: number; cycle: number }) => void;

type Harness = {
  readonly store: ReturnType<typeof createStatusStore>;
  /** State at the moment mpv returned, before the completion signal is applied. */
  readonly beforeCompletion: {
    readonly snapshot: PlaybackStatusSnapshot;
    readonly writes: readonly PlaybackStatusSnapshot[];
    readonly clearFeedbackWrites: readonly boolean[];
  };
  readonly presence: string[];
  readonly presenceSnapshots: PlaybackStatusSnapshot[];
  readonly feedback: unknown[];
  readonly tracks: PlayerPlaybackEvent[];
  readonly confirmedStarts: number;
  readonly result: PlaybackResult;
};

async function runSession(
  script: (emit: Emit, store: ReturnType<typeof createStatusStore>) => void,
  options: {
    readonly result?: PlaybackResult;
    readonly activation?: { process: number; cycle: number };
  } = {},
): Promise<Harness> {
  const store = createStatusStore();
  const presence: string[] = [];
  const presenceSnapshots: PlaybackStatusSnapshot[] = [];
  const feedback: unknown[] = [];
  const tracks: PlayerPlaybackEvent[] = [];
  let confirmedStarts = 0;
  const activation = options.activation ?? GEN_1;

  let beforeCompletion: Harness["beforeCompletion"] = {
    snapshot: store.snapshot,
    writes: [],
    clearFeedbackWrites: [],
  };

  const player: PlayerService = {
    play: async (_stream, playOptions: PlayerOptions) => {
      playOptions.onGenerationActivated?.(activation);
      script(
        (event, generation) =>
          playOptions.onPlaybackEvent?.({ generation: generation ?? activation, event }),
        store,
      );
      beforeCompletion = {
        snapshot: store.snapshot,
        writes: [...store.writes],
        clearFeedbackWrites: [...store.clearFeedbackWrites],
      };
      return options.result ?? FINISHED;
    },
    releasePersistentSession: async () => undefined,
    killActiveMpvProcessesSync: () => undefined,
    beginShutdown: () => undefined,
    isAvailable: async () => true,
    playLocal: async () => FINISHED,
  };

  const record =
    (name: string) =>
    (input: { snapshot?: PlaybackStatusSnapshot } = {}) => {
      presence.push(name);
      if (input.snapshot) presenceSnapshots.push(input.snapshot);
    };

  const result = await runMpvPlaybackSession({
    stream: STREAM,
    title: TITLE,
    episode: EPISODE,
    player,
    playOptions: {},
    subtitleStatus: "none",
    startAt: 0,
    sessionAborted: false,
    iterationAborted: false,
    shareLinkContext: {
      mode: "series",
      title: TITLE,
      episode: { season: 1, episode: 1 },
    },
    timing: null,
    hooks: {
      onFeedback: (update) => feedback.push(update),
      onPresenceLaunch: () => presence.push("launch"),
      onPresenceStarted: record("started"),
      onPresenceProgress: record("progress"),
      onPresenceSubtitles: record("subtitles"),
      onPresencePaused: record("paused"),
      onPresenceResumed: record("resumed"),
      applyPlaybackStatusSignal: (signal) => store.apply(signal),
      onTrackChanged: (event) => tracks.push(event),
      onShareCopied: () => undefined,
      onPlayerReady: () => undefined,
      onConfirmedPlaybackStart: () => {
        confirmedStarts += 1;
      },
    },
  });

  return {
    store,
    beforeCompletion,
    presence,
    presenceSnapshots,
    feedback,
    tracks,
    confirmedStarts,
    result,
  };
}

describe("runMpvPlaybackSession queue acknowledgement boundary", () => {
  test("mpv process start does not acknowledge", async () => {
    const harness = await runSession((emit) => emit({ type: "mpv-process-started" }));
    expect(harness.confirmedStarts).toBe(0);
  });

  test("ipc-connected does not acknowledge", async () => {
    const harness = await runSession((emit) => emit({ type: "ipc-connected" }));
    expect(harness.confirmedStarts).toBe(0);
  });

  test("playback-started acknowledges once", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "playback-started" });
    });
    expect(harness.confirmedStarts).toBe(1);
  });
});

describe("runMpvPlaybackSession generation activation", () => {
  test("activation writes the generation before any player event", async () => {
    const harness = await runSession(() => undefined, { activation: GEN_2 });
    expect(harness.store.writes[0]).toEqual({ status: "loading", generation: GEN_2 });
  });
});

describe("runMpvPlaybackSession degraded-state recovery", () => {
  test("started → buffering → progress ends playing and clears feedback", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "network-buffering", percent: 12 });
      emit({ type: "playback-progress", positionSeconds: 5, durationSeconds: 100 });
    });

    expect(harness.beforeCompletion.snapshot).toEqual({ status: "playing", generation: GEN_1 });
    expect(harness.beforeCompletion.clearFeedbackWrites.at(-1)).toBe(true);
  });

  test("started → stream-stalled → progress recovers", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "stream-stalled", secondsWithoutProgress: 12 });
      emit({ type: "playback-progress", positionSeconds: 8, durationSeconds: 100 });
    });
    expect(harness.beforeCompletion.snapshot.status).toBe("playing");
  });

  test("started → seek-stalled → progress recovers", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "seek-stalled", secondsSeeking: 6 });
      emit({ type: "playback-progress", positionSeconds: 400, durationSeconds: 1000 });
    });
    expect(harness.beforeCompletion.snapshot.status).toBe("playing");
  });

  test("repeated playing progress updates presence without duplicate status writes", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "playback-progress", positionSeconds: 1, durationSeconds: 100 });
      emit({ type: "playback-progress", positionSeconds: 2, durationSeconds: 100 });
      emit({ type: "playback-progress", positionSeconds: 3, durationSeconds: 100 });
    });

    expect(harness.presence.filter((entry) => entry === "progress")).toHaveLength(3);
    // activate(loading) + playing. Progress in `playing` must not write again.
    expect(harness.beforeCompletion.writes.map((write) => write.status)).toEqual([
      "loading",
      "playing",
    ]);
  });
});

describe("runMpvPlaybackSession pause authority", () => {
  test("progress while paused stays paused and does not update presence", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "playback-paused" });
      emit({ type: "playback-progress", positionSeconds: 10, durationSeconds: 100 });
      emit({ type: "playback-progress", positionSeconds: 11, durationSeconds: 100 });
      emit({ type: "playback-started" });
    });

    expect(harness.beforeCompletion.snapshot.status).toBe("paused");
    expect(harness.presence.filter((entry) => entry === "progress")).toHaveLength(0);
  });

  test("resume returns to playing and emits resumed presence with the playing snapshot", async () => {
    const harness = await runSession((emit) => {
      emit({ type: "playback-started" });
      emit({ type: "playback-paused" });
      emit({ type: "playback-resumed" });
    });

    expect(harness.beforeCompletion.snapshot.status).toBe("playing");
    expect(harness.presence).toContain("resumed");
    expect(harness.presenceSnapshots.at(-1)).toEqual({ status: "playing", generation: GEN_1 });
  });
});

describe("runMpvPlaybackSession stale-generation rejection", () => {
  test("old-cycle work after a replacement activation cannot touch status, presence, or tracks", async () => {
    const harness = await runSession((emit, store) => {
      emit({ type: "playback-started" });
      // A replacement cycle activates and takes the session over.
      store.apply({ kind: "activate", generation: GEN_2, status: "loading" });
      // Everything below still carries the retired GEN_1.
      emit({ type: "playback-progress", positionSeconds: 9, durationSeconds: 90 });
      emit({ type: "track-changed", trackType: "sub", id: 0 });
      emit({ type: "playback-paused" });
      emit({ type: "late-subtitles-attached", trackCount: 3 });
    });

    expect(harness.beforeCompletion.snapshot).toEqual({ status: "loading", generation: GEN_2 });
    expect(harness.presence.filter((entry) => entry === "progress")).toHaveLength(0);
    expect(harness.presence).not.toContain("paused");
    expect(harness.presence).not.toContain("subtitles");
    expect(harness.tracks).toEqual([]);
  });

  test("a stale completion cannot overwrite the replacement", async () => {
    const harness = await runSession((emit, store) => {
      emit({ type: "playback-started" });
      store.apply({ kind: "activate", generation: GEN_2, status: "loading" });
    });
    expect(harness.store.snapshot).toEqual({ status: "loading", generation: GEN_2 });
  });

  test("a stale event cannot acknowledge the queue", async () => {
    const harness = await runSession((emit, store) => {
      store.apply({ kind: "activate", generation: GEN_2, status: "loading" });
      emit({ type: "playback-started" });
    });
    expect(harness.confirmedStarts).toBe(0);
  });
});

describe("runMpvPlaybackSession completion", () => {
  test("eof completes as finished after the result is final", async () => {
    const harness = await runSession(() => undefined, { result: FINISHED });
    expect(harness.store.snapshot.status).toBe("finished");
  });

  test("a quit result completes as idle and late progress cannot revive it", async () => {
    const captured: Emit[] = [];
    const harness = await runSession(
      (emit) => {
        captured.push(emit);
        emit({ type: "playback-started" });
      },
      { result: { ...FINISHED, endReason: "quit" } },
    );

    expect(harness.store.snapshot.status).toBe("idle");
    captured[0]?.({ type: "playback-progress", positionSeconds: 40, durationSeconds: 100 });
    expect(harness.store.snapshot.status).toBe("idle");
  });

  test("an error result completes as error rather than finished", async () => {
    const harness = await runSession(() => undefined, {
      result: { ...FINISHED, endReason: "error" },
    });
    expect(harness.store.snapshot.status).toBe("error");
  });
});
