import { describe, expect, test } from "bun:test";

import { spawnYtDlpWithTimeout, type YtDlpProcess } from "../../src/youtube/spawn-ytdlp";

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

function createFakeProcess(options: {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly onKill: (signal: string | number | undefined) => void;
}): YtDlpProcess {
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
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
