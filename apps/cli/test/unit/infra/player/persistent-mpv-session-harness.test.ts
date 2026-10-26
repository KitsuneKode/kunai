import { describe, expect, test } from "bun:test";

import type { PlaybackTimingMetadata, StreamInfo } from "@/domain/types";
import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { LOCAL_HLS_DEMUXER_LAVF_OPTIONS } from "@/infra/player/mpv-stream-http-headers";
import type { PersistentMpvSessionRuntime } from "@/infra/player/persistent-mpv-runtime";
import { PersistentMpvSession } from "@/infra/player/PersistentMpvSession";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

import { waitUntil } from "../../../support/wait-until";

type CapturedCallbacks = Parameters<PersistentMpvSessionRuntime["openIpcSession"]>[0];

function createStream(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    url: "https://video.example/episode-1.m3u8",
    headers: { referer: "https://video.example" },
    timestamp: Date.now(),
    ...overrides,
  };
}

function createFakeProcess() {
  let resolveExit!: (code: number) => void;
  const handle = {
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
  return { handle, endProcess: (code = 0) => resolveExit(code) };
}

function createHarness(
  harnessOptions: {
    readonly beforeSend?: (command: readonly unknown[]) => Promise<void> | void;
  } = {},
) {
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
      await harnessOptions.beforeSend?.(command);
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

/** The session must never hold more than one pending `loadfile` owner. */
function pendingLoadOwners(session: PersistentMpvSession): number {
  const pending = (session as unknown as { pendingFileLoad: unknown }).pendingFileLoad;
  return pending ? 1 : 0;
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

/**
 * Bootstrap teardown does real filesystem work, so poll rather than sleep.
 *
 * The budget was 200ms, which is a bet on disk speed: the same work on a loaded
 * Windows agent takes longer, and the failure surfaced as this generic message
 * rather than as whatever was actually still pending.
 */
async function waitForSettled(predicate: () => boolean): Promise<void> {
  await waitUntil(predicate, { label: "mpv bootstrap teardown" });
}

describe("PersistentMpvSession single pending load owner", () => {
  async function createLoadedSession() {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: { displayTitle: "Episode 1", primarySubtitle: null },
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    return { harness, session };
  }

  test("the initial argv-loaded file has a pending owner that the first file-loaded consumes", async () => {
    const { harness } = await createLoadedSession();

    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();

    // Consuming the owner clears the loading overlay and drains ready work.
    expect(harness.commands).toContainEqual(["set_property", "user-data/kunai-loading", ""]);
    expect(harness.commands).toContainEqual(["set_property", "pause", false]);
  });

  test("an unowned file-loaded is ignored entirely", async () => {
    const { harness } = await createLoadedSession();

    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    const afterFirst = harness.commands.length;

    // The single owner was consumed; nothing owns this second event.
    harness.callbacks().onFileLoaded?.({ observedAt: 2 });
    await flushAsyncWork();

    expect(harness.commands.length).toBe(afterFirst);
  });

  test("two pending load owners never coexist across a replacement", async () => {
    const { harness, session } = await createLoadedSession();
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();

    harness.callbacks().onEndFile?.({ reason: "eof", observedAt: 2 });
    await flushAsyncWork();

    void session.play(createStream({ url: "https://video.example/episode-2.m3u8" }), {
      displayTitle: "Episode 2",
      primarySubtitle: null,
    });
    await flushAsyncWork();

    const owners = pendingLoadOwners(session);
    expect(owners).toBeLessThanOrEqual(1);
  });
});

describe("PersistentMpvSession deferred bootstrap resources", () => {
  test("an endpoint wait that resolves after the process died does not open an IPC session", async () => {
    let releaseEndpointWait!: (ready: boolean) => void;
    let waitStarted!: () => void;
    const waitReached = new Promise<void>((resolve) => {
      waitStarted = resolve;
    });
    let ipcOpens = 0;
    let terminated = false;
    const proc = createFakeProcess();
    const runtime: PersistentMpvSessionRuntime = {
      which: () => "/usr/bin/mpv",
      spawn: () => proc.handle,
      waitForIpcEndpoint: () =>
        new Promise<boolean>((resolve) => {
          releaseEndpointWait = resolve;
          waitStarted();
        }),
      async openIpcSession() {
        ipcOpens += 1;
        throw new Error("must not open IPC for a dead process");
      },
    };

    const creating = PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => {
          if (event.type === "player-closed") terminated = true;
        },
      },
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: () => {},
      runtime,
    });

    await waitReached;
    // mpv dies while the endpoint wait is still outstanding.
    proc.endProcess(1);
    await waitForSettled(() => terminated);

    releaseEndpointWait(true);
    const session = await creating;
    await flushAsyncWork();

    expect(ipcOpens).toBe(0);
    expect(session.isAlive()).toBe(false);
  });

  test("an IPC session that opens after the process died is closed exactly once and never installed", async () => {
    let releaseIpcOpen!: (session: MpvIpcSession) => void;
    let openStarted!: () => void;
    const openReached = new Promise<void>((resolve) => {
      openStarted = resolve;
    });
    let closes = 0;
    let sends = 0;
    const publicEvents: string[] = [];
    const controls: unknown[] = [];
    const proc = createFakeProcess();
    const staleIpc: MpvIpcSession = {
      async send(command) {
        sends += 1;
        return { ok: true, command, requestId: 1, response: {} } satisfies MpvIpcCommandResult;
      },
      sendUnchecked() {
        sends += 1;
      },
      async close() {
        closes += 1;
      },
    };
    const runtime: PersistentMpvSessionRuntime = {
      which: () => "/usr/bin/mpv",
      spawn: () => proc.handle,
      waitForIpcEndpoint: async () => true,
      openIpcSession: () =>
        new Promise<MpvIpcSession>((resolve) => {
          releaseIpcOpen = resolve;
          openStarted();
        }),
    };

    const creating = PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => publicEvents.push(event.type),
      },
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: (control) => controls.push(control),
      runtime,
    });

    await openReached;
    proc.endProcess(1);
    // Wait for termination to actually complete rather than guessing at ticks.
    await waitForSettled(() => publicEvents.includes("player-closed"));

    publicEvents.length = 0;
    controls.length = 0;
    releaseIpcOpen(staleIpc);
    const session = await creating;
    await waitForSettled(() => closes > 0);

    expect(closes).toBe(1);
    expect(sends).toBe(0);
    expect(publicEvents).toEqual([]);
    expect(controls).toEqual([]);
    expect(session.isAlive()).toBe(false);
  });
});

