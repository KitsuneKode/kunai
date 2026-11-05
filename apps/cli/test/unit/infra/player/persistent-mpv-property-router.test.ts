import { describe, expect, test } from "bun:test";

import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { createPlayerStatsState } from "@/infra/player/mpv-stats";
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
        stats: createPlayerStatsState("/tmp/kunai-test.sock"),
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

  test("accepts playback samples, updates position, and emits ready/start progress hooks", () => {
    const events: unknown[] = [];
    let currentPosition = 0;
    const stats = createPlayerStatsState("/tmp/kunai-test.sock");
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => ({
        stats,
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
    await Bun.sleep(0);

    expect(copied).toBe(true);
    expect(commands).toContainEqual(["set_property", "user-data/kunai-request", ""]);
  });

  test("accepts explicit embedded audio language only for the loaded file", () => {
    const events: unknown[] = [];
    const audioIntents: string[] = [];
    let accepting = true;
    const router = new PersistentMpvPropertyRouter({
      getActiveCycle: () => null,
      getIpcSession: () => null,
      getCurrentOptions: () => ({
        displayTitle: "Episode",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event),
      }),
      getAudioIntentMediaPath: () => (accepting ? "https://example.test/current.mkv" : null),
      onAudioIntent: (lang) => audioIntents.push(lang),
      subtitleManager: new PersistentSubtitleManager(),
      notifyMpvActionRequest: () => {},
      finishResumeChoiceWait: () => {},
      handleResumeSeekFromMpv: async () => {},
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

    const send = (payload: import("@kunai/types").JsonValue) =>
      router.handlePropertyUpdate({
        name: "user-data/kunai-audio-intent",
        value: JSON.stringify(payload),
        observedAt: 1,
      });
    send({ id: 2, language: "JA", path: "https://example.test/current.mkv" });
    expect(events).toEqual([
      { type: "track-changed", trackType: "audio", id: 2, audioLanguageIntent: "ja" },
    ]);
    expect(audioIntents).toEqual(["ja"]);
    events.length = 0;
    audioIntents.length = 0;
    const rejectedPayloads: import("@kunai/types").JsonValue[] = [
      { id: 2, language: "en", path: "https://example.test/retired.mkv" },
      { id: 0, language: "en", path: "https://example.test/current.mkv" },
      { id: 2, language: "und", path: "https://example.test/current.mkv" },
      { id: 2, language: "zxx", path: "https://example.test/current.mkv" },
      { id: 2, language: "mul", path: "https://example.test/current.mkv" },
      { id: 2, path: "https://example.test/current.mkv" },
      { id: 2, language: "English dub", path: "https://example.test/current.mkv" },
      { id: 2, language: "en", path: "https://example.test/current.mkv", extra: "x".repeat(9000) },
    ];
    for (const payload of rejectedPayloads) send(payload);
    accepting = false;
    send({ id: 2, language: "en", path: "https://example.test/current.mkv" });
    expect(events).toEqual([]);
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
