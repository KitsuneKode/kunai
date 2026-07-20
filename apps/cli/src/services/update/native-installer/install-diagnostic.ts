import { existsSync } from "node:fs";
import { win32 } from "node:path";

import { readInstallManifest, type InstallManifest } from "../install-manifest";
import { detectInstallMethod } from "../install-method";
import { findKunaiPathCandidates } from "../path-candidates";
import { getInstallLayoutPaths } from "./install-layout";

export type InstallDiagnostic = {
  readonly level: "info" | "warn" | "error";
  readonly code: string;
  readonly message: string;
};

export type GetInstallDiagnosticsInput = {
  readonly pathValue?: string;
  readonly pathExt?: string;
  readonly platform?: NodeJS.Platform;
  readonly fileExists?: (path: string) => boolean;
  readonly readManifest?: () => Promise<InstallManifest | null>;
};

function pathsMatch(left: string, right: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
  }
  return left === right;
}

/**
 * Install health checks: manifest vs reality, stale npm alongside native, etc.
 */
export async function getInstallDiagnostics(
  input: GetInstallDiagnosticsInput = {},
): Promise<InstallDiagnostic[]> {
  const fileExists = input.fileExists ?? existsSync;
  const platform = input.platform ?? process.platform;
  const pathValue = input.pathValue ?? process.env.PATH ?? "";
  const manifest = await (input.readManifest ?? readInstallManifest)();
  const detected = detectInstallMethod({ fileExists, platform });
  const pathCandidates = findKunaiPathCandidates({
    pathValue,
    pathExt: input.pathExt ?? process.env.PATHEXT,
    platform,
    fileExists,
  });
  const messages: InstallDiagnostic[] = [];

  const pathWinner = pathCandidates[0];
  if (pathWinner) {
    messages.push({
      level: "info",
      code: "path-winner",
      message: `PATH resolves kunai to ${pathWinner.path}.`,
    });
  }

  if (manifest && manifest.channel !== detected.kind && detected.kind !== "unknown") {
    messages.push({
      level: "warn",
      code: "manifest-mismatch",
      message: `install.json says ${manifest.channel} but runtime looks like ${detected.kind}.`,
    });
  }

  if (manifest?.channel === "binary") {
    const layout = getInstallLayoutPaths({ launcherPath: manifest.binPath, platform });
    if (
      manifest.layout === "versioned" &&
      manifest.versionPath &&
      !fileExists(manifest.versionPath)
    ) {
      messages.push({
        level: "error",
        code: "missing-version-binary",
        message: `Versioned binary missing at ${manifest.versionPath}. Run kunai upgrade.`,
      });
    }
    if (!fileExists(layout.launcherPath)) {
      messages.push({
        level: "error",
        code: "missing-launcher",
        message: `Launcher missing at ${layout.launcherPath}.`,
      });
    }
  }

  if (pathCandidates.length > 1) {
    messages.push({
      level: "warn",
      code: "multiple-path-binaries",
      message: `Multiple kunai binaries on PATH (${pathCandidates.length} candidates).`,
    });
  }

  if (
    manifest?.channel === "binary" &&
    pathWinner &&
    !pathsMatch(pathWinner.path, manifest.binPath, platform) &&
    pathCandidates.some((candidate) => pathsMatch(candidate.path, manifest.binPath, platform))
  ) {
    messages.push({
      level: "warn",
      code: "launcher-shadowed",
      message: `Native launcher ${manifest.binPath} is shadowed by ${pathWinner.path}.`,
    });
  }

  if (manifest?.channel === "binary" && detected.kind === "npm-global") {
    messages.push({
      level: "warn",
      code: "stale-npm-global",
      message: "npm global kunai still present alongside native binary install.",
    });
  }

  if (!messages.length) {
    messages.push({
      level: "info",
      code: "ok",
      message: manifest
        ? `Install OK (${manifest.channel}, v${manifest.version}).`
        : `Install detected as ${detected.label}.`,
    });
  }

  return messages;
}