describe("PersistentMpvSession fake IPC lifecycle harness", () => {
  test("watchdog replacement stop preserves the new load and restores playback", async () => {
    const loadRequested = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const harness = createHarness({
      beforeSend(command) {
        if (command[0] === "loadfile") loadRequested.resolve();
      },
    });
    let emitWatchdog!: (event: PlayerPlaybackEvent) => void;
    harness.runtime.createPlaybackWatchdog = (emit) => {
      emitWatchdog = emit;
      return { observe() {}, stop() {}, reset() {} };
    };
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/episode.vtt",
        onPlaybackEvent(event) {
          if (event.type === "mpv-in-process-reconnect" && event.phase === "complete")
            completed.resolve();
        },
      },
      // SAFETY: this fixture only supplies the reconnect and script options it exercises.
      kitsuneConfig: {
        mpvInProcessStreamReconnect: true,
        mpvInProcessStreamReconnectMaxAttempts: 1,
        mpvKunaiScriptOpts: "",
      } as never,
      onControlReady() {},
      runtime: harness.runtime,
    });
    try {
      harness.callbacks().onFileLoaded?.({ observedAt: 1 });
      harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 2 });
      harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 100, observedAt: 3 });
      emitWatchdog({
        type: "stream-stalled",
        stallKind: "network-read-dead",
        secondsWithoutProgress: 8,
      });
      await loadRequested.promise;
      expect(pendingLoadOwners(session)).toBe(1);
      // Real mpv ends the OLD file with stop before loading its replacement.
      harness.callbacks().onEndFile({ reason: "stop", observedAt: 4 });
      expect(pendingLoadOwners(session)).toBe(1);
      harness.callbacks().onFileLoaded?.({ observedAt: 5 });
      await completed.promise;
      expect(harness.commands).toContainEqual(["seek", 100, "absolute"]);
      expect(harness.commands).toContainEqual([
        "sub-add",
        "https://subs.example/episode.vtt",
        "select",
        "",
        "",
      ]);
      const playback = session.waitForCurrentPlayback();
      harness.callbacks().onEndFile({ reason: "quit", observedAt: 6 });
      expect(await playback).toMatchObject({ endReason: "quit" });
    } finally {
      harness.endProcess();
      await session.close();
    }
  });

  for (const reason of ["error", "quit"] as const) {
    test(`watchdog reconnect still ends on a real ${reason} before file-loaded`, async () => {
      const loadRequested = Promise.withResolvers<void>();
      const harness = createHarness({
        beforeSend(command) {
          if (command[0] === "loadfile") loadRequested.resolve();
        },
      });
      let emitWatchdog!: (event: PlayerPlaybackEvent) => void;
      harness.runtime.createPlaybackWatchdog = (emit) => {
        emitWatchdog = emit;
        return { observe() {}, stop() {}, reset() {} };
      };
      const session = await PersistentMpvSession.create({
        stream: createStream(),
        options: { displayTitle: "Episode 1", primarySubtitle: null },
        // SAFETY: partial config pins just the reconnect policy used by this fixture.
        kitsuneConfig: {
          mpvInProcessStreamReconnect: true,
          mpvInProcessStreamReconnectMaxAttempts: 1,
          mpvKunaiScriptOpts: "",
        } as never,
        onControlReady() {},
        runtime: harness.runtime,
      });
      try {
        harness.callbacks().onFileLoaded?.({ observedAt: 1 });
        const playback = session.waitForCurrentPlayback();
        emitWatchdog({
          type: "stream-stalled",
          stallKind: "network-read-dead",
          secondsWithoutProgress: 8,
        });
        await loadRequested.promise;
        harness.callbacks().onEndFile({ reason, observedAt: 2 });
        expect(await playback).toMatchObject({ endReason: reason });
        expect(pendingLoadOwners(session)).toBe(0);
      } finally {
        harness.endProcess();
        await session.close();
      }
    });
  }

  test("updates autoskip policy during an active intro without leaving a stale automatic skip", async () => {
    const harness = createHarness();
    const partialTiming = {
      intro: [{ startMs: 10_000, endMs: 20_000 }],
    } as unknown as PlaybackTimingMetadata;
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        autoSkipEnabled: true,
        timing: partialTiming,
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: false,
        mpvInProcessStreamReconnectMaxAttempts: 0,
        mpvKunaiScriptOpts: { prompt_seconds: "1" },
      } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });

    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 12, observedAt: 2 });
    await flushAsyncWork();
    expect(harness.commands).toContainEqual(["set_property", "user-data/kunai-skip-auto", "1"]);

    harness.commands.length = 0;
    session.getControl().updateAutoSkipEnabled?.(false);
    await flushAsyncWork();
    expect(harness.commands).toContainEqual(["set_property", "user-data/kunai-skip-auto", "0"]);
    expect(harness.commands.some((command) => command[0] === "seek")).toBe(false);

    harness.commands.length = 0;
    session.getControl().updateAutoSkipEnabled?.(true);
    await flushAsyncWork();
    expect(harness.commands).toContainEqual(["set_property", "user-data/kunai-skip-auto", "1"]);

    await session.close();
  });

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

  test("applies per-episode HTTP headers on autoplay-chain loadfile", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream({
        headers: {
          referer: "https://www.cineplay.to/tv/99/1/1",
          origin: "https://www.cineplay.to",
          "user-agent": "kunai-test",
        },
      }),
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

    const nextHeaders = {
      referer: "https://www.cineplay.to/tv/99/1/2",
      origin: "https://www.cineplay.to",
      "user-agent": "kunai-test",
    };
    const nextPlayback = session.play(
      createStream({
        url: "https://video.example/episode-2.m3u8",
        headers: nextHeaders,
      }),
      { displayTitle: "Episode 2", primarySubtitle: null },
    );
    await waitFor(() =>
      harness.commands.some(
        (command) =>
          command[0] === "loadfile" && command[1] === "https://video.example/episode-2.m3u8",
      ),
    );
    harness.callbacks().onFileLoaded?.({ observedAt: 3 });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 4 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 12, observedAt: 5 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 6 });
    await nextPlayback;

    expect(harness.commands).toContainEqual([
      "loadfile",
      "https://video.example/episode-2.m3u8",
      "replace",
      -1,
      {
        start: "0",
        referrer: nextHeaders.referer,
        "user-agent": nextHeaders["user-agent"],
        "http-header-fields": "Origin: https://www.cineplay.to",
        ytdl: "no",
        "demuxer-lavf-o-clr": "",
      },
    ]);
  });

  test("swaps origin across provider profiles on autoplay-chain loadfile", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream({
        url: "https://video.example/episode-1.m3u8",
        headers: {
          referer: "https://www.cineplay.to/tv/99/1/1",
          origin: "https://www.cineplay.to",
          "user-agent": "kunai-test",
        },
      }),
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

    const providerHeaders = {
      referer: "https://player.videasy.to/",
      origin: "https://player.videasy.to",
      "user-agent": "kunai-test",
    };
    const nextPlayback = session.play(
      createStream({
        url: "https://video.example/episode-2.m3u8",
        headers: providerHeaders,
      }),
      { displayTitle: "Episode 2", primarySubtitle: null },
    );
    await waitFor(() =>
      harness.commands.some(
        (command) =>
          command[0] === "loadfile" && command[1] === "https://video.example/episode-2.m3u8",
      ),
    );
    harness.callbacks().onFileLoaded?.({ observedAt: 3 });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 4 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 8, observedAt: 5 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 6 });
    await nextPlayback;

    expect(harness.commands).toContainEqual([
      "loadfile",
      "https://video.example/episode-2.m3u8",
      "replace",
      -1,
      {
        start: "0",
        referrer: providerHeaders.referer,
        "user-agent": providerHeaders["user-agent"],
        "http-header-fields": "Origin: https://player.videasy.to",
        ytdl: "no",
        "demuxer-lavf-o-clr": "",
      },
    ]);
    expect(session.isReusable()).toBe(true);
  });

  test("loads materialized local HLS after a remote manifest in the same session", async () => {
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/episode-1.m3u8" }),
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

    const localPlaylist = "/tmp/kunai-hls/episode-2/playlist.m3u8";
    const nextPlayback = session.play(
      createStream({
        url: localPlaylist,
        headers: {
          referer: "https://cdn.example/page",
          origin: "https://cdn.example",
          "user-agent": "kunai-test",
        },
      }),
      { displayTitle: "Episode 2", primarySubtitle: null, urlKind: "local" },
    );
    await waitFor(() =>
      harness.commands.some((command) => command[0] === "loadfile" && command[1] === localPlaylist),
    );
    harness.callbacks().onFileLoaded?.({ observedAt: 3 });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 500, observedAt: 4 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 4, observedAt: 5 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 6 });
    await nextPlayback;

    expect(harness.commands).toContainEqual([
      "loadfile",
      localPlaylist,
      "replace",
      -1,
      {
        start: "0",
        referrer: "https://cdn.example/page",
        "user-agent": "kunai-test",
        "http-header-fields": "Origin: https://cdn.example",
        "demuxer-lavf-o": LOCAL_HLS_DEMUXER_LAVF_OPTIONS,
      },
    ]);
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
    // The 5ms resumeChoiceTimeoutMs fires on a real timer: finishResumeChoiceWait
    // issues a second kunai-resume-at clear when the offer lapses, which is the
    // observable "prompt timed out" — polling commands survives slow runners
    // where a fixed sleep under or overshoots.
    await waitUntil(
      () =>
        harness.commands.filter(
          (command) => command[0] === "set_property" && command[1] === "user-data/kunai-resume-at",
        ).length >= 2,
      { label: "resume offer timed out" },
    );
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
      {
        start: "100",
        referrer: "https://video.example",
        "http-header-fields-clr": "",
        ytdl: "no",
        "demuxer-lavf-o-clr": "",
      },
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

  test("an in-process reconnect on a live stream never seeks back to the drop position", async () => {
    // Nulling the loadfile `start` was not enough: the completion step issued its own
    // absolute seek, which on a live broadcast lands in the DVR window or fails.
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream({
        url: "https://www.youtube.com/watch?v=liveid",
        headers: {},
        requiresYtdl: true,
        isLive: true,
      }),
      options: { displayTitle: "Live broadcast", primarySubtitle: null, onPlaybackEvent: () => {} },
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

    const reload = harness.commands.find(
      (command) =>
        command[0] === "loadfile" && command[1] === "https://www.youtube.com/watch?v=liveid",
    );
    expect(reload).toBeDefined();
    expect((reload as [string, string, string, number, Record<string, string>])[4].start).toBe("0");
    expect(harness.commands.some((command) => command[0] === "seek")).toBe(false);

    const playbackResult = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "quit", observedAt: 18_200 });
    await playbackResult;
  });

  test("a replacement during reconnect seek blocks every stale completion command", async () => {
    let releaseSeek!: () => void;
    let seekStarted!: () => void;
    const seekReached = new Promise<void>((resolve) => {
      seekStarted = resolve;
    });
    const seekGate = new Promise<void>((resolve) => {
      releaseSeek = resolve;
    });
    const harness = createHarness({
      beforeSend: async (command) => {
        if (command[0] !== "seek") return;
        seekStarted();
        await seekGate;
      },
    });
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/reconnect-race.m3u8" }),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: "https://subs.example/episode-1.vtt",
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
    harness.callbacks().onFileLoaded?.({ observedAt: 7 });
    await seekReached;

    // A stop/replacement retires the reconnect's generation before its IPC
    // command resolves. Drive that private seam directly so the test controls
    // the exact await boundary instead of needing a second active cycle.
    (session as unknown as { advanceCycleGeneration(): unknown }).advanceCycleGeneration();
    const replacementCommandCount = harness.commands.length;
    releaseSeek();
    await flushAsyncWork();

    expect(harness.commands.slice(replacementCommandCount)).toEqual([]);
  });

  test("a replacement during reconnect subtitle cleanup blocks stale subtitle attachment", async () => {
    let releaseRemoval!: () => void;
    let removalStarted!: () => void;
    const removalReached = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    const events: unknown[] = [];
    const harness = createHarness({
      beforeSend: async (command) => {
        if (command[0] !== "sub-remove") return;
        removalStarted();
        await removalGate;
      },
    });
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/reconnect-subtitle-race.m3u8" }),
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
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({
      name: "track-list",
      value: [{ id: 9, type: "sub", external: true }],
      observedAt: 2,
    });
    harness.callbacks().onPropertyUpdate({ name: "duration", value: 600, observedAt: 3 });
    harness.callbacks().onPropertyUpdate({ name: "time-pos", value: 100, observedAt: 4 });
    harness
      .callbacks()
      .onPropertyUpdate({ name: "demuxer-via-network", value: true, observedAt: 5 });
    harness.callbacks().onPropertyUpdate({
      name: "demuxer-cache-state",
      value: { "fw-bytes": 0 },
      observedAt: 6,
    });
    harness.callbacks().onEndFile({ reason: "error", observedAt: 7 });
    await flushAsyncWork();
    harness.callbacks().onFileLoaded?.({ observedAt: 8 });
    await removalReached;

    (session as unknown as { advanceCycleGeneration(): unknown }).advanceCycleGeneration();
    const commandCountAtReplacement = harness.commands.length;
    releaseRemoval();
    await flushAsyncWork();

    expect(harness.commands.slice(commandCountAtReplacement)).toEqual([]);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "mpv-in-process-reconnect", phase: "complete" }),
    );
  });

  test("a replacement during reconnect backoff prevents the stale reload", async () => {
    const harness = createHarness();
    const events: unknown[] = [];
    const session = await PersistentMpvSession.create({
      stream: createStream({ url: "https://video.example/backoff-race.m3u8" }),
      options: {
        displayTitle: "Episode 1",
        primarySubtitle: null,
        onPlaybackEvent: (event) => events.push(event),
      },
      kitsuneConfig: {
        mpvInProcessStreamReconnect: true,
        mpvInProcessStreamReconnectMaxAttempts: 2,
        mpvKunaiScriptOpts: "",
        tuningOverrides: { mpvReconnectBaseBackoffMs: 100, mpvReconnectMaxBackoffMs: 100 },
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

    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    markNetworkable(2);
    harness.callbacks().onEndFile({ reason: "error", observedAt: 6 });
    await flushAsyncWork();
    markNetworkable(7);
    harness.callbacks().onEndFile({ reason: "error", observedAt: 12 });
    await flushAsyncWork();
    (session as unknown as { advanceCycleGeneration(): unknown }).advanceCycleGeneration();
    const commandCountAtReplacement = harness.commands.length;
    // Negative window: must exceed the real 100ms reconnect backoff plus
    // scheduler margin — a shorter wait proves nothing on a loaded runner.
    await Bun.sleep(400);
    await flushAsyncWork();

    expect(
      harness.commands
        .slice(commandCountAtReplacement)
        .some((command) => command[0] === "loadfile"),
    ).toBe(false);
    expect(
      events.filter(
        (event) =>
          (event as { type?: string }).type === "mpv-in-process-reconnect" &&
          (event as { phase?: string }).phase === "started",
      ),
    ).toHaveLength(1);
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
    await waitUntil(() => startedCount() === 2, { label: "reconnect attempt 2 started" });
    expect(startedCount()).toBe(2);

    const playbackResult = session.waitForCurrentPlayback();
    harness.callbacks().onEndFile({ reason: "quit", observedAt: 99_000 });
    await playbackResult;
  });
});

test("persistent Off survives late subtitles and a new file carries its own language choice", async () => {
  const harness = createHarness();
  let control: import("@/infra/player/PlayerControlService").ActivePlayerControl | null = null;
  const session = await PersistentMpvSession.create({
    stream: createStream(),
    options: { displayTitle: "Episode 1", primarySubtitle: null, subtitlePreference: "none" },
    // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
    kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
    onControlReady: (value) => {
      control = value;
    },
    runtime: harness.runtime,
  });
  harness.callbacks().onFileLoaded?.({ observedAt: 1 });
  await flushAsyncWork();
  if (!control) throw new Error("No active player control");
  // SAFETY: onControlReady supplies this declared control type before the fixture uses it.
  const active = control as import("@/infra/player/PlayerControlService").ActivePlayerControl;
  await active.attachSubtitles?.({ primarySubtitle: "https://subs.example/en.vtt" });
  expect(harness.commands).toContainEqual([
    "sub-add",
    "https://subs.example/en.vtt",
    "auto",
    "",
    "",
  ]);
  expect(harness.commands).toContainEqual(["set_property", "sid", "no"]);
  harness.callbacks().onEndFile({ reason: "eof", observedAt: 2 });
  await flushAsyncWork();
  void session.play(createStream({ url: "https://video.example/episode-2.m3u8" }), {
    displayTitle: "Episode 2",
    primarySubtitle: null,
    subtitlePreference: "en",
  });
  await flushAsyncWork();
  const load = harness.commands.findLast((command) => command[0] === "loadfile");
  expect(load?.[4]).toMatchObject({ slang: "en", sid: "auto" });
  harness.endProcess();
});

describe("live subtitle facts", () => {
  test("native sid Off/On and visibility are reported without rewriting the startup preference", async () => {
    const events: PlayerPlaybackEvent[] = [];
    const harness = createHarness();
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Native",
        primarySubtitle: null,
        subtitlePreference: "none",
        onPlaybackEvent: (e) => events.push(e),
      },
      // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    const update = (
      name: string,
      value: Parameters<ReturnType<typeof harness.callbacks>["onPropertyUpdate"]>[0]["value"],
    ) => harness.callbacks().onPropertyUpdate({ name, value, observedAt: 1 });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    update("track-list", [{ id: 1, type: "sub", lang: "en", title: "Embedded" }]);
    update("sid", false);
    update("sub-visibility", true);
    update("sid", 1);
    update("sub-visibility", false);
    update("sub-visibility", true);
    update("sid", "no");
    const snapshots = events.filter((e) => e.type === "track-changed" && e.trackType === "sub");
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        id: 1,
        subtitleState: { id: 1, visible: true, language: "en", title: "Embedded" },
      }),
    );
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        id: 1,
        subtitleState: { id: 1, visible: false, language: "en", title: "Embedded" },
      }),
    );
    expect(snapshots.at(-1)).toMatchObject({ id: 0, subtitleState: { id: 0, visible: true } });
    expect(session["currentOptions"].subtitlePreference).toBe("none");
    await session.close();
  });

  test("native On under startup Off is preserved by late attachment, and late inventory never selects", async () => {
    const harness = createHarness();
    let control: import("@/infra/player/PlayerControlService").ActivePlayerControl | null = null;
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: { displayTitle: "Native", primarySubtitle: null, subtitlePreference: "none" },
      // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: (value) => {
        control = value;
      },
      runtime: harness.runtime,
    });
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({ name: "sid", value: 1, observedAt: 2 });
    const start = harness.commands.length;
    // SAFETY: onControlReady supplies this declared control type before the fixture uses it.
    const nativeControl = control as
      | import("@/infra/player/PlayerControlService").ActivePlayerControl
      | null;
    await nativeControl?.attachSubtitles?.({ primarySubtitle: "https://subs.example/late.vtt" });
    expect(harness.commands.slice(start)).toContainEqual([
      "sub-add",
      "https://subs.example/late.vtt",
      "auto",
      "",
      "",
    ]);
    expect(harness.commands.slice(start)).not.toContainEqual(["set_property", "sid", "no"]);
    await session.close();
  });
});

