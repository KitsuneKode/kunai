import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";

export type AndroidIntentLauncher = "termux-am" | "am" | "termux-open-url";
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
  readonly spawn: (argv: readonly string[]) => AndroidIntentProcess;
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

export const defaultAndroidIntentRuntime: AndroidIntentRuntime = {
  which: (command) => Bun.which(command),
  spawn: (argv) =>
    Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }),
};

function actionViewArgv(
  executable: string,
  target: DetachedPlayerTarget,
  url: string,
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
  return argv;
}

export function resolveAndroidIntentCommand(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly runtime: AndroidIntentRuntime;
}): AndroidIntentCommand {
  const termuxAm = input.runtime.which("termux-am");
  if (termuxAm) {
    return {
      ok: true,
      launcher: "termux-am",
      argv: actionViewArgv(termuxAm, input.target, input.url),
    };
  }

  const am = input.runtime.which("am");
  if (am) {
    return {
      ok: true,
      launcher: "am",
      argv: actionViewArgv(am, input.target, input.url),
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

async function readOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) return boundedDiagnostic(error.message);
  if (typeof error === "string") return boundedDiagnostic(error);
  return undefined;
}

function reportsMissingPlayer(detail: string): boolean {
  return /error type 3|unable to resolve intent|no activity found|activity not found|does not exist/iu.test(
    detail,
  );
}

export async function launchAndroidIntent(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly runtime?: AndroidIntentRuntime;
}): Promise<AndroidIntentLaunchResult> {
  const runtime = input.runtime ?? defaultAndroidIntentRuntime;
  const command = resolveAndroidIntentCommand({ ...input, runtime });
  if (!command.ok) return command;

  try {
    const process = runtime.spawn(command.argv);
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      readOutput(process.stdout),
      readOutput(process.stderr),
    ]);
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
    return {
      ok: false,
      reason: "launch-rejected",
      launcher: command.launcher,
      detail: errorDetail(error),
    };
  }
}
