import { existsSync } from "node:fs";
import { readdir, readlink } from "node:fs/promises";
import { win32 } from "node:path";

import type { CapabilitySnapshot } from "@/ui";

import {
  inspectInstallManifest,
  type InstallManifest,
  type InstallManifestInspection,
} from "../install-manifest";
import { detectInstallMethod } from "../install-method";
import { findKunaiPathCandidates } from "../path-candidates";
import { detectPlatform, resolveReleaseBinaryTarget } from "../platform-assets";
import { parseCanonicalVersion } from "../version";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import { isMuslEnvironmentSync } from "./musl";
import { listInstallTransactions, type InstallTransactionRecord } from "./transaction";
import { inspectVersionLock, type VersionLockInspection } from "./version-lock";
import { verifyStoredVersion, type VerifyStoredVersionResult } from "./version-metadata";

export interface DoctorFinding {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly remediation: readonly string[];
}

export interface DoctorPathCandidate {
  readonly order: number;
  readonly path: string;
  readonly winner: boolean;
  readonly observedProvenance: string;
}

export interface DoctorLauncherInfo {
  readonly path: string;
  readonly exists: boolean;
  readonly kind: "symlink" | "file" | "missing" | "unknown";
  readonly target: string | null;
}

export interface DoctorVersionInfo {
  readonly version: string;
  readonly path: string;
  readonly active: boolean;
  readonly previous: boolean;
  readonly verification: VerifyStoredVersionResult["status"];
  readonly artifactSha256?: string;
  readonly detail?: string;
}

export interface DoctorLockInfo {
  readonly version: string;
  readonly inspection: VersionLockInspection;
}

export interface DoctorPlatformInfo {
  readonly os?: string;
  readonly arch?: string;
  readonly libc?: string;
  readonly targetId?: string;
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly runningExecutable: { readonly path: string; readonly version: string };
  readonly pathCandidates: readonly DoctorPathCandidate[];
  readonly manifest: InstallManifestInspection;
  readonly launcher: DoctorLauncherInfo;
  readonly versions: readonly DoctorVersionInfo[];
  readonly locks: readonly DoctorLockInfo[];
  readonly transactions: readonly InstallTransactionRecord[];
  readonly platform: DoctorPlatformInfo;
  readonly dependencies: CapabilitySnapshot;
  readonly findings: readonly DoctorFinding[];
}

export type BuildDoctorReportInput = {
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

function pathsMatch(left: string, right: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
  }
  return left === right;
}

/** Classify a PATH binary by filesystem location heuristics (read-only). */
export function observePathProvenance(candidatePath: string): string {
  const normalized = candidatePath.replaceAll("\\", "/");
  if (normalized.includes("/.bun/install/global/")) return "bun-global";
  if (
    normalized.includes("/node_modules/@kitsunekode/kunai/") ||
    normalized.includes("/npm/") ||
    /\/\.npm\//.test(normalized)
  ) {
    return "npm-global";
  }
  if (normalized.includes("/.local/src/kunai") || normalized.endsWith("/apps/cli/src/main.ts")) {
    return "source";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".ts") || normalized.endsWith(".mjs")) {
    return "unknown";
  }
  return "binary";
}

