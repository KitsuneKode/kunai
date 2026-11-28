import type { CurlCapability } from "@/ui";

import type { DoctorReport } from "./doctor";
import { describeMpvHwaccel } from "./mpv-hwdec-report";

/**
 * `ok` is reserved for a curl that can actually clear a Cloudflare challenge.
 * Plain curl reports `plain` rather than `ok`, because reporting it as healthy
 * is what let an empty anime-provider search look like a working install.
 */
function describeCurl(curl: CurlCapability): string {
  if (!curl.present) return "missing";
  return curl.impersonates ? `ok (${curl.profile ?? "impersonate"})` : "plain (no CF bypass)";
}

export function formatDoctorReportText(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("Kunai doctor");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("Running executable");
  lines.push(`  path: ${report.runningExecutable.path}`);
  lines.push(`  version: ${report.runningExecutable.version}`);
  lines.push("");
  lines.push("PATH candidates");
  if (!report.pathCandidates.length) {
    lines.push("  (none found)");
  } else {
    for (const candidate of report.pathCandidates) {
      const mark = candidate.winner ? " (winner)" : "";
      lines.push(
        `  ${candidate.order + 1}. ${candidate.path}${mark} [${candidate.observedProvenance}]`,
      );
    }
  }
  lines.push("");
  lines.push("Manifest");
  if (report.manifest.status === "missing") {
    lines.push("  status: missing");
  } else if (report.manifest.status === "invalid") {
    lines.push(`  status: invalid (${report.manifest.reason})`);
  } else {
    const m = report.manifest.manifest;
    lines.push(`  status: loaded${report.manifest.needsMigration ? " (needs migration)" : ""}`);
    lines.push(`  method: ${m.method}`);
    lines.push(`  activeVersion: ${m.activeVersion}`);
    if (m.previousVersion) lines.push(`  previousVersion: ${m.previousVersion}`);
    lines.push(`  launcherPath: ${m.launcherPath}`);
    if (m.versionedPath) lines.push(`  versionedPath: ${m.versionedPath}`);
    if (m.observedProvenance) lines.push(`  observedProvenance: ${m.observedProvenance}`);
    if (m.artifactSha256) lines.push(`  artifactSha256: ${m.artifactSha256}`);
  }
  lines.push("");
  lines.push("Launcher");
  lines.push(`  path: ${report.launcher.path}`);
  lines.push(`  kind: ${report.launcher.kind}`);
  if (report.launcher.target) lines.push(`  target: ${report.launcher.target}`);
  lines.push("");
  lines.push("Versions");
  if (!report.versions.length) {
    lines.push("  (none)");
  } else {
    for (const version of report.versions) {
      const flags = [
        version.active ? "active" : null,
        version.previous ? "previous" : null,
        version.verification,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  ${version.version}: ${version.path} [${flags}]`);
      if (version.artifactSha256) lines.push(`    sha256: ${version.artifactSha256}`);
      if (version.detail) lines.push(`    detail: ${version.detail}`);
    }
  }
  lines.push("");
  lines.push("Locks");
  if (!report.locks.length) {
    lines.push("  (none)");
  } else {
    for (const lock of report.locks) {
      lines.push(`  ${lock.version}: ${lock.inspection.status}`);
    }
  }
  lines.push("");
  lines.push("Transactions");
  if (!report.transactions.length) {
    lines.push("  (none)");
  } else {
    for (const txn of report.transactions) {
      lines.push(`  ${txn.id}: ${txn.kind} pid=${txn.pid} started=${txn.startedAt}`);
    }
  }
  lines.push("");
  lines.push("Platform");
  lines.push(
    `  ${
      [report.platform.os, report.platform.arch, report.platform.libc, report.platform.targetId]
        .filter(Boolean)
        .join(" / ") || "unknown"
    }`,
  );
  lines.push("");
  lines.push("Dependencies");
  lines.push(
    // curl reports what it can actually do, not merely that it exists: plain
    // curl is present nearly everywhere and still gets challenged by Cloudflare,
    // so `curl=ok` on its own was a misleading line in a health report.
    `  mpv=${report.dependencies.mpv ? "ok" : "missing"} vlc=${report.dependencies.vlc ? "ok" : "missing"} yt-dlp=${report.dependencies.ytDlp ? "ok" : "missing"} ffprobe=${report.dependencies.ffprobe ? "ok" : "missing"} curl=${describeCurl(report.dependencies.curl)}`,
  );
  const hwdecPlayback = report.playback;
  const hwdecPassed = hwdecPlayback
    ? hwdecPlayback.playerKind === "managed-mpv"
      ? hwdecPlayback.mpvHwdecEmitted === null
        ? "passes no --hwdec flag"
        : `passes --hwdec=${hwdecPlayback.mpvHwdecEmitted}`
      : `not applicable to ${hwdecPlayback.playerKind} playback`
    : "playback policy unavailable";
  const hwdecConfigured = hwdecPlayback ? `${hwdecPlayback.mpvHwdec} · ` : "";
  lines.push(
    `  mpv-hwdec=${hwdecConfigured}${hwdecPassed} · probe: ${describeMpvHwaccel(report.dependencies.mpvHardwareAccel)}`,
  );
  lines.push("");
  lines.push("Storage");
  for (const store of report.storage) {
    const state = store.writable ? "writable" : "NOT WRITABLE";
    lines.push(`  ${store.label}: ${store.path} (${store.exists ? state : `${state}, missing`})`);
  }
  lines.push("");
  lines.push("Findings");
  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  const orderedFindings = [...report.findings].sort(
    (left, right) => severityOrder[left.severity] - severityOrder[right.severity],
  );
  for (const finding of orderedFindings) {
    lines.push(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
    if (finding.remediation.length) {
      lines.push("    Remediation:");
      for (const step of finding.remediation) {
        lines.push(`      - ${step}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
