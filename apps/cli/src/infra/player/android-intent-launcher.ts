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

const PRESERVED_ANDROID_ENV_KEYS = [
  "ANDROID_ROOT",
  "ANDROID_DATA",
  "BOOTCLASSPATH",
  "DEX2OATBOOTCLASSPATH",
  "LD_LIBRARY_PATH",
  "TERMUX_VERSION",
] as const;

export type ScrubbedIntentEnv = {
  PATH: string;
  HOME: string;
  PREFIX: string;
  TMPDIR: string;
  ANDROID_ROOT?: string;
  ANDROID_DATA?: string;
  BOOTCLASSPATH?: string;
  DEX2OATBOOTCLASSPATH?: string;
  LD_LIBRARY_PATH?: string;
  TERMUX_VERSION?: string;
};

/**
 * Launcher children get a scrubbed environment: PATH/HOME/PREFIX/TMPDIR plus
 * the Android runtime vars `/system/bin/am` needs to boot ART's `app_process`
 * when `termux-am` is absent — never inherited shell secrets.
 */
export function scrubbedIntentEnv(
  sourceEnv: Readonly<Record<string, string | undefined>> = process.env,
): ScrubbedIntentEnv {
  const env: ScrubbedIntentEnv = {
    PATH: sourceEnv.PATH ?? "/system/bin:/system/xbin",
    HOME: sourceEnv.HOME ?? "/data/data/com.termux/files/home",
    PREFIX: sourceEnv.PREFIX ?? "/data/data/com.termux/files/usr",
    TMPDIR: sourceEnv.TMPDIR ?? "/data/data/com.termux/files/usr/tmp",
  };
  for (const key of PRESERVED_ANDROID_ENV_KEYS) {
    const value = sourceEnv[key];
    if (value) env[key] = value;
  }
  return env;
}

export const defaultAndroidIntentRuntime: AndroidIntentRuntime = {
  which: (command) => Bun.which(command),
  spawn: (argv) =>
    Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: scrubbedIntentEnv(),
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

  if (input.target === "chooser") {
    const termuxOpen = input.runtime.which("termux-open");
    if (termuxOpen) {
      return {
        ok: true,
        launcher: "termux-open",
        argv: [termuxOpen, "--view", "--chooser", "--content-type", "video/*", input.url],
      };
    }
  }

  const am = input.runtime.which("am");
  if (am) {
    return {
      ok: true,
      launcher: "am",
      argv: actionViewArgv(am, input.target, input.url, subtitles),
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

function errorDetail(error: Error | string | undefined): string | undefined {
  if (error instanceof Error) return boundedDiagnostic(error.message);
  return error === undefined ? undefined : boundedDiagnostic(error);
}

function reportsMissingPlayer(detail: string): boolean {
  return /error type 3|unable to resolve intent|no activity found|activity not found|does not exist/iu.test(
    detail,
  );
}

function reportsLaunchError(detail: string): boolean {
  return /^\s*(?:error(?:\s+type\s+\d+)?\s*:|java\.lang\.securityexception|securityexception\b)/imu.test(
    detail,
  );
}

export async function launchAndroidIntent(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly subtitles?: readonly string[];
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
    const combinedOutput = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    if (input.target !== "chooser" && combinedOutput && reportsMissingPlayer(combinedOutput)) {
      return {
        ok: false,
        reason: "player-not-installed",
        launcher: command.launcher,
        detail: boundedDiagnostic(combinedOutput),
      };
    }
    if (exitCode === 0 && (!combinedOutput || !reportsLaunchError(combinedOutput))) {
      return { ok: true, launcher: command.launcher };
    }

    const rawDetail = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
    const detail = boundedDiagnostic(rawDetail);
    return { ok: false, reason: "launch-rejected", launcher: command.launcher, detail };
  } catch (error) {
    return {
      ok: false,
      reason: "launch-rejected",
      launcher: command.launcher,
      detail: errorDetail(error instanceof Error ? error : undefined),
    };
  }
}
