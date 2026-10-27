import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";

export type AndroidIntentLauncher = "termux-am" | "am" | "termux-open" | "termux-open-url";
export type AndroidIntentFailure =
  | "intent-launcher-missing"
  | "player-not-installed"
  | "launch-rejected";

interface AndroidIntentProcess {
  readonly exited: Promise<number>;
  readonly stdout?: ReadableStream<Uint8Array> | null;
  readonly stderr?: ReadableStream<Uint8Array> | null;
}

export interface AndroidIntentRuntime {
  readonly which: (command: string) => string | null;
  readonly spawn: (
    argv: readonly string[],
    options: { readonly signal: AbortSignal },
  ) => AndroidIntentProcess;
}

type AndroidIntentTimer = ReturnType<typeof setTimeout> | number;

export interface AndroidIntentTimers {
  readonly setTimeout: (callback: () => void, delayMs: number) => AndroidIntentTimer;
  readonly clearTimeout: (handle: AndroidIntentTimer) => void;
}

export type AndroidIntentCommand =
  | {
      readonly ok: true;
      readonly launcher: AndroidIntentLauncher;
      readonly argv: readonly string[];
    }
  | { readonly ok: false; readonly reason: "intent-launcher-missing" };

export type AndroidIntentLaunchResult =
  | { readonly ok: true; readonly launcher: AndroidIntentLauncher }
  | {
      readonly ok: false;
      readonly reason: AndroidIntentFailure;
      readonly launcher?: AndroidIntentLauncher;
      readonly detail?: string;
    };

const PLAYER_PACKAGES = {
  mpv: "is.xyz.mpv",
  vlc: "org.videolan.vlc",
} as const;

const MAX_DIAGNOSTIC_LENGTH = 2_048;
const MAX_OUTPUT_BYTES = 64 * 1024;
const LAUNCH_TIMEOUT_MS = 10_000;
const defaultTimers: AndroidIntentTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Launcher children get a scrubbed environment: the process only needs PATH
 * to find sibling Termux tools and HOME/PREFIX/TMPDIR for its own bookkeeping
 * — never inherited secrets from the shell's environment. Built per-spawn so
 * tests and the agent loop can still redirect the env.
 */
function scrubbedIntentEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/system/bin:/system/xbin",
    HOME: process.env.HOME ?? "/data/data/com.termux/files/home",
    PREFIX: process.env.PREFIX ?? "/data/data/com.termux/files/usr",
    TMPDIR: process.env.TMPDIR ?? "/data/data/com.termux/files/usr/tmp",
  };
}

export const defaultAndroidIntentRuntime: AndroidIntentRuntime = {
  which: (command) => Bun.which(command),
  spawn: (argv, { signal }) =>
    Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: scrubbedIntentEnv(),
      signal,
      killSignal: "SIGKILL",
      maxBuffer: 2 * MAX_OUTPUT_BYTES,
    }),
};

function actionViewArgv(
  executable: string,
  target: DetachedPlayerTarget,
  url: string,
  subtitles: readonly string[],
): readonly string[] {
  const argv = [
    executable,
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url,
    "-t",
    "video/*",
  ];
  if (target !== "chooser") argv.push("-p", PLAYER_PACKAGES[target]);
  // Subtitle extras are per-package: mpv-android reads a `subs` string list,
  // VLC reads `subtitles_location`. Both are gateway URLs — the raw provider
  // subtitle URL would land without the headers it needs.
  if (target === "mpv" && subtitles.length > 0) {
    argv.push("--esa", "subs", subtitles.join(","));
  }
  if (target === "vlc" && subtitles[0]) {
    argv.push("--es", "subtitles_location", subtitles[0]);
  }
  return argv;
}

