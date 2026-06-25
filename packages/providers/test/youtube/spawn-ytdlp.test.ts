import { describe, expect, test } from "bun:test";

import {
  spawnYtDlpWithTimeout,
  runYtDlpProcess,
  type YtDlpProcess,
} from "../../src/youtube/spawn-ytdlp";

describe("spawnYtDlpWithTimeout", () => {
  test("kills yt-dlp when stdout exceeds the configured cap", async () => {
    const killSignals: (string | number | undefined)[] = [];
    const proc = createFakeProcess({
      stdout: streamFromText("abcdef"),
      stderr: streamFromText(""),
      onKill: (signal) => killSignals.push(signal),
    });

    await expect(
      spawnYtDlpWithTimeout({
        args: ["--dump-json"],
        maxStdoutBytes: 2,
        exitGraceMs: 5,
        spawn: () => proc,
      }),
    ).rejects.toThrow("yt-dlp stdout exceeded 2 bytes");
    expect(killSignals.length).toBeGreaterThan(0);
  });

  test("rejects and kills yt-dlp when cancelled after spawn", async () => {
    const controller = new AbortController();
    const killSignals: (string | number | undefined)[] = [];
    const proc = createFakeProcess({
      stdout: hangingStream(),
      stderr: hangingStream(),
      onKill: (signal) => killSignals.push(signal),
      autoExit: false,
    });

    const result = spawnYtDlpWithTimeout({
      args: ["--version"],
      signal: controller.signal,
      timeoutMs: 1_000,
      exitGraceMs: 5,
      spawn: () => proc,
    });

    controller.abort();

    await expect(result).rejects.toThrow("yt-dlp cancelled");
    expect(killSignals.length).toBeGreaterThan(0);
  });
});

describe("runYtDlpProcess", () => {
  test("invokes stdout line callbacks and returns exit metadata", async () => {
    const lines: string[] = [];
    const proc = createFakeProcess({
      stdout: streamFromText("[download] 42.0%\n"),
      stderr: streamFromText(""),
      onKill: () => undefined,
    });

    const handle = runYtDlpProcess({
      args: ["-o", "out.mp4", "https://example.com"],
      spawn: () => proc,
      onStdoutLine: (line) => lines.push(line),
    });

    const result = await handle.completed;
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(["[download] 42.0%"]);
  });

  test("cancel kills the process", async () => {
    const killSignals: (string | number | undefined)[] = [];
    const proc = createFakeProcess({
      stdout: hangingStream(),
      stderr: hangingStream(),
      onKill: (signal) => killSignals.push(signal),
      autoExit: false,
    });

    const handle = runYtDlpProcess({
      args: ["--version"],
      exitGraceMs: 5,
      spawn: () => proc,
    });

    handle.cancel("test cancel");
    await expect(handle.completed).rejects.toThrow("yt-dlp cancelled");
    expect(killSignals.length).toBeGreaterThan(0);
  });

  test("rejects when stderr exceeds configured cap", async () => {
    const killSignals: (string | number | undefined)[] = [];
    const proc = createFakeProcess({
      stdout: streamFromText(""),
      stderr: streamFromText("x".repeat(32)),
      onKill: (signal) => killSignals.push(signal),
    });

    const handle = runYtDlpProcess({
      args: ["--version"],
      maxStderrBytes: 8,
      exitGraceMs: 5,
      spawn: () => proc,
    });

    await expect(handle.completed).rejects.toThrow("yt-dlp stderr exceeded 8 bytes");
    expect(killSignals.length).toBeGreaterThan(0);
  });
});

function createFakeProcess(options: {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly onKill: (signal: string | number | undefined) => void;
  readonly exitCode?: number;
  readonly autoExit?: boolean;
}): YtDlpProcess {
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  if (options.autoExit !== false) {
    queueMicrotask(() => resolveExit(options.exitCode ?? 0));
  }
  return {
    stdout: options.stdout,
    stderr: options.stderr,
    exited,
    kill: (signal) => {
      options.onKill(signal);
      resolveExit(signal === "SIGKILL" ? 137 : 143);
    },
  };
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function hangingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>();
}