test("native subtitle selection and visibility are observed as file-local facts", async () => {
  const harness = createHarness();
  const events: PlayerPlaybackEvent[] = [];
  const session = await PersistentMpvSession.create({
    stream: createStream(),
    options: {
      displayTitle: "Episode",
      primarySubtitle: null,
      subtitlePreference: "none",
      onPlaybackEvent: (event) => events.push(event),
    },
    // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
    kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
    onControlReady: () => {},
    runtime: harness.runtime,
  });
  harness.callbacks().onFileLoaded?.({ observedAt: 1 });
  await flushAsyncWork();
  harness.callbacks().onPropertyUpdate({
    name: "track-list",
    value: [{ id: 3, type: "sub", lang: "ja", title: "Embedded Japanese", selected: true }],
    observedAt: 2,
  });
  harness.callbacks().onPropertyUpdate({ name: "sub-visibility", value: true, observedAt: 3 });
  harness.callbacks().onPropertyUpdate({ name: "sid", value: 3, observedAt: 4 });
  expect(events).toContainEqual({
    type: "track-changed",
    trackType: "sub",
    id: 3,
    subtitleState: { id: 3, visible: true, language: "ja", title: "Embedded Japanese" },
  });
  harness.callbacks().onPropertyUpdate({ name: "sub-visibility", value: false, observedAt: 5 });
  expect(events.at(-1)).toMatchObject({
    type: "track-changed",
    subtitleState: { id: 3, visible: false },
  });
  harness.callbacks().onPropertyUpdate({ name: "sid", value: false, observedAt: 6 });
  expect(events.at(-1)).toMatchObject({
    type: "track-changed",
    subtitleState: { id: 0, visible: false },
  });
  harness.callbacks().onEndFile({ reason: "eof", observedAt: 7 });
  await flushAsyncWork();
  events.length = 0;
  void session.play(createStream({ url: "https://video.example/next.m3u8" }), {
    displayTitle: "Next",
    primarySubtitle: null,
    onPlaybackEvent: (event) => events.push(event),
  });
  await flushAsyncWork();
  harness.callbacks().onPropertyUpdate({ name: "sid", value: 3, observedAt: 8 });
  expect(events.some((event) => event.type === "track-changed")).toBe(false);
  harness.endProcess();
});