export function resolveAndroidIntentCommand(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly subtitles?: readonly string[];
  readonly runtime: AndroidIntentRuntime;
}): AndroidIntentCommand {
  const subtitles = input.subtitles ?? [];
  const termuxAm = input.runtime.which("termux-am");
  if (termuxAm) {
    return {
      ok: true,
      launcher: "termux-am",
      argv: actionViewArgv(termuxAm, input.target, input.url, subtitles),
    };
  }

  const am = input.runtime.which("am");
  if (am) {
    return {
      ok: true,
      launcher: "am",
      argv: actionViewArgv(am, input.target, input.url, subtitles),
    };
  }

  const termuxOpen = input.runtime.which("termux-open");
  if (termuxOpen && input.target === "chooser") {
    return {
      ok: true,
      launcher: "termux-open",
      argv: [termuxOpen, "--view", "--chooser", "--content-type", "video/*", input.url],
    };
  }

  const termuxOpenUrl = input.runtime.which("termux-open-url");
  if (termuxOpenUrl && input.target === "chooser") {
    return {
      ok: true,
      launcher: "termux-open-url",
      argv: [termuxOpenUrl, input.url],
    };
  }

  return { ok: false, reason: "intent-launcher-missing" };
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) url.searchParams.set(key, "REDACTED");
    return url.toString();
  } catch {
    return "[redacted-url]";
  }
}

function boundedDiagnostic(value: string): string | undefined {
  const normalized = value.trim().replace(/https?:\/\/[^\s]+/giu, (url) => redactUrl(url));
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

async function readOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_OUTPUT_BYTES) {
        cancel();
        throw new Error("Android launcher output exceeded 64 KiB");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function errorDetail(error: Error | string | undefined): string | undefined {
  if (error instanceof Error) return boundedDiagnostic(error.message);
  return error === undefined ? undefined : boundedDiagnostic(error);
}

function reportsMissingPlayer(detail: string): boolean {
  return /error type 3|unable to resolve intent|no activity found|activity not found|does not exist/iu.test(
    detail,
  );
}

export async function launchAndroidIntent(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly subtitles?: readonly string[];
  readonly runtime?: AndroidIntentRuntime;
  readonly signal?: AbortSignal;
  readonly timers?: AndroidIntentTimers;
}): Promise<AndroidIntentLaunchResult> {
  if (input.signal?.aborted) throw new DOMException("playback aborted", "AbortError");
  const runtime = input.runtime ?? defaultAndroidIntentRuntime;
  const command = resolveAndroidIntentCommand({ ...input, runtime });
  if (!command.ok) return command;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(new DOMException("playback aborted", "AbortError"));
  input.signal?.addEventListener("abort", onParentAbort, { once: true });
  if (input.signal?.aborted) onParentAbort();
  const { promise: aborted, reject: rejectAbort } = Promise.withResolvers<never>();
  // spawn can throw before the exit/output race installs its handlers.
  void aborted.catch(() => {});
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timers = input.timers ?? defaultTimers;
  const deadline = timers.setTimeout(
    () => controller.abort(new Error("Android player launch timed out")),
    LAUNCH_TIMEOUT_MS,
  );
  try {
    controller.signal.throwIfAborted();
    const process = runtime.spawn(command.argv, { signal: controller.signal });
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([
        process.exited,
        readOutput(process.stdout, controller.signal),
        readOutput(process.stderr, controller.signal),
      ]),
      aborted,
    ]);
    controller.signal.throwIfAborted();
    if (exitCode === 0) return { ok: true, launcher: command.launcher };

    const rawDetail = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
    const detail = boundedDiagnostic(rawDetail);
    if (input.target !== "chooser" && reportsMissingPlayer(rawDetail)) {
      return {
        ok: false,
        reason: "player-not-installed",
        launcher: command.launcher,
        detail,
      };
    }
    return { ok: false, reason: "launch-rejected", launcher: command.launcher, detail };
  } catch (error) {
    // Abort also kills the native launcher and releases any pending pipe reads.
    controller.abort(error);
    if (input.signal?.aborted) throw new DOMException("playback aborted", "AbortError");
    return {
      ok: false,
      reason: "launch-rejected",
      launcher: command.launcher,
      detail: errorDetail(error instanceof Error ? error : undefined),
    };
  } finally {
    timers.clearTimeout(deadline);
    controller.signal.removeEventListener("abort", onAbort);
    input.signal?.removeEventListener("abort", onParentAbort);
  }
}
