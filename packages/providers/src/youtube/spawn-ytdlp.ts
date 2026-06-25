const DEFAULT_YTDLP_TIMEOUT_MS = 45_000;
const DEFAULT_YTDLP_STDOUT_LIMIT_BYTES = 16 * 1024 * 1024;
const DEFAULT_YTDLP_STDERR_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_YTDLP_EXIT_GRACE_MS = 2_500;
const DEFAULT_STREAMING_STDERR_LIMIT_BYTES = 64 * 1024;

export type YtDlpProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill: (signal?: string | number) => void;
};

export type YtDlpSpawn = (command: readonly string[]) => YtDlpProcess;

export type SpawnYtDlpOptions = {
  readonly args: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly exitGraceMs?: number;
  readonly spawn?: YtDlpSpawn;
};

export type SpawnYtDlpResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type RunYtDlpProcessOptions = {
  readonly args: readonly string[];
  readonly signal?: AbortSignal;
  readonly maxStderrBytes?: number;
  readonly exitGraceMs?: number;
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
  readonly spawn?: YtDlpSpawn;
};

export type RunYtDlpProcessHandle = {
  readonly process: YtDlpProcess;
  readonly completed: Promise<{ exitCode: number; stderr: string }>;
  cancel: (reason?: string) => void;
};

const defaultYtDlpSpawn: YtDlpSpawn = (command) =>
  Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  }) as YtDlpProcess;

export function runYtDlpProcess(options: RunYtDlpProcessOptions): RunYtDlpProcessHandle {
  if (options.signal?.aborted) {
    throw new Error("yt-dlp cancelled before start");
  }

  const spawn = options.spawn ?? defaultYtDlpSpawn;
  const proc = spawn(["yt-dlp", ...options.args]);
  const ioController = new AbortController();
  let cancelled = false;
  let terminated = false;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;
  const exitGraceMs = options.exitGraceMs ?? DEFAULT_YTDLP_EXIT_GRACE_MS;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_STREAMING_STDERR_LIMIT_BYTES;

  const terminate = () => {
    if (terminated) return;
    terminated = true;
    killYtDlp(proc, "SIGTERM");
    forceKillId ??= setTimeout(() => killYtDlp(proc, "SIGKILL"), exitGraceMs);
  };

  const onAbort = () => {
    cancelled = true;
    ioController.abort(new Error("yt-dlp cancelled"));
    terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let stderrAcc = "";
  const stdoutPromise = readStreamLines({
    stream: proc.stdout,
    signal: ioController.signal,
    onLine: (line) => options.onStdoutLine?.(line),
  });
  const stderrPromise = readStreamLines({
    stream: proc.stderr,
    signal: ioController.signal,
    maxBytes: maxStderrBytes,
    label: "yt-dlp stderr",
    onLine: (line) => {
      stderrAcc = appendBoundedText(stderrAcc, line, maxStderrBytes);
      options.onStderrLine?.(line);
    },
  });

  const completed = (async (): Promise<{ exitCode: number; stderr: string }> => {
    try {
      const [exitCode] = await Promise.all([proc.exited, stdoutPromise, stderrPromise]);
      if (cancelled || options.signal?.aborted) {
        throw new Error("yt-dlp cancelled");
      }
      return { exitCode, stderr: stderrAcc };
    } catch (error) {
      terminate();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      await settleYtDlpProcess({
        proc,
        stdoutPromise: stdoutPromise.then(() => ""),
        stderrPromise: stderrPromise.then(() => ""),
        exitGraceMs,
      });
      if (forceKillId !== undefined) clearTimeout(forceKillId);
    }
  })();

  return {
    process: proc,
    completed,
    cancel: (reason?: string) => {
      cancelled = true;
      ioController.abort(new Error(reason ?? "yt-dlp cancelled"));
      terminate();
    },
  };
}

export async function spawnYtDlpWithTimeout(options: SpawnYtDlpOptions): Promise<SpawnYtDlpResult> {
  if (options.signal?.aborted) {
    throw new Error("yt-dlp cancelled before start");
  }

  const spawn = options.spawn ?? defaultYtDlpSpawn;
  const proc = spawn(["yt-dlp", ...options.args]);

  const abort = options.signal;
  const ioController = new AbortController();
  let terminationReason: Error | null = null;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;
  const terminate = (reason: Error) => {
    terminationReason ??= reason;
    ioController.abort(reason);
    killYtDlp(proc);
    forceKillId ??= setTimeout(() => killYtDlp(proc, "SIGKILL"), options.exitGraceMs ?? 2_500);
  };
  const onAbort = () => {
    terminate(new Error("yt-dlp cancelled"));
  };
  abort?.addEventListener("abort", onAbort, { once: true });

  const timeoutMs = options.timeoutMs ?? DEFAULT_YTDLP_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`yt-dlp timed out after ${timeoutMs}ms`);
      terminate(error);
      reject(error);
    }, timeoutMs);
  });

  const stdoutPromise = readStreamText({
    stream: proc.stdout,
    maxBytes: options.maxStdoutBytes ?? DEFAULT_YTDLP_STDOUT_LIMIT_BYTES,
    label: "yt-dlp stdout",
    signal: ioController.signal,
  });
  const stderrPromise = readStreamText({
    stream: proc.stderr,
    maxBytes: options.maxStderrBytes ?? DEFAULT_YTDLP_STDERR_LIMIT_BYTES,
    label: "yt-dlp stderr",
    signal: ioController.signal,
  });

  try {
    const result = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, proc.exited]),
      timeoutPromise,
    ]);
    const [stdout, stderr, exitCode] = result;
    if (terminationReason) throw terminationReason;
    return { stdout, stderr, exitCode };
  } catch (error) {
    terminate(error instanceof Error ? error : new Error("yt-dlp failed"));
    throw terminationReason ?? error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    abort?.removeEventListener("abort", onAbort);
    await settleYtDlpProcess({
      proc,
      stdoutPromise,
      stderrPromise,
      exitGraceMs: options.exitGraceMs ?? DEFAULT_YTDLP_EXIT_GRACE_MS,
    });
    if (forceKillId !== undefined) clearTimeout(forceKillId);
  }
}

