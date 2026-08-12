import { describe, expect, test } from "bun:test";

import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import { registerMpvProcess } from "@/infra/player/mpv-process-registry";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type {
  PlayerPlaybackEvent,
  PlayerPlaybackEventEnvelope,
  PlayerOptions,
} from "@/infra/player/PlayerService";
import { PlayerServiceImpl } from "@/infra/player/PlayerServiceImpl";
import type { launchMpv } from "@/mpv";
import type { DiagnosticEventInput } from "@/services/diagnostics/diagnostic-event";

/** Reaches the generation seams the service owns privately. */
type GenerationInternals = {
  readonly currentGeneration: PlaybackGeneration;
  wrapPlaybackEventHandler(
    generation: PlaybackGeneration,
    handler: ((input: PlayerPlaybackEventEnvelope) => void) | undefined,
    correlation?: PlayerOptions["correlation"],
  ): (event: PlayerPlaybackEvent) => void;
};

function internals(service: PlayerServiceImpl): GenerationInternals {
  return service as unknown as GenerationInternals;
}

const LOCAL_SOURCE = {
  kind: "local" as const,
  jobId: "job-1",
  titleId: "title-1",
  titleName: "Offline episode",
  mediaKind: "series" as const,
  providerId: "provider-1",
  season: 1,
  episode: 2,
  filePath: "/media/episode-2.mkv",
};

function createPlaybackResult(): PlaybackResult {
  return {
    watchedSeconds: 12,
    duration: 1200,
    endReason: "quit",
    resultSource: "ipc",
    playerExitedCleanly: true,
    playerExitCode: 0,
    playerExitSignal: null,
    socketPathCleanedUp: true,
    lastNonZeroPositionSeconds: 12,
    lastNonZeroDurationSeconds: 1200,
  };
}

function createStream(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    url: "https://cdn.example/show/episode.mp4?X-Amz-Signature=secret",
    headers: { Referer: "https://player.example" },
    subtitle: "https://subs.example/en.vtt?token=subtitle-secret",
    timestamp: 1,
    ...overrides,
  };
}

function createService(
  events: DiagnosticEventInput[],
  overrides: {
    presentation?: { isInteractiveShellMounted: () => boolean };
    playerControl?: { setActive: (control: unknown) => void };
    launchMpv?: typeof launchMpv;
  } = {},
) {
  const loggerEntries: Array<{
    readonly message: string;
    readonly context?: Record<string, unknown>;
  }> = [];
  const service = new PlayerServiceImpl({
    logger: {
      child: () => {
        throw new Error("not used");
      },
      debug: () => {},
      info: (message: string, context?: Record<string, unknown>) =>
        loggerEntries.push({ message, context }),
      warn: () => {},
      error: () => {},
      fatal: () => {},
    },
    tracer: {
      span: async <T>(_name: string, fn: () => Promise<T>) => await fn(),
      getCurrentTrace: () => null,
      getCurrentSpan: () => null,
    },
    diagnostics: { record: (event: DiagnosticEventInput) => events.push(event) },
    playerControl: { setActive: () => {} },
    config: { getRaw: () => ({}) },
    ...overrides,
  } as never);

  return { service, loggerEntries };
}