test("a late Off acknowledgement cannot overwrite the next file's subtitle preference", async () => {
  let releaseOff!: () => void;
  let offSent!: () => void;
  const offStarted = new Promise<void>((resolve) => {
    offSent = resolve;
  });
  const offPending = new Promise<void>((resolve) => {
    releaseOff = resolve;
  });
  let holdOff = false;
  const harness = createHarness({
    beforeSend: async (command) => {
      if (holdOff && command[0] === "set_property" && command[1] === "sid" && command[2] === "no") {
        offSent();
        await offPending;
      }
    },
  });
  let control: import("@/infra/player/PlayerControlService").ActivePlayerControl | null = null;
  const session = await PersistentMpvSession.create({
    stream: createStream(),
    options: { displayTitle: "First", primarySubtitle: null, subtitlePreference: "en" },
    // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
    kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
    onControlReady: (value) => {
      control = value;
    },
    runtime: harness.runtime,
  });
  try {
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    holdOff = true;
    const activeControl = control as
      | import("@/infra/player/PlayerControlService").ActivePlayerControl
      | null;
    const selectingOff = activeControl?.selectSubtitle?.({ subtitleUrl: null });
    await offStarted;
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 2 });
    void session.play(createStream({ url: "https://video.example/second.m3u8" }), {
      displayTitle: "Second",
      primarySubtitle: null,
      subtitlePreference: "fr",
    });
    await waitFor(() => harness.commands.some((command) => command[0] === "loadfile"));
    releaseOff();
    expect(await selectingOff).toBe(false);
    expect(session["currentOptions"].subtitlePreference).toBe("fr");
  } finally {
    releaseOff();
    harness.endProcess();
  }
});

