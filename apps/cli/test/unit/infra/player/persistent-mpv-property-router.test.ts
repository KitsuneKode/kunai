import { describe, expect, test } from "bun:test";

import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { createPlayerStatsState } from "@/infra/player/mpv-stats";
import {
  PersistentMpvPropertyRouter,
  type PersistentMpvPropertyCycle,
} from "@/infra/player/persistent-mpv-property-router";
import { PersistentSubtitleManager } from "@/infra/player/persistent-subtitle-manager";
import {
  createPlaybackOutputDriver,
  type MpvVideoOutputRead,
} from "@/infra/player/playback-output-gate";

/** A cycle wired the way the session wires it: its own driver and gate. */
function withOutput(
  base: Omit<PersistentMpvPropertyCycle, "output">,
  read: () => Promise<MpvVideoOutputRead | null> = async () => null,
  isCurrent: () => boolean = () => true,
): PersistentMpvPropertyCycle {
  const cycle: PersistentMpvPropertyCycle = {
    ...base,
    output: createPlaybackOutputDriver({
      stats: base.stats,
      readVideoOutput: read,
      isCurrent,
      emit: (event) => cycle.onPlaybackEvent?.(event),
    }),
  };
  return cycle;
}

function createFakeIpc(): { ipc: MpvIpcSession; commands: readonly unknown[][] } {
  const commands: unknown[][] = [];
  const ipc: MpvIpcSession = {
    async send(command) {
      commands.push([...command]);
      return {
        ok: true,
        command,
        requestId: commands.length,
        response: {},
      } satisfies MpvIpcCommandResult;
    },
    sendUnchecked(command) {
      commands.push([...command]);
    },
    async close() {},
  };
  return { ipc, commands };
}