describe("PlayerServiceImpl diagnostics", () => {
  test("rejects a terminal HLS response before spawning MPV", async () => {
    const events: DiagnosticEventInput[] = [];
    let launches = 0;
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      launchMpv: (async () => {
        launches += 1;
        return createPlaybackResult();
      }) as typeof launchMpv,
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;

    try {
      const result = await service.play(
        createStream({ url: "https://light.goldweather.net/token/index.m3u8" }),
        { url: "https://light.goldweather.net/token/index.m3u8", displayTitle: "Episode 1" },
      );

      expect(launches).toBe(0);
      expect(result).toMatchObject({
        endReason: "error",
        suspectedDeadStream: true,
        streamRejectedBeforePlayerLaunch: true,
        watchedSeconds: 0,
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          operation: "mpv.hls-manifest.rejected",
          message: "HLS manifest rejected before player launch",
        }),
      );
      expect(events.some((event) => event.operation === "mpv.launch.started")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("suppresses stderr launch chrome when interactive shell is mounted", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
    });
    const result = createPlaybackResult();
    (service as unknown as { playOneShotStream: () => Promise<PlaybackResult> }).playOneShotStream =
      async () => result;

    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await service.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4",
        displayTitle: "Episode 1",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderr.join("")).toBe("");
  });

  test("launch diagnostics and stderr avoid raw stream and subtitle URLs", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service, loggerEntries } = createService(events);
    const result = createPlaybackResult();
    (service as unknown as { playOneShotStream: () => Promise<PlaybackResult> }).playOneShotStream =
      async () => result;

    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await service.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4?X-Amz-Signature=secret",
        displayTitle: "Episode 1",
        correlation: { sessionId: "session-1", playbackCycleId: "playback-1" },
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    const output = stderr.join("");
    expect(output).toContain("Starting playback: Episode 1");
    expect(output).toContain("Subtitle attached");
    expect(output).not.toContain("subtitle-secret");
    expect(output).not.toContain("X-Amz-Signature=secret");

    const launchEvent = events.find((event) => event.message === "Launching MPV");
    expect(launchEvent).toMatchObject({
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      category: "playback",
    });
    expect(launchEvent?.context).toMatchObject({
      title: "Episode 1",
      hasSubtitle: true,
      streamHost: "cdn.example",
      subtitleHost: "subs.example",
    });
    expect(JSON.stringify(launchEvent?.context)).not.toContain("subtitle-secret");
    expect(JSON.stringify(launchEvent?.context)).not.toContain("X-Amz-Signature=secret");
    expect(loggerEntries[0]?.context).toMatchObject({ streamHost: "cdn.example" });
    expect(JSON.stringify(loggerEntries[0]?.context)).not.toContain("X-Amz-Signature=secret");
  });

  test("releasePersistentSession does not block later play calls", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    const result = createPlaybackResult();
    (service as unknown as { playOneShotStream: () => Promise<PlaybackResult> }).playOneShotStream =
      async () => result;

    await service.releasePersistentSession();
    await expect(
      service.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4",
        displayTitle: "Episode 2",
      }),
    ).resolves.toMatchObject({ endReason: "quit" });
  });

  test("releasePersistentSession flushes deferred materialized cleanups", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    let cleaned = false;
    (
      service as unknown as {
        deferMaterializedCleanup: (run: () => Promise<void>) => void;
      }
    ).deferMaterializedCleanup(async () => {
      cleaned = true;
    });

    await service.releasePersistentSession();
    expect(cleaned).toBe(true);
  });

  test("runtime playback events keep diagnostic correlation and arrive enveloped", () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    const seen: PlayerPlaybackEventEnvelope[] = [];
    const generation = internals(service).currentGeneration;
    const wrap = internals(service).wrapPlaybackEventHandler.bind(service);

    wrap(generation, (input) => seen.push(input), {
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      providerAttemptId: "attempt-1",
    })({ type: "mpv-process-started" });

    // The raw event stays internal; the public value is the envelope.
    expect(seen).toEqual([{ generation, event: { type: "mpv-process-started" } }]);
    expect(events[0]).toMatchObject({
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      providerAttemptId: "attempt-1",
      category: "playback",
      message: "MPV runtime event",
      context: { event: "mpv-process-started" },
    });
  });
});

