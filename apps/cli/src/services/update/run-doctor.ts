import type { CapabilitySnapshot } from "@/ui";

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
  readonly probeCapabilities?: () => Promise<CapabilitySnapshot>;
};

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
  const input: BuildDoctorReportInput = {
    ...(opts.layout ? { layout: opts.layout } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.runningExecutable ? { runningExecutable: opts.runningExecutable } : {}),
    ...(opts.pathValue !== undefined ? { pathValue: opts.pathValue } : {}),
    ...(opts.pathExt !== undefined ? { pathExt: opts.pathExt } : {}),
    ...(opts.platform ? { platform: opts.platform } : {}),
    ...(opts.fileExists ? { fileExists: opts.fileExists } : {}),
    ...(opts.inspectManifest ? { inspectManifest: opts.inspectManifest } : {}),
    ...(opts.probeCapabilities ? { probeCapabilities: opts.probeCapabilities } : {}),
  };

  const report = await buildDoctorReport(input);
  if (opts.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(formatDoctorReportText(report));
  }
  return doctorExitCode(report, opts.strict === true);
}