function killYtDlp(proc: YtDlpProcess, signal?: string | number): void {
  try {
    proc.kill(signal);
  } catch {
    // Process may already be gone.
  }
}

async function settleYtDlpProcess(options: {
  readonly proc: YtDlpProcess;
  readonly stdoutPromise: Promise<string>;
  readonly stderrPromise: Promise<string>;
  readonly exitGraceMs: number;
}): Promise<void> {
  await Promise.race([
    Promise.allSettled([options.stdoutPromise, options.stderrPromise, options.proc.exited]),
    new Promise((resolve) => setTimeout(resolve, options.exitGraceMs)),
  ]);
}

async function readStreamText(options: {
  readonly stream: ReadableStream<Uint8Array>;
  readonly maxBytes: number;
  readonly label: string;
  readonly signal: AbortSignal;
}): Promise<string> {
  const reader = options.stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  const cancelReader = () => {
    void reader.cancel(options.signal.reason).catch(() => undefined);
  };
  options.signal.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      if (options.signal.aborted) throw options.signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > options.maxBytes) {
        throw new Error(`${options.label} exceeded ${options.maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    options.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

async function readStreamLines(options: {
  readonly stream: ReadableStream<Uint8Array>;
  readonly signal: AbortSignal;
  readonly onLine: (line: string) => void;
  readonly maxBytes?: number;
  readonly label?: string;
}): Promise<void> {
  const reader = options.stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  const cancelReader = () => {
    void reader.cancel(options.signal.reason).catch(() => undefined);
  };
  options.signal.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      if (options.signal.aborted) throw options.signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      if (options.maxBytes !== undefined) {
        bytes += value.byteLength;
        if (bytes > options.maxBytes) {
          throw new Error(`${options.label ?? "yt-dlp stream"} exceeded ${options.maxBytes} bytes`);
        }
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        options.onLine(line);
      }
    }
    const trailing = buffer.replace(/\r$/, "");
    if (trailing.length > 0) {
      options.onLine(trailing);
    }
  } finally {
    options.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function appendBoundedText(existing: string, line: string, maxBytes: number): string {
  const next = existing.length > 0 ? `${existing}\n${line}` : line;
  if (next.length <= maxBytes) return next;
  return next.slice(-maxBytes);
}
