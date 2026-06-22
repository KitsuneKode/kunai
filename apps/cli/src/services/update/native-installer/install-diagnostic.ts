import { existsSync } from "node:fs";

import { readInstallManifest } from "../install-manifest";
import { detectInstallMethod } from "../install-method";
import { getInstallLayoutPaths } from "./install-layout";

export type InstallDiagnostic = {
  readonly level: "info" | "warn" | "error";
  readonly code: string;
  readonly message: string;
};

/**
 * Install health checks: manifest vs reality, stale npm alongside native, etc.
 */
export async function getInstallDiagnostics(
  fileExists: (path: string) => boolean = existsSync,
): Promise<InstallDiagnostic[]> {
  const messages: InstallDiagnostic[] = [];
  const manifest = await readInstallManifest();
  const detected = detectInstallMethod({ fileExists });

  if (manifest && manifest.channel !== detected.kind && detected.kind !== "unknown") {
    messages.push({
      level: "warn",
      code: "manifest-mismatch",
      message: `install.json says ${manifest.channel} but runtime looks like ${detected.kind}.`,
    });
  }

  if (manifest?.channel === "binary") {
    const layout = getInstallLayoutPaths({ launcherPath: manifest.binPath });
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

  const pathEntries = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const kunaiOnPath = pathEntries.filter((entry) => {
    if (!entry) return false;
    return fileExists(`${entry.replace(/[/\\]$/, "")}/kunai`) || fileExists(`${entry}/kunai.exe`);
  });
  if (kunaiOnPath.length > 1) {
    messages.push({
      level: "warn",
      code: "multiple-path-binaries",
      message: `Multiple kunai binaries on PATH (${kunaiOnPath.length} directories).`,
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
