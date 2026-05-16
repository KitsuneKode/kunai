import { describe, expect, test } from "bun:test";

import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { createPlayerTelemetryState } from "@/infra/player/mpv-telemetry";
import { PersistentMpvPropertyRouter } from "@/infra/player/persistent-mpv-property-router";
import { PersistentSubtitleManager } from "@/infra/player/persistent-subtitle-manager";

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
      getActiveCycle: () => ({
        telemetry: createPlayerTelemetryState("/tmp/kunai-test.sock"),
        acceptPlaybackProperties: false,
        playerReadyNotified: false,
        playerStartedNotified: false,
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
  });

  test("accepts playback samples, updates position, and emits ready/start progress hooks", () => {
    const events: unknown[] = [];
    let currentPosition = 0;
    const telemetry = createPlayerTelemetryState("/tmp/kunai-test.sock");
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => ({
        telemetry,
        acceptPlaybackProperties: true,
        playerReadyNotified: false,
        playerStartedNotified: false,
        lastPlaybackProgressEventAtMs: 0,
        lastPlaybackProgressPositionSeconds: -1,
        lastPlaybackProgressDurationSeconds: 0,
        onPlaybackEvent: (event) => events.push(event),
      }),
      getIpcSession: () => null,
      getCurrentOptions: () => ({ displayTitle: "Episode", primarySubtitle: null }),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
      onSkipRequestFromMpv: async () => {},
      setCurrentPositionSeconds: (value) => {
        currentPosition = value;
      },
      maybeRearmSkippedSegmentsOnBackwardSeek: () => {},
      getCurrentPositionSeconds: () => currentPosition,
      maybeEmitPlaybackProgress: (cycle, observedAt) => {
        events.push({ type: "progress-hook", observedAt, sample: cycle.telemetry.latestIpcSample });
      },
      handleSegmentSkipProgress: async () => {},
      fireNearEofIfNeeded: () => {},
      observeWatchdog: (sample) => {
        events.push({ type: "watchdog", positionSeconds: sample.positionSeconds });
      },
    });

    router.handlePropertyUpdate({ name: "duration", value: 600, observedAt: 1 });
    router.handlePropertyUpdate({ name: "time-pos", value: 30, observedAt: 2 });

    expect(currentPosition).toBe(30);
    expect(events).toContainEqual({ type: "playback-started" });
    expect(events).toContainEqual({
      type: "watchdog",
      positionSeconds: 30,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "progress-hook",
        observedAt: 2,
      }),
    );
  });
});