describe("PlayerServiceImpl playback generations", () => {
  test("play activates a generation synchronously, before the first await", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      launchMpv: (async () => createPlaybackResult()) as typeof launchMpv,
    });
    const activations: PlaybackGeneration[] = [];

    const playing = service.play(createStream({ subtitle: undefined }), {
      url: "https://cdn.example/show/episode.mp4",
      displayTitle: "Episode 1",
      onGenerationActivated: (generation) => activations.push(generation),
    });

    expect(activations).toEqual([{ process: 1, cycle: 1 }]);
    await playing;
  });

  test("public play callbacks receive the activated generation with every event", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      launchMpv: (async (options) => {
        options.onPlaybackEvent?.({ type: "playback-started" });
        return createPlaybackResult();
      }) as typeof launchMpv,
    });
    const activations: PlaybackGeneration[] = [];
    const published: PlayerPlaybackEventEnvelope[] = [];

    await service.play(createStream({ subtitle: undefined }), {
      url: "https://cdn.example/show/episode.mp4",
      displayTitle: "Episode 1",
      onGenerationActivated: (generation) => activations.push(generation),
      onPlaybackEvent: (input) => published.push(input),
    });

    const generation = activations[0];
    expect(generation).toBeDefined();
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((entry) => entry.generation === generation)).toBe(true);
    expect(published.map((entry) => entry.event.type)).toContain("playback-started");
    expect(published.map((entry) => entry.event.type)).toContain("launching-player");
  });

  test("a retired generation's raw callback cannot publish anything", () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    const published: PlayerPlaybackEventEnvelope[] = [];
    const stale = internals(service).currentGeneration;
    const staleRaw = internals(service).wrapPlaybackEventHandler.bind(service)(stale, (input) =>
      published.push(input),
    );

    staleRaw({ type: "playback-started" });
    expect(published).toHaveLength(1);

    const diagnosticsBefore = events.length;
    service.beginShutdown();
    void service.releasePersistentSession();

    staleRaw({ type: "playback-progress", positionSeconds: 5, durationSeconds: 10 });
    expect(published).toHaveLength(1);
    expect(events.length).toBe(diagnosticsBefore);
  });

  test("playLocal activates its one-shot generation before retiring the persistent session", async () => {
    const events: DiagnosticEventInput[] = [];
    const order: string[] = [];
    const activations: PlaybackGeneration[] = [];
    const published: PlayerPlaybackEventEnvelope[] = [];
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      launchMpv: (async (options) => {
        order.push("launch-local");
        options.onPlaybackEvent?.({ type: "playback-started" });
        return createPlaybackResult();
      }) as typeof launchMpv,
    });
    (
      service as unknown as { persistentSession: { isAlive(): boolean; close(): Promise<void> } }
    ).persistentSession = {
      isAlive: () => true,
      async close() {
        order.push("close-persistent");
        await closeGate;
      },
    };

    // Capture a raw callback belonging to the persistent generation being retired.
    const retired = internals(service).currentGeneration;
    const retiredRaw = internals(service).wrapPlaybackEventHandler.bind(service)(retired, (input) =>
      published.push(input),
    );

    const local = service.playLocal({
      source: LOCAL_SOURCE,
      onGenerationActivated: (generation) => activations.push(generation),
      onPlaybackEvent: (input) => published.push(input),
    });

    // Activation must already have happened, before the retirement await resolves.
    expect(activations).toHaveLength(1);
    expect(order).toEqual(["close-persistent"]);

    // A retained persistent callback firing mid-retirement cannot publish into the local cycle.
    retiredRaw({ type: "playback-progress", positionSeconds: 1, durationSeconds: 2 });
    expect(published).toHaveLength(0);

    releaseClose();
    await local;

    expect(order).toEqual(["close-persistent", "launch-local"]);
    const localGeneration = activations[0];
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((entry) => entry.generation === localGeneration)).toBe(true);

    // And it still cannot publish after the local launch completed.
    retiredRaw({ type: "playback-progress", positionSeconds: 3, durationSeconds: 4 });
    expect(published.every((entry) => entry.generation === localGeneration)).toBe(true);
  });

  test("whole-process stop invalidates the process before sending quit", async () => {
    const events: DiagnosticEventInput[] = [];
    const published: PlayerPlaybackEventEnvelope[] = [];
    const order: string[] = [];
    let activeControl: ActivePlayerControl | null = null;
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      playerControl: {
        setActive: (control) => {
          activeControl = control as ActivePlayerControl | null;
        },
      },
      launchMpv: (async (options) => {
        options.onControlReady?.({
          id: "one-shot",
          async stop() {
            order.push("quit-sent");
          },
          async stopCurrentFile() {
            order.push("stop-sent");
          },
        } as never);
        return createPlaybackResult();
      }) as typeof launchMpv,
    });

    let raw!: (event: PlayerPlaybackEvent) => void;
    await service.play(createStream({ subtitle: undefined }), {
      url: "https://cdn.example/show/episode.mp4",
      displayTitle: "Episode 1",
      onGenerationActivated: (generation) => {
        raw = internals(service).wrapPlaybackEventHandler.bind(service)(generation, (input) =>
          published.push(input),
        );
      },
    });

    const before = internals(service).currentGeneration;
    published.length = 0;
    await activeControl!.stop("user");

    expect(order).toEqual(["quit-sent"]);
    expect(internals(service).currentGeneration.process).toBeGreaterThan(before.process);
    raw({ type: "playback-progress", positionSeconds: 1, durationSeconds: 2 });
    expect(published).toEqual([]);
  });

  test("current-file stop retires only the cycle, leaving the process reusable", async () => {
    const events: DiagnosticEventInput[] = [];
    let activeControl: ActivePlayerControl | null = null;
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      playerControl: {
        setActive: (control) => {
          activeControl = control as ActivePlayerControl | null;
        },
      },
      launchMpv: (async (options) => {
        options.onControlReady?.({
          id: "one-shot",
          async stop() {},
          async stopCurrentFile() {},
        } as never);
        return createPlaybackResult();
      }) as typeof launchMpv,
    });

    await service.play(createStream({ subtitle: undefined }), {
      url: "https://cdn.example/show/episode.mp4",
      displayTitle: "Episode 1",
    });

    const before = internals(service).currentGeneration;
    await activeControl!.stopCurrentFile?.("user");
    const after = internals(service).currentGeneration;

    expect(after.process).toBe(before.process);
    expect(after.cycle).toBeGreaterThan(before.cycle);
  });

  test("retiring the persistent session does not invalidate the new local generation", async () => {
    const events: DiagnosticEventInput[] = [];
    const activations: PlaybackGeneration[] = [];
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      launchMpv: (async () => createPlaybackResult()) as typeof launchMpv,
    });
    (
      service as unknown as { persistentSession: { isAlive(): boolean; close(): Promise<void> } }
    ).persistentSession = {
      isAlive: () => true,
      async close() {
        await Bun.sleep(0);
      },
    };

    await service.playLocal({
      source: LOCAL_SOURCE,
      onGenerationActivated: (generation) => activations.push(generation),
    });

    expect(activations).toHaveLength(1);
    expect(internals(service).currentGeneration).toEqual(activations[0]!);
  });
});