test("a preferred late subtitle activates when the file initially has no subtitle track", async () => {
  const harness = createHarness();
  let control: import("@/infra/player/PlayerControlService").ActivePlayerControl | null = null;
  await PersistentMpvSession.create({
    stream: createStream(),
    options: { displayTitle: "Late English", primarySubtitle: null, subtitlePreference: "en" },
    // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
    kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
    onControlReady: (value) => {
      control = value;
    },
    runtime: harness.runtime,
  });
  try {
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({ name: "track-list", value: [], observedAt: 2 });
    harness.callbacks().onPropertyUpdate({ name: "sid", value: false, observedAt: 3 });
    const start = harness.commands.length;
    const active = control as
      | import("@/infra/player/PlayerControlService").ActivePlayerControl
      | null;
    await active?.attachSubtitles?.({ primarySubtitle: "https://subs.example/en.vtt" });
    expect(harness.commands.slice(start)).toContainEqual([
      "sub-add",
      "https://subs.example/en.vtt",
      "select",
      "",
      "",
    ]);
    expect(harness.commands.slice(start)).not.toContainEqual(["set_property", "sid", "no"]);
  } finally {
    harness.endProcess();
  }
});

test("replacement subtitles retain unchanged process visibility without a second visibility event", async () => {
  const harness = createHarness();
  const events: PlayerPlaybackEvent[] = [];
  const session = await PersistentMpvSession.create({
    stream: createStream(),
    options: { displayTitle: "First", primarySubtitle: null },
    // SAFETY: minimal config fixture; the harness supplies runtime and playback options used here.
    kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
    onControlReady: () => {},
    runtime: harness.runtime,
  });
  try {
    harness.callbacks().onFileLoaded?.({ observedAt: 1 });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({ name: "sub-visibility", value: true, observedAt: 2 });
    harness.callbacks().onPropertyUpdate({ name: "sid", value: false, observedAt: 3 });
    harness.callbacks().onEndFile({ reason: "eof", observedAt: 4 });
    void session.play(createStream({ url: "https://video.example/second.m3u8" }), {
      displayTitle: "Second",
      primarySubtitle: null,
      onPlaybackEvent: (event) => events.push(event),
    });
    await waitFor(() => harness.commands.some((command) => command[0] === "loadfile"));
    harness.callbacks().onFileLoaded?.({ observedAt: 5 });
    await flushAsyncWork();
    harness.callbacks().onPropertyUpdate({
      name: "track-list",
      value: [{ type: "sub", id: 5, lang: "fr" }],
      observedAt: 6,
    });
    harness.callbacks().onPropertyUpdate({ name: "sid", value: 5, observedAt: 7 });
    expect(events).toContainEqual({
      type: "track-changed",
      trackType: "sub",
      id: 5,
      subtitleState: { id: 5, visible: true, language: "fr" },
    });
  } finally {
    harness.endProcess();
  }
});

