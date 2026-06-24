import { describe, expect, test } from "bun:test";

import type { PlaybackResult, StreamInfo } from "@/domain/types";
import { registerMpvProcess } from "@/infra/player/mpv-process-registry";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import type { PlayerPlaybackEvent, PlayerOptions } from "@/infra/player/PlayerService";
import { PlayerServiceImpl } from "@/infra/player/PlayerServiceImpl";
import type { DiagnosticEventInput } from "@/services/diagnostics/diagnostic-event";

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
  overrides: { presentation?: { isInteractiveShellMounted: () => boolean } } = {},
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

  test("runtime playback events keep diagnostic correlation", () => {
    const events: DiagnosticEventInput[] = [];
    const { service } = createService(events);
    const seen: PlayerPlaybackEvent[] = [];
    const wrap = (
      service as unknown as {
        wrapPlaybackEventHandler: (
          handler: (event: PlayerPlaybackEvent) => void,
          correlation: PlayerOptions["correlation"],
        ) => (event: PlayerPlaybackEvent) => void;
      }
    ).wrapPlaybackEventHandler.bind(service);

    wrap((event) => seen.push(event), {
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      providerAttemptId: "attempt-1",
    })({ type: "mpv-process-started" });

    expect(seen).toEqual([{ type: "mpv-process-started" }]);
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

describe("PlayerServiceImpl shutdown", () => {
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
