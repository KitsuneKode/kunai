import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";
import {
  resolveAndroidIntentPlan,
  type AndroidIntentLauncher,
  type AndroidIntentPlan,
} from "@kunai/core";

export type { AndroidIntentLauncher } from "@kunai/core";
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

export type AndroidIntentCommand = AndroidIntentPlan;

export type AndroidIntentLaunchResult =
  | { readonly ok: true; readonly launcher: AndroidIntentLauncher }
  | {
      readonly ok: false;
      readonly reason: AndroidIntentFailure;
      readonly launcher?: AndroidIntentLauncher;
      readonly detail?: string;
    };

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

export function resolveAndroidIntentCommand(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly runtime: AndroidIntentRuntime;
}): AndroidIntentCommand {
  return resolveAndroidIntentPlan({
    target: input.target,
    url: input.url,
    launchers: {
      termuxAm: input.runtime.which("termux-am") ?? undefined,
      am: input.runtime.which("am") ?? undefined,
      termuxOpen: input.runtime.which("termux-open") ?? undefined,
      termuxOpenUrl: input.runtime.which("termux-open-url") ?? undefined,
    },
  });
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
