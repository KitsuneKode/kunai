import { describe, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";
import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";

type CapturedCallbacks = Parameters<PersistentMpvSessionRuntime["openIpcSession"]>[0];

function createStream(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    url: "https://video.example/episode-1.m3u8",
    headers: { referer: "https://video.example" },
    timestamp: Date.now(),
    ...overrides,
  };
}

function createHarness() {
  let callbacks!: CapturedCallbacks;
  let resolveExit!: (code: number) => void;
  const commands: unknown[][] = [];
  const proc = {
    exited: new Promise<number>((resolve) => {
      resolveExit = resolve;
    }),
    killed: false,
    exitCode: null as number | null,
    kill() {
      this.killed = true;
      this.exitCode = 0;
      resolveExit(0);
    },
  };
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
  const runtime: PersistentMpvSessionRuntime = {
    which: () => "/usr/bin/mpv",
    spawn: () => proc,
    waitForIpcEndpoint: async () => true,
    async openIpcSession(options) {
      callbacks = options;
      return ipc;
    },
  };
  return {
    runtime,
    commands,
    callbacks: () => callbacks,
    endProcess(code = 0) {
      proc.exitCode = code;
      resolveExit(code);
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Bun.sleep(0);
  await Bun.sleep(0);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await flushAsyncWork();
  }
  throw new Error("Timed out waiting for fake mpv lifecycle condition");
}

describe("PersistentMpvSession fake IPC lifecycle harness", () => {
  test("drives first-play readiness, progress, end-file result, and cleanup through fake mpv IPC", async () => {
    const harness = createHarness();
    const events: string[] = [];
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event.type),
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });

    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 2 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 120, observedAt: 3 });
    const playbackResult = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 4 });
    const result = await playbackResult;

    expect(events).toContain("player-ready");
    expect(events).toContain("playback-started");
    expect(result.endReason).toBe("eof");
    expect(result.watchedSeconds).toBe(600);
    expect(result.duration).toBe(600);
  });

  test("ignores playback property flood before episode-transition ready work but keeps subtitle cleanup cache", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: { displayTitle: "Episode 1", primarySubtitle: null },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    const firstPlayback = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 2 });
    await firstPlayback;

    const nextPlayback = session.play(
      createStream({ url: "https://video.example/episode-2.m3u8" }),
      { displayTitle: "Episode 2", primarySubtitle: "https://subs.example/episode-2.vtt" },
    );
    await waitFor(() =>
      harness.commands.some(
        (command) =>
          command[0] === "loadfile" && command[1] === "https://video.example/episode-2.m3u8",
      ),
    );
    harness.callbacks().onPropertyUpdate({
      name: "track-list",
      value: [{ id: 9, type: "sub", external: true }],
      observedAt: 3,
    });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 444, observedAt: 4 });
    await flushAsyncWork();
    harness.callbacks().onFileLoaded?.({ observedAt: 5 });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 800, observedAt: 6 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 20, observedAt: 7 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 8 });
    const result = await nextPlayback;

    expect(harness.commands).toContainEqual(["sub-remove", 9]);
    expect(harness.commands).toContainEqual([
      "sub-add",
      "https://subs.example/episode-2.vtt",
      "select",
      "",
      "",
    ]);
    expect(result.watchedSeconds).toBe(20);
  });

  test("does not classify subtitle command timeouts as player stalls", async () => {
    const harness = createHarness();
    const events: unknown[] = [];
    await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event),
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });

    harness.callbacks().onCommandResult?.({
      ok: false,
      command: ["sub-add", "https://subs.example/main.vtt"],
      requestId: 99,
      error: "timeout",
    });

    expect(events).toContainEqual({
      type: "ipc-command-failed",
      command: "sub-add",
      error: "timeout",
    });
    expect(events).not.toContainEqual({
      type: "ipc-stalled",
      command: "sub-add",
      error: "timeout",
    });
  });

  test("resume prompt waits for mpv choice and seeks only after the user chooses resume", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: { displayTitle: "Episode 1", primarySubtitle: null },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    const firstPlayback = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 2 });
    await firstPlayback;

    const nextPlayback = session.play(
      createStream({ url: "https://video.example/episode-2.m3u8" }),
      {
        displayTitle: "Episode 2",
        primarySubtitle: null,
        startAt: 0,
        resumePromptAt: 90,
        offerResumeStartChoice: true,
      },
    );
    await waitFor(() =>
      harness.commands.some(
        (command) =>
          command[0] === "loadfile" && command[1] === "https://video.example/episode-2.m3u8",
      ),
    );
    harness.callbacks().onFileLoaded?.({ observedAt: 3 });
    await waitFor(() =>
      harness.commands.some(
        (command) => command[0] === "set_property" && command[1] === "user-data/kunai-resume-at",
      ),
    );
    expect(harness.commands).not.toContainEqual(["seek", 90, "absolute"]);
    harness.callbacks().onPropertyUpdate({
      name: "user-data/kunai-resume-choice",
      value: "resume",
      observedAt: 4,
    });
    await waitFor(() => harness.commands.some((command) => command[0] === "seek"));
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 5 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 91, observedAt: 6 });
    await flushAsyncWork();
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 7 });

    expect(await nextPlayback).toMatchObject({ endReason: "eof", watchedSeconds: 600 });
    expect(harness.commands).toContainEqual(["seek", 90, "absolute"]);
  });

  test("resume prompt timeout starts over without applying the resume seek", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: { displayTitle: "Episode 1", primarySubtitle: null },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
      resumeChoiceTimeoutMs: 5,
    });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    const firstPlayback = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 2 });
    await firstPlayback;

    const nextPlayback = session.play(
      createStream({ url: "https://video.example/episode-2.m3u8" }),
      {
        displayTitle: "Episode 2",
        primarySubtitle: null,
        startAt: 0,
        resumePromptAt: 90,
        offerResumeStartChoice: true,
      },
    );
    await waitFor(() =>
      harness.commands.some(
        (command) =>
          command[0] === "loadfile" && command[1] === "https://video.example/episode-2.m3u8",
      ),
    );
    harness.callbacks().onFileLoaded?.({ observedAt: 3 });
    await waitFor(() =>
      harness.commands.some(
        (command) => command[0] === "set_property" && command[1] === "user-data/kunai-resume-at",
      ),
    );
    await Bun.sleep(10);
    harness.callbacks().onPropertyUpdate({
      name: "user-data/kunai-resume-choice",
      value: "resume",
      observedAt: 4,
    });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 5 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 5, observedAt: 6 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 7 });

    expect(await nextPlayback).toMatchObject({ endReason: "eof" });
    expect(harness.commands).not.toContainEqual(["seek", 90, "absolute"]);
  });

  test("in-process reconnect reloads the stream and restores subtitles after file-loaded", async () => {
    const harness = createHarness();
    const events: unknown[] = [];
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/reconnect.m3u8" }),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/episode-1.vtt",
        onPlaybackEvent: (event) => events.push(event),
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: true,
        mpvInProcessStreamReconnectMaxAttempts: 1,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 2 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 100, observedAt: 3 });
    harness
      .callbacks()
      .onPropertyUpdate({ name: "demuxer-via-network", value: true, observedAt: 4 });
    harness.callbacks().onPropertyUpdate({
      name: "demuxer-cache-state",
      value: { "fw-bytes": 0 },
      observedAt: 5,
    });
    harness.callbacks().onEndFile({ reason: "error", observedAt: 6 });
    await flushAsyncWork();
    harness.callbacks().onFileLoaded?.({ observedAt: 18_100 });
    await flushAsyncWork();

    expect(harness.commands).toContainEqual([
      "loadfile",
      "https://video.example/reconnect.m3u8",
      "replace",
      -1,
      { start: "100" },
    ]);
    expect(harness.commands).toContainEqual([
      "sub-add",
      "https://subs.example/episode-1.vtt",
      "select",
      "",
      "",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "mpv-in-process-reconnect", phase: "complete" }),
    );
    const playbackResult = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "quit", observedAt: 18_200 });
    await playbackResult;
  });

  test("reconnect that dies before file-loaded does not block a retry within budget", async () => {
    const harness = createHarness();
    const events: unknown[] = [];
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/flaky.m3u8" }),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event),
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: true,
        mpvInProcessStreamReconnectMaxAttempts: 2,
        mpvKunaiScriptOpts: "",
        tuningOverrides: { mpvReconnectBaseBackoffMs: 100, mpvReconnectMaxBackoffMs: 1000 },
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });

    const markNetworkable = (base: number) => {
      harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: base });
      harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 100, observedAt: base + 1 });
      harness
        .callbacks()
        .onPropertyUpdate({ name: "demuxer-via-network", value: true, observedAt: base + 2 });
      harness.callbacks().onPropertyUpdate({
        name: "demuxer-cache-state",
        value: { "fw-bytes": 0 },
        observedAt: base + 3,
      });
    };

    const startedCount = () =>
      events.filter(
        (e) =>
          (e as { type?: string }).type === "mpv-in-process-reconnect" &&
          (e as { phase?: string }).phase === "started",
      ).length;

    // First play, then a networkish error -> reconnect attempt 1 (loadfile ACKed).
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    markNetworkable(2);
    harness.callbacks().onEndFile({ reason: "error", observedAt: 6 });
    await flushAsyncWork();
    expect(startedCount()).toBe(1);

    // The reloaded stream ACKed loadfile but errors again before file-loaded.
    // The stale reconnectInFlight flag must not block reconnect attempt 2.
    markNetworkable(7);
    harness.callbacks().onEndFile({ reason: "error", observedAt: 12 });
    await Bun.sleep(250);
    await flushAsyncWork();
    expect(startedCount()).toBe(2);

    const playbackResult = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "quit", observedAt: 99_000 });
    await playbackResult;
  });
});