async function listInstalledVersions(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
): Promise<string[]> {
  if (!existsSync(layout.versionsDir)) return [];
  const entries = await readdir(layout.versionsDir).catch(() => [] as string[]);
  const versions: string[] = [];
  for (const entry of entries) {
    const canonical = parseCanonicalVersion(entry);
    if (!canonical) continue;
    if (existsSync(versionBinaryPath(layout, canonical))) versions.push(canonical);
  }
  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function inspectLauncher(
  launcherPath: string,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean,
): Promise<DoctorLauncherInfo> {
  if (!fileExists(launcherPath)) {
    return { path: launcherPath, exists: false, kind: "missing", target: null };
  }
  if (platform === "win32") {
    return { path: launcherPath, exists: true, kind: "file", target: null };
  }
  try {
    const target = await readlink(launcherPath);
    return { path: launcherPath, exists: true, kind: "symlink", target };
  } catch {
    return { path: launcherPath, exists: true, kind: "file", target: null };
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function collectFindings(input: {
  readonly report: Omit<DoctorReport, "findings">;
  readonly detectedKind: string;
}): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const { report, detectedKind } = input;
  const manifest = report.manifest.status === "loaded" ? report.manifest.manifest : null;

  const winner = report.pathCandidates.find((c) => c.winner);
  if (winner) {
    findings.push({
      severity: "info",
      code: "path-winner",
      message: `PATH resolves kunai to ${winner.path}.`,
      remediation: [],
    });
  }

  if (report.pathCandidates.length > 1) {
    findings.push({
      severity: "warning",
      code: "multiple-path-binaries",
      message: `Multiple kunai binaries on PATH (${report.pathCandidates.length} candidates).`,
      remediation: [
        "Ensure the intended install appears first on PATH.",
        "Remove or rename shadowed kunai binaries from earlier PATH directories.",
      ],
    });
  }

  if (report.manifest.status === "missing") {
    findings.push({
      severity: "info",
      code: "missing-manifest",
      message: `No install.json found. Detected method: ${detectedKind}.`,
      remediation: [
        "Run `kunai install` to record ownership, or continue with the detected channel.",
      ],
    });
  } else if (report.manifest.status === "invalid") {
    findings.push({
      severity: "error",
      code: "invalid-manifest",
      message: `install.json is invalid (${report.manifest.reason}).`,
      remediation: [
        "Back up ~/.config/kunai/install.json.",
        "Reinstall with `kunai install` to rewrite a valid ownership record.",
      ],
    });
  } else if (report.manifest.needsMigration) {
    findings.push({
      severity: "warning",
      code: "legacy-manifest-needs-migration",
      message:
        "Legacy install.json detected. Doctor does not migrate; upgrade/install will migrate atomically.",
      remediation: ["Run `kunai upgrade` or `kunai install` to migrate the ownership record."],
    });
  }

  if (manifest && manifest.method !== detectedKind && detectedKind !== "unknown") {
    findings.push({
      severity: "warning",
      code: "manifest-mismatch",
      message: `install.json says ${manifest.method} but runtime looks like ${detectedKind}.`,
      remediation: [
        "Confirm which install you intend to use.",
        "Reinstall with the preferred channel or remove the conflicting binary.",
      ],
    });
  }

  if (manifest?.method === "binary") {
    const activeVersion = report.versions.find((v) => v.active);
    if (
      !activeVersion ||
      activeVersion.verification === "missing-binary" ||
      (manifest.versionedPath && activeVersion.path !== manifest.versionedPath)
    ) {
      findings.push({
        severity: "error",
        code: "missing-version-binary",
        message: `Versioned binary missing at ${manifest.versionedPath ?? activeVersion?.path ?? "unknown"}.`,
        remediation: ["Run `kunai upgrade` to restore the active version."],
      });
    }
    if (!report.launcher.exists) {
      findings.push({
        severity: "error",
        code: "missing-launcher",
        message: `Launcher missing at ${report.launcher.path}.`,
        remediation: ["Run `kunai install` or `kunai upgrade` to recreate the launcher."],
      });
    }
  }

  if (
    manifest?.method === "binary" &&
    winner &&
    !pathsMatch(winner.path, manifest.launcherPath, process.platform) &&
    report.pathCandidates.some((c) => pathsMatch(c.path, manifest.launcherPath, process.platform))
  ) {
    findings.push({
      severity: "warning",
      code: "launcher-shadowed",
      message: `Native launcher ${manifest.launcherPath} is shadowed by ${winner.path}.`,
      remediation: [
        `Put ${manifest.launcherPath}'s directory earlier on PATH.`,
        "Or remove the earlier conflicting kunai binary.",
      ],
    });
  }

  if (manifest?.method === "binary" && detectedKind === "npm-global") {
    findings.push({
      severity: "warning",
      code: "stale-npm-global",
      message: "npm global kunai still present alongside native binary install.",
      remediation: ["Run `npm uninstall -g @kitsunekode/kunai` if the native install should win."],
    });
  }

  for (const lock of report.locks) {
    if (lock.inspection.status === "stale") {
      findings.push({
        severity: "warning",
        code: "stale-lock",
        message: `Stale install lock for ${lock.version}: ${lock.inspection.detail}.`,
        remediation: [
          "Doctor does not remove locks.",
          "A later `kunai upgrade` / install will reclaim stale locks automatically.",
        ],
      });
    } else if (lock.inspection.status === "active") {
      findings.push({
        severity: "info",
        code: "active-lock",
        message: `Active install lock for ${lock.version} (pid ${lock.inspection.content.pid}).`,
        remediation: [],
      });
    }
  }

  for (const txn of report.transactions) {
    if (!isProcessAlive(txn.pid)) {
      findings.push({
        severity: "warning",
        code: "abandoned-transaction",
        message: `Abandoned ${txn.kind} transaction ${txn.id} (pid ${txn.pid} not running).`,
        remediation: [
          "Doctor does not clean transactions.",
          "A later install/upgrade will remove abandoned transaction records.",
        ],
      });
    } else {
      findings.push({
        severity: "info",
        code: "active-transaction",
        message: `Active ${txn.kind} transaction ${txn.id} (pid ${txn.pid}).`,
        remediation: [],
      });
    }
  }

  for (const version of report.versions) {
    if (version.verification === "checksum-mismatch" || version.verification === "size-mismatch") {
      findings.push({
        severity: "error",
        code: `version-${version.verification}`,
        message: `Version ${version.version}: ${version.detail ?? version.verification}.`,
        remediation: ["Re-run `kunai install --force` to redownload and reverify."],
      });
    } else if (
      version.verification === "untrusted-metadata" ||
      version.verification === "invalid-metadata" ||
      version.verification === "missing-metadata"
    ) {
      findings.push({
        severity: "warning",
        code: `version-${version.verification}`,
        message: `Version ${version.version}: ${version.detail ?? version.verification}.`,
        remediation: ["Re-run `kunai upgrade` to rewrite trusted version metadata."],
      });
    }
  }

  for (const issue of report.dependencies.issues) {
    findings.push({
      severity: issue.severity === "fatal" ? "error" : "warning",
      code: issue.id,
      message: issue.message,
      remediation: [...issue.remediation],
    });
  }

  if (!findings.length) {
    findings.push({
      severity: "info",
      code: "ok",
      message: manifest
        ? `Install OK (${manifest.method}, v${manifest.activeVersion}).`
        : `Install detected as ${detectedKind}.`,
      remediation: [],
    });
  }

  return findings;
}

/**
 * Build a read-only install health report.
 * Never migrates manifests, cleans locks/transactions, or persists capability notices.
 */
export async function buildDoctorReport(input: BuildDoctorReportInput = {}): Promise<DoctorReport> {
  const platform = input.platform ?? process.platform;
  const layout = input.layout ?? getInstallLayoutPaths({ platform });
  const fileExists = input.fileExists ?? existsSync;
  const now = input.now ?? (() => new Date().toISOString());
  const runningExecutable = input.runningExecutable ?? {
    path: process.execPath,
    version: "unknown",
  };

  const inspectManifest = input.inspectManifest ?? (() => inspectInstallManifest(layout.configDir));
  const probe =
    input.probeCapabilities ??
    (async () => {
      const { probeCapabilities } = await import("@/ui");
      return probeCapabilities();
    });

  const manifest = await inspectManifest();
  const loadedManifest: InstallManifest | null =
    manifest.status === "loaded" ? manifest.manifest : null;

  const pathCandidatesRaw = findKunaiPathCandidates({
    pathValue: input.pathValue ?? process.env.PATH ?? "",
    pathExt: input.pathExt ?? process.env.PATHEXT,
    platform,
    fileExists,
  });
  const pathCandidates: DoctorPathCandidate[] = pathCandidatesRaw.map((candidate, index) => ({
    order: index,
    path: candidate.path,
    winner: index === 0,
    observedProvenance: observePathProvenance(candidate.path),
  }));

  const launcherPath = loadedManifest?.launcherPath ?? layout.launcherPath;
  const launcher = await inspectLauncher(launcherPath, platform, fileExists);

  const versionIds = await listInstalledVersions(layout);
  const versions: DoctorVersionInfo[] = [];
  for (const version of versionIds) {
    const path = versionBinaryPath(layout, version);
    const verification = await verifyStoredVersion(layout, version);
    versions.push({
      version,
      path,
      active: loadedManifest?.activeVersion === version,
      previous: loadedManifest?.previousVersion === version,
      verification: verification.status,
      ...(verification.status === "verified"
        ? { artifactSha256: verification.metadata.artifactSha256 }
        : {}),
      ...("detail" in verification && verification.detail ? { detail: verification.detail } : {}),
    });
  }

  // Also surface a missing active version when the store has no matching dir.
  if (
    loadedManifest?.method === "binary" &&
    loadedManifest.activeVersion &&
    !versions.some((v) => v.version === loadedManifest.activeVersion)
  ) {
    const path =
      loadedManifest.versionedPath ?? versionBinaryPath(layout, loadedManifest.activeVersion);
    versions.push({
      version: loadedManifest.activeVersion,
      path,
      active: true,
      previous: false,
      verification: "missing-binary",
      detail: `Missing binary at ${path}`,
    });
  }

  const lockVersions = new Set<string>([
    ...versionIds,
    ...(loadedManifest?.activeVersion ? [loadedManifest.activeVersion] : []),
    ...(loadedManifest?.previousVersion ? [loadedManifest.previousVersion] : []),
  ]);
  // Also inspect any lock files present on disk (read-only).
  if (existsSync(layout.locksDir)) {
    for (const entry of await readdir(layout.locksDir).catch(() => [] as string[])) {
      if (!entry.endsWith(".lock")) continue;
      const version = entry.slice(0, -".lock".length);
      if (parseCanonicalVersion(version)) lockVersions.add(version);
    }
  }

  const locks: DoctorLockInfo[] = [];
  for (const version of [...lockVersions].sort()) {
    locks.push({
      version,
      inspection: await inspectVersionLock(layout, version),
    });
  }

  const transactions = [...(await listInstallTransactions(layout))];

  const libc = platform === "linux" ? (isMuslEnvironmentSync() ? "musl" : "gnu") : undefined;
  const detected = detectPlatform(platform, process.arch, libc === "musl" ? "musl" : "gnu");
  const target =
    detected.os && detected.arch
      ? resolveReleaseBinaryTarget(detected.os, detected.arch, detected.libc ?? "gnu")
      : undefined;
  const platformInfo: DoctorPlatformInfo = {
    ...(detected.os ? { os: detected.os } : {}),
    ...(detected.arch ? { arch: detected.arch } : {}),
    ...(detected.libc ? { libc: detected.libc } : {}),
    ...(target ? { targetId: target.id } : {}),
  };

  const dependencies = await probe();
  const detectedMethod = detectInstallMethod({
    platform,
    fileExists,
    entrypoint: runningExecutable.path,
    packagedBinary: observePathProvenance(runningExecutable.path) === "binary",
  });

  const base: Omit<DoctorReport, "findings"> = {
    schemaVersion: 1,
    generatedAt: now(),
    runningExecutable,
    pathCandidates,
    manifest,
    launcher,
    versions,
    locks,
    transactions,
    platform: platformInfo,
    dependencies,
  };

  return {
    ...base,
    findings: collectFindings({ report: base, detectedKind: detectedMethod.kind }),
  };
}

/** Human-readable doctor output covering the same fields as the JSON report. */
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
    `  mpv=${report.dependencies.mpv ? "ok" : "missing"} yt-dlp=${report.dependencies.ytDlp ? "ok" : "missing"} ffprobe=${report.dependencies.ffprobe ? "ok" : "missing"}`,
  );
  lines.push("");
  lines.push("Findings");
  for (const finding of report.findings) {
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
