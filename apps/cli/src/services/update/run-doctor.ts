import type { PlayerChoice } from "@/domain/playback/player-choice";

import type { InstallManifestInspection } from "./install-manifest";
import {
  buildDoctorReport,
  formatDoctorReportText,
  type BuildDoctorReportInput,
  type DoctorReport,
} from "./native-installer/doctor";
import type { InstallLayoutPaths } from "./native-installer/install-layout";

export type RunDoctorOptions = {
  readonly json?: boolean;
  /** Treat any finding, not just an error, as an unhealthy install. */
  readonly strict?: boolean;
  readonly layout?: InstallLayoutPaths;
  readonly now?: () => string;
  readonly runningExecutable?: { readonly path: string; readonly version: string };
  readonly pathValue?: string;
  readonly pathExt?: string;
  readonly platform?: NodeJS.Platform;
  readonly fileExists?: (path: string) => boolean;
  readonly inspectManifest?: () => Promise<InstallManifestInspection>;
  readonly probeCapabilities?: BuildDoctorReportInput["probeCapabilities"];
  /** Effective player choice; auto when the caller does not compose config/flags. */
  readonly playerChoice?: PlayerChoice;
  readonly installedPlayers?: BuildDoctorReportInput["installedPlayers"];
  readonly playerMode?: BuildDoctorReportInput["playerMode"];
  /** Raw maintenance argv, used only to honor a `--player` override before saved config. */
  readonly argv?: readonly string[];
};

type MutableBuildDoctorReportInput = {
  -readonly [K in keyof BuildDoctorReportInput]?: BuildDoctorReportInput[K];
};

export async function readConfiguredPlayerChoice(): Promise<PlayerChoice> {
  try {
    const { getKunaiPaths } = await import("@kunai/storage");
    // SAFETY: config.json is user-owned JSON; the player field is validated by the literal check below.
    const raw = (await Bun.file(getKunaiPaths().configPath).json()) as { player?: unknown };
    return raw.player === "mpv" || raw.player === "vlc" ? raw.player : "auto";
  } catch {
    return "auto";
  }
}

async function resolvePlayerChoiceForDoctor(
  opts: Pick<RunDoctorOptions, "argv" | "playerChoice">,
): Promise<
  | { readonly ok: true; readonly value: PlayerChoice }
  | { readonly ok: false; readonly message: string }
> {
  if (opts.playerChoice) return { ok: true, value: opts.playerChoice };
  // Embedded callers/tests get deterministic auto unless they explicitly compose
  // argv or config; only the real maintenance fast path supplies argv.
  if (opts.argv === undefined) return { ok: true, value: "auto" };
  const argv = opts.argv;
  const inline = argv.find((arg) => arg.startsWith("--player="));
  const flagIndex = argv.indexOf("--player");
  const value = inline
    ? inline.slice("--player=".length)
    : flagIndex >= 0
      ? argv[flagIndex + 1]
      : undefined;
  if (value !== undefined) {
    if (!value || value.startsWith("--")) {
      return { ok: false, message: "--player expects auto, mpv, or vlc" };
    }
    if (value === "auto" || value === "mpv" || value === "vlc") {
      return { ok: true, value };
    }
    return { ok: false, message: `Invalid --player value "${value}"; expected auto, mpv, or vlc.` };
  }
  return { ok: true, value: await readConfiguredPlayerChoice() };
}

/**
 * Exit code for a doctor report.
 *
 * Warnings do not fail by default, and that is deliberate rather than an
 * oversight: a missing mpv still leaves setup and the non-playback shell
 * working, which is why `mpv-missing` is `degraded` and not `fatal`. It is also
 * the convention every comparable tool follows.
 *
 * The gap it leaves is that a script asking "is this install healthy?" gets 0
 * for an install that cannot play a video. `--strict` is that missing mode:
 * a warning or worse becomes a non-zero exit, without changing what a human
 * sees by default.
 *
 * `info` deliberately does not fail, even in strict mode. A source install has
 * no `install.json`, and that is reported as `missing-manifest` at `info` —
 * counting it would make `--strict` fail on every correct source checkout.
 */
function doctorExitCode(report: DoctorReport, strict: boolean): number {
  if (report.findings.some((finding) => finding.severity === "error")) return 1;
  return strict && report.findings.some((finding) => finding.severity === "warning") ? 1 : 0;
}

/**
 * `kunai doctor` — read-only install health report.
 * Never migrates, repairs, or cleans. Exit 1 on an error finding, or on any
 * finding at all under `--strict`.
 */
export async function runDoctor(opts: RunDoctorOptions = {}): Promise<number> {
  const playerChoice = await resolvePlayerChoiceForDoctor(opts);
  if (!playerChoice.ok) {
    console.error(`kunai: ${playerChoice.message}`);
    return 2;
  }
  const input: MutableBuildDoctorReportInput = {
    ...(opts.layout ? { layout: opts.layout } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.runningExecutable ? { runningExecutable: opts.runningExecutable } : {}),
    ...(opts.pathValue !== undefined ? { pathValue: opts.pathValue } : {}),
    ...(opts.pathExt !== undefined ? { pathExt: opts.pathExt } : {}),
    ...(opts.platform ? { platform: opts.platform } : {}),
    ...(opts.fileExists ? { fileExists: opts.fileExists } : {}),
    ...(opts.inspectManifest ? { inspectManifest: opts.inspectManifest } : {}),
    ...(opts.probeCapabilities ? { probeCapabilities: opts.probeCapabilities } : {}),
    playerChoice: playerChoice.value,
  };
  if (opts.installedPlayers !== undefined) input.installedPlayers = opts.installedPlayers;
  if (opts.playerMode !== undefined) input.playerMode = opts.playerMode;

  const report = await buildDoctorReport(input);
  if (opts.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(formatDoctorReportText(report));
  }
  return doctorExitCode(report, opts.strict === true);
}
