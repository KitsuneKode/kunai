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

function doctorExitCode(report: DoctorReport): number {
  return report.findings.some((finding) => finding.severity === "error") ? 1 : 0;
}

/**
 * `kunai doctor` — read-only install health report.
 * Never migrates, repairs, or cleans. Exit 1 only when findings include errors.
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
  return doctorExitCode(report);
}