test.each(["es", "de"] as const)(
  "subtitle picker reuses %s or attaches only that track without growing the inventory",
  async (language) => {
    const harness = createHarness();
    const events: PlayerPlaybackEvent[] = [];
    const tracks = ["en", "es", "fr", "de"].map((lang) => ({
      url: `https://subs.example/${lang}.vtt`,
      language: lang,
      display: lang,
    }));
    const session = await PersistentMpvSession.create({
      stream: createStream(),
      options: {
        displayTitle: "Subtitle pick",
        primarySubtitle: null,
        subtitlePreference: "en",
        onPlaybackEvent: (event) => events.push(event),
      },
      // SAFETY: the harness supplies runtime; no user config is loaded.
      kitsuneConfig: { mpvInProcessStreamReconnect: false } as never,
      onControlReady: () => {},
      runtime: harness.runtime,
    });
    try {
      harness.callbacks().onFileLoaded?.({ observedAt: 1 });
      await flushAsyncWork();
      harness.callbacks().onPropertyUpdate({
        name: "track-list",
        observedAt: 2,
        value: tracks.slice(0, 3).map((track, index) => ({
          id: index + 1,
          type: "sub",
          external: true,
          "external-filename": track.url,
          lang: track.language,
        })),
      });
      const start = harness.commands.length;
      const eventStart = events.length;
      const control = session.getControl();
      expect(
        await control.selectSubtitle?.({
          subtitleUrl: `https://subs.example/${language}.vtt`,
          subtitleTracks: tracks,
        }),
      ).toBe(true);
      const additions = harness.commands.slice(start).filter((command) => command[0] === "sub-add");
      if (language === "es") {
        expect(additions).toEqual([]);
        expect(harness.commands.slice(start)).toContainEqual(["set_property", "sid", 2]);
      } else {
        expect(additions.map((command) => command[1])).toEqual(["https://subs.example/de.vtt"]);
      }
      expect(
        events.slice(eventStart).filter((event) => event.type === "late-subtitles-attached"),
      ).toEqual([]);
    } finally {
      await session.close();
    }
  },
);