describe("PersistentMpvPropertyRouter", () => {
  test("updates subtitle cache before the active cycle accepts playback properties", () => {
    const subtitleManager = new PersistentSubtitleManager();
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () =>
        withOutput({
          stats: createPlayerStatsState("/tmp/kunai-test.sock"),
          acceptPlaybackProperties: false,
          playerReadyNotified: false,
          lastPlaybackProgressEventAtMs: 0,
          lastPlaybackProgressPositionSeconds: -1,
          lastPlaybackProgressDurationSeconds: 0,
        }),
      getIpcSession: () => null,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager,
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: () => {},
      handleCopyShareFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: () => {},
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => 0,
      maybeEmitPlaybackProgress: () => {},
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: () => {},
    });

    router.handlePropertyUpdate({
      name: "track-list",
      value: [{ id: 42, type: "sub", external: true }],
      observedAt: 1,
    });

    expect(subtitleManager.cachedExternalSubtitleIds()).toEqual([42]);
  });

  test("routes mpv Lua action requests and clears the user-data property", () => {
    const { ipc, commands } = createFakeIpc();
    const actions: string[] = [];
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => null,
      getIpcSession: () => ipc,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: (action) => actions.push(action),
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: () => {},
      handleCopyShareFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: () => {},
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => 0,
      maybeEmitPlaybackProgress: () => {},
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: () => {},
    });

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "quality",
      observedAt: 1,
    });

    expect(actions).toEqual(["pick-quality"]);
    expect(commands).toContainEqual(["set_property", "user-data/kunai-request", ""]);

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "source",
      observedAt: 2,
    });
    expect(actions).toEqual(["pick-quality", "pick-source"]);

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "cycle-source",
      observedAt: 3,
    });
    expect(actions).toEqual(["pick-quality", "pick-source", "cycle-source"]);

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "cycle-audio",
      observedAt: 4,
    });
    expect(actions).toEqual(["pick-quality", "pick-source", "cycle-source", "cycle-audio"]);
  });

  test("forwards key:<binding id> help-key requests and ignores malformed ones", () => {
    const { ipc, commands } = createFakeIpc();
    const keys: string[] = [];
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => null,
      getIpcSession: () => ipc,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: (id) => keys.push(id),
      handleCopyShareFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: () => {},
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => 0,
      maybeEmitPlaybackProgress: () => {},
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: () => {},
    });

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "key:player-autoplay",
      observedAt: 1,
    });
    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "key:../../etc",
      observedAt: 2,
    });

    expect(keys).toEqual(["player-autoplay"]);
    expect(commands).toContainEqual(["set_property", "user-data/kunai-request", ""]);
  });

  test("accepts playback samples, updates position, and emits ready/start progress hooks", async () => {
    const events: unknown[] = [];
    let currentPosition = 0;
    const activeCycle = withOutput({
      stats: createPlayerStatsState("/tmp/kunai-test.sock"),
      acceptPlaybackProperties: true,
      playerReadyNotified: false,
      lastPlaybackProgressEventAtMs: 0,
      lastPlaybackProgressPositionSeconds: -1,
      lastPlaybackProgressDurationSeconds: 0,
      onPlaybackEvent: (event) => events.push(event),
    });
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => activeCycle,
      getIpcSession: () => null,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: () => {},
      handleCopyShareFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: (value) => {
        currentPosition = value;
      },
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => currentPosition,
      maybeEmitPlaybackProgress: (cycle, observedAt) => {
        events.push({ type: "progress-hook", observedAt, sample: cycle.stats.latestIpcSample });
      },
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: (sample) => {
        events.push({ type: "watchdog", positionSeconds: sample.positionSeconds });
      },
    });

    router.handlePropertyUpdate({ name: "duration", value: 600, observedAt: 1 });
    router.handlePropertyUpdate({ name: "time-pos", value: 30, observedAt: 2 });
    // No track list yet: start waits for the direct read (which finds none).
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    router.handlePropertyUpdate({ name: "time-pos", value: 31, observedAt: 3 });

    expect(currentPosition).toBe(31);
    expect(events).toContainEqual({ type: "playback-started" });
    expect(events).toContainEqual({
      type: "watchdog",
      positionSeconds: 30,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "progress-hook",
        observedAt: 3,
      }),
    );
  });

  describe("decoded-video readiness", () => {
    const VIDEO_TRACKS = [{ id: 1, type: "video", selected: true, codec: "hevc" }];

    function readinessHarness(read: () => Promise<MpvVideoOutputRead | null>) {
      const events: unknown[] = [];
      let current = true;
      const active = withOutput(
        {
          stats: createPlayerStatsState("/tmp/kunai-test.sock"),
          acceptPlaybackProperties: true,
          playerReadyNotified: false,
          lastPlaybackProgressEventAtMs: 0,
          lastPlaybackProgressPositionSeconds: -1,
          lastPlaybackProgressDurationSeconds: 0,
          onPlaybackEvent: (event) => events.push(event),
        },
        read,
        () => current,
      );
      let position = 0;
      const router = new PersistentMpvPropertyRouter({
        getActiveCycle: () => active,
        getIpcSession: () => null,
        getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
        subtitleManager: new PersistentSubtitleManager(),
        notifyMpvActionRequest: () => {},
        finishResumeChoiceWait: () => {},
        handleResumeSeekFromMpv: async () => {},
        notifyMpvKeyRequest: () => {},
        handleCopyShareFromMpv: async () => {},
        onSkipRequestFromMpv: async () => {},
        setCurrentPositionSeconds: (value) => {
          position = value;
        },
        maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
        getCurrentPositionSeconds: () => position,
        maybeEmitPlaybackProgress: () => {
          events.push({ type: "progress-hook" });
        },
        handleSegmentSkipProgress: async () => {},
        fireNearEofIfNeeded: () => {},
        observeWatchdog: () => {},
      });
      const clock = (seconds: number) =>
        router.handlePropertyUpdate({ name: "time-pos", value: seconds, observedAt: seconds });
      return {
        events,
        router,
        clock,
        replaceCycle: () => {
          current = false;
        },
      };
    }

    // Lets the router's direct read and its follow-up settle.
    const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

    test("a clock without frames neither starts playback nor records progress", async () => {
      const h = readinessHarness(async () => ({
        videoOutParams: undefined,
        voConfigured: false,
        trackList: VIDEO_TRACKS,
      }));
      h.router.handlePropertyUpdate({ name: "track-list", value: VIDEO_TRACKS, observedAt: 0 });
      h.clock(1);
      h.clock(5);
      await settle();
      expect(h.events).not.toContainEqual({ type: "playback-started" });
      expect(h.events).not.toContainEqual({ type: "progress-hook" });
    });

    test("a direct read that finds a frame starts playback", async () => {
      const h = readinessHarness(async () => ({
        videoOutParams: { w: 1920, h: 1080 },
        voConfigured: true,
        trackList: VIDEO_TRACKS,
      }));
      h.router.handlePropertyUpdate({ name: "track-list", value: VIDEO_TRACKS, observedAt: 0 });
      h.clock(600);
      await settle();
      expect(h.events).toContainEqual({ type: "playback-started" });
      h.clock(601);
      expect(h.events).toContainEqual({ type: "progress-hook" });
    });

    test("a clock that arrives before the track list does not start playback", async () => {
      // Cold start: mpv reported time-pos before track-list. The direct read
      // returns the video track with no frame, so the gate keeps holding.
      const h = readinessHarness(async () => ({
        videoOutParams: undefined,
        voConfigured: false,
        trackList: VIDEO_TRACKS,
      }));
      h.clock(0.2);
      await settle();
      h.clock(1);
      expect(h.events).not.toContainEqual({ type: "playback-started" });
      expect(h.events).not.toContainEqual({ type: "progress-hook" });
    });

    test("ten clock seconds without a frame report video-not-decoding with the codec", async () => {
      const h = readinessHarness(async () => ({
        videoOutParams: undefined,
        voConfigured: false,
        trackList: VIDEO_TRACKS,
      }));
      h.router.handlePropertyUpdate({ name: "track-list", value: VIDEO_TRACKS, observedAt: 0 });
      h.clock(1);
      await settle();
      h.clock(11);
      await settle();
      expect(h.events).toContainEqual({
        type: "video-not-decoding",
        secondsWithoutVideo: 10,
        codec: "hevc",
      });
      expect(h.events).not.toContainEqual({ type: "playback-started" });
    });

    test("a failed read concludes nothing, and a read for a replaced cycle is dropped", async () => {
      const failing = readinessHarness(async () => null);
      failing.router.handlePropertyUpdate({
        name: "track-list",
        value: VIDEO_TRACKS,
        observedAt: 0,
      });
      failing.clock(1);
      await settle();
      failing.clock(11);
      await settle();
      expect(failing.events).not.toContainEqual(
        expect.objectContaining({ type: "video-not-decoding" }),
      );

      const replaced = readinessHarness(async () => ({
        videoOutParams: { w: 2, h: 2 },
        voConfigured: true,
        trackList: VIDEO_TRACKS,
      }));
      replaced.router.handlePropertyUpdate({
        name: "track-list",
        value: VIDEO_TRACKS,
        observedAt: 0,
      });
      replaced.clock(1);
      replaced.replaceCycle();
      await settle();
      expect(replaced.events).not.toContainEqual({ type: "playback-started" });
    });
  });

  test("routes mpv copy-share requests and clears the user-data property", async () => {
    const { ipc, commands } = createFakeIpc();
    let copied = false;
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => null,
      getIpcSession: () => ipc,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: () => {},
      handleCopyShareFromMpv: async () => {
        copied = true;
      },
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: () => {},
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => 83,
      maybeEmitPlaybackProgress: () => {},
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: () => {},
    });

    router.handlePropertyUpdate({
      name: "user-data/kunai-request",
      value: "copy-share",
      observedAt: 1,
    });
    await nextTurn();

    expect(copied).toBe(true);
    expect(commands).toContainEqual(["set_property", "user-data/kunai-request", ""]);
  });

  test("emits track-changed for well-formed ids and drops malformed values", () => {
    const { ipc, commands } = createFakeIpc();
    const events: unknown[] = [];
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => null,
      getIpcSession: () => ipc,
      getCurrentOptions: () => ({
        displayTitle: "Episode",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event),
      }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      notifyMpvKeyRequest: () => {},
      handleCopyShareFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: () => {},
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => 0,
      maybeEmitPlaybackProgress: () => {},
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: () => {},
    });

    router.handlePropertyUpdate({
      name: "user-data/kunai-track-changed",
      value: "audio:2",
      observedAt: 1,
    });
    router.handlePropertyUpdate({
      name: "user-data/kunai-track-changed",
      value: "sub:0",
      observedAt: 2,
    });
    // Malformed values used to reach the note renderer as `id: NaN`.
    for (const value of ["audio:", "audio:abc", "sub:", "nonsense", "", "audio:-1"]) {
      router.handlePropertyUpdate({
        name: "user-data/kunai-track-changed",
        value,
        observedAt: 3,
      });
    }

    expect(events).toEqual([
      { type: "track-changed", trackType: "audio", id: 2 },
      { type: "track-changed", trackType: "sub", id: 0 },
    ]);
    // The property is cleared once per observed value either way.
    const clears = commands.filter((command) => command[1] === "user-data/kunai-track-changed");
    expect(clears).toHaveLength(8);
  });
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