describe("PlayerServiceImpl shutdown", () => {
  test("local playback retires a persistent player and owns the active controls", async () => {
    const events: DiagnosticEventInput[] = [];
    const lifecycle: string[] = [];
    const activeControls: unknown[] = [];
    const result = createPlaybackResult();
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
      playerControl: {
        setActive: (control) => activeControls.push(control),
      },
      launchMpv: async (options) => {
        lifecycle.push("launch-local");
        options.onControlReady?.({ id: "local" } as never);
        options.onControlReady?.(null);
        return result;
      },
    });
    (
      service as unknown as {
        persistentSession: {
          isAlive(): boolean;
          close(): Promise<void>;
        };
      }
    ).persistentSession = {
      isAlive: () => true,
      async close() {
        lifecycle.push("close-persistent");
      },
    };

    await expect(
      service.playLocal({
        source: {
          kind: "local",
          jobId: "job-1",
          titleId: "title-1",
          titleName: "Offline episode",
          mediaKind: "series",
          providerId: "provider-1",
          season: 1,
          episode: 2,
          filePath: "C:\\media\\episode-2.mkv",
        },
      }),
    ).resolves.toMatchObject({ endReason: "quit" });

    expect(lifecycle).toEqual(["close-persistent", "launch-local"]);
    expect(
      activeControls.map((control) => (control as { id?: string } | null)?.id ?? null),
    ).toEqual([null, "local", null]);
  });

  test.each([
    ["movie", 1, 1, "Dune: Part Two  ·  Movie  ·  local"],
    ["series", 1, 3, "Dune: Part Two  ·  S01E03  ·  local"],
    ["anime", 1, 3, "Dune: Part Two  ·  E03  ·  local"],
    ["video", 1, 1, "Dune: Part Two  ·  Video  ·  local"],
  ] as const)(
    "local playback names a %s through the canonical presentation seam",
    async (mediaKind, season, episode, expected) => {
      const events: DiagnosticEventInput[] = [];
      const result = createPlaybackResult();
      let launchedTitle: string | undefined;
      const { service } = createService(events, {
        presentation: { isInteractiveShellMounted: () => true },
        launchMpv: async (options) => {
          launchedTitle = options.displayTitle;
          return result;
        },
      });

      await service.playLocal({
        source: {
          kind: "local",
          jobId: "job-1",
          titleId: "title-1",
          titleName: "Dune: Part Two",
          mediaKind,
          providerId: "provider-1",
          season,
          episode,
          filePath: "/media/file.mkv",
        },
      });

      expect(launchedTitle).toBe(expected);
    },
  );

  test("release waits for and closes a persistent player still being created", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    let resolveCreation!: (session: unknown) => void;
    let closed = false;
    const creation = new Promise<unknown>((resolve) => {
      resolveCreation = resolve;
    });
    (
      service as unknown as {
        persistentSessionCreation: Promise<unknown>;
      }
    ).persistentSessionCreation = creation;

    const release = service.releasePersistentSession();
    await Bun.sleep(0);
    expect(closed).toBe(false);

    resolveCreation({
      isAlive: () => true,
      async close() {
        closed = true;
      },
    });
    await release;

    expect(closed).toBe(true);
  });

  test("coalesces concurrent persistent-session releases", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    let resolveClose!: () => void;
    let closeCalls = 0;
    (
      service as unknown as {
        persistentSession: {
          isAlive(): boolean;
          close(): Promise<void>;
        };
      }
    ).persistentSession = {
      isAlive: () => true,
      async close() {
        closeCalls += 1;
        await new Promise<void>((resolve) => {
          resolveClose = resolve;
        });
      },
    };

    const first = service.releasePersistentSession();
    const second = service.releasePersistentSession();
    await Bun.sleep(0);
    expect(closeCalls).toBe(1);

    resolveClose();
    await Promise.all([first, second]);
    expect(closeCalls).toBe(1);
  });

  test("rejects a concurrent handoff instead of spawning a second player", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events, {
      presentation: { isInteractiveShellMounted: () => true },
    });
    let resolvePlayback!: (result: PlaybackResult) => void;
    let launches = 0;
    (
      service as unknown as {
        playOneShotStream: () => Promise<PlaybackResult>;
      }
    ).playOneShotStream = async () => {
      launches += 1;
      return await new Promise<PlaybackResult>((resolve) => {
        resolvePlayback = resolve;
      });
    };

    const first = service.play(createStream(), {
      url: "https://cdn.example/show/episode.mp4",
      displayTitle: "Episode 1",
    });
    await Bun.sleep(0);

    await expect(
      service.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4",
        displayTitle: "Episode 2",
      }),
    ).rejects.toThrow("playback already in progress");
    expect(launches).toBe(1);

    resolvePlayback(createPlaybackResult());
    await expect(first).resolves.toMatchObject({ endReason: "quit" });
  });

  test("play rejects when shutting down or aborted", async () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    service.beginShutdown();

    await expect(
      service.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4",
        displayTitle: "Demo",
      }),
    ).rejects.toBeInstanceOf(PlaybackAbortedError);

    const live = new PlayerServiceImpl({
      logger: {
        child: () => {
          throw new Error("not used");
        },
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
      },
      tracer: {
        span: async <T>(_name: string, fn: () => Promise<T>) => await fn(),
        getCurrentTrace: () => null,
        getCurrentSpan: () => null,
      },
      diagnostics: { record: () => {} },
      playerControl: { setActive: () => {} },
      config: { getRaw: () => ({}) },
    } as never);
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      live.play(createStream(), {
        url: "https://cdn.example/show/episode.mp4",
        displayTitle: "Demo",
        abortSignal: abortController.signal,
      }),
    ).rejects.toBeInstanceOf(PlaybackAbortedError);
  });

  test("killActiveMpvProcessesSync SIGKILLs registered children", () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    let killedWith: NodeJS.Signals | undefined;
    registerMpvProcess({
      kill(signal?: NodeJS.Signals) {
        killedWith = signal;
      },
    });

    service.killActiveMpvProcessesSync();
    expect(killedWith).toBe("SIGKILL");
  });
});
