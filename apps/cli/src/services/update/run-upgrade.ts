import { existsSync } from "node:fs";

import {
  readInstallManifest,
  writeInstallManifest,
  type InstallManifest,
  type WriteInstallManifestInput,
} from "./install-manifest";
import { detectInstallMethod, type InstallMethodKind } from "./install-method";
import { getInstallDiagnostics } from "./native-installer/install-diagnostic";
import { installLatest } from "./native-installer/install-latest";
import { migrateFlatInstall } from "./native-installer/migrate-flat-install";
import { isMuslEnvironmentSync } from "./native-installer/musl";
import { detectPlatform } from "./platform-assets";
import { resolveLatestVersion } from "./resolve-latest-version";
import { inspectPackageInstall, type PackageInstallEvidence } from "./run-install";
import { planUpgrade } from "./upgrade-planner";
import { normalizeRequestedVersion } from "./version";

const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

export type RunUpgradeOptions = {
  readonly checkOnly?: boolean;
  readonly currentVersion: string;
  /** Test seam. Mirrors `RunInstallPorts` so both commands share one shape. */
  readonly ports?: Partial<RunUpgradePorts>;
};

export interface RunUpgradePorts {
  readonly readInstallManifest: () => Promise<InstallManifest | null>;
  readonly resolveLatestVersion: (channel: InstallMethodKind) => Promise<string | null>;
  readonly runCommand: (command: readonly string[]) => Promise<number>;
  /**
   * Reads back what the package manager actually installed. Shared with
   * `runInstall` so both commands verify against one implementation.
   */
  readonly inspectPackageInstall: (method: "npm" | "bun") => Promise<PackageInstallEvidence | null>;
  readonly writeInstallManifest: (manifest: WriteInstallManifestInput) => Promise<void>;
}

const defaultPorts: RunUpgradePorts = {
  readInstallManifest: () => readInstallManifest(),
  resolveLatestVersion,
  runCommand: (command) => Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" }).exited,
  inspectPackageInstall,
  writeInstallManifest,
};

/**
 * Channel-aware `kunai upgrade`. Reads the install manifest (or falls back to the
 * `detectInstallMethod` heuristic), resolves the latest version, and either
 * installs into the versioned store (binary) or shells out to npm/bun.
 * Returns a process exit code.
 */
export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const ports: RunUpgradePorts = { ...defaultPorts, ...opts.ports };
  const manifest = await ports.readInstallManifest();
  const channel = manifest?.method ?? detectInstallMethod({ fileExists: existsSync }).kind;
  const binPath = manifest?.launcherPath ?? process.execPath;
  const dlBase = manifest?.downloadBaseUrl ?? DEFAULT_DL_BASE;

  if (opts.checkOnly) {
    const diagnostics = await getInstallDiagnostics();
    for (const d of diagnostics) {
      const prefix = d.level === "error" ? "Error" : d.level === "warn" ? "Warning" : "Info";
      console.log(`${prefix}: ${d.message}`);
    }
  }

  const latest = await ports.resolveLatestVersion(channel);
  if (!latest) {
    console.error("Could not resolve the latest version (network/API). Try again later.");
    return 1;
  }

  const { os, arch } = detectPlatform();
  const libc = os === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu";
  const plan = planUpgrade({
    channel,
    currentVersion: opts.currentVersion,
    latestVersion: latest,
    binPath,
    dlBase,
    os,
    arch,
    libc,
  });

  if (plan.kind === "up-to-date") {
    console.log(`kunai is up to date (${opts.currentVersion}).`);
    return 0;
  }

  console.log(`Update available: ${opts.currentVersion} → ${latest} (channel: ${channel}).`);
  if (opts.checkOnly) return 0;

  if (plan.kind === "manual") {
    console.log(plan.message);
    return 0;
  }

  if (plan.kind === "exec") {
    const code = await ports.runCommand(plan.command);
    if (code !== 0) return code;

    // `planUpgrade` only emits exec for the two package-manager channels.
    if (channel !== "npm-global" && channel !== "bun-global") {
      console.error(`Unexpected package-manager upgrade plan for channel ${channel}.`);
      return 1;
    }

    // Record what the package manager actually installed, never what we asked
    // for: a manifest that claims an unverified version silently corrupts every
    // later upgrade comparison and version display.
    const method = channel === "npm-global" ? "npm" : "bun";
    const evidence = await ports.inspectPackageInstall(method);
    const observed = evidence ? normalizeRequestedVersion(evidence.version) : null;
    if (!observed) {
      console.error("Could not verify the upgraded Kunai version; install manifest not updated.");
      return 1;
    }

    await ports.writeInstallManifest({
      method: channel,
      activeVersion: observed,
      launcherPath: evidence?.launcherPath ?? binPath,
      downloadBaseUrl: dlBase,
    });
    if (observed !== latest) {
      console.log(`Installed ${observed} (resolved latest was ${latest}).`);
    }
    return 0;
  }

  // Binary channel: migrate flat installs, then use versioned native installer.
  if (channel === "binary" || plan.kind === "self-replace") {
    await migrateFlatInstall({ manifest, currentVersion: opts.currentVersion });
    const result = await installLatest({ version: latest, dlBase, force: true });
    if (result.status === "installed") {
      console.log(`Updated to ${latest}.`);
      return 0;
    }
    if (result.status === "up-to-date") {
      console.log(`kunai is up to date (${opts.currentVersion}).`);
      return 0;
    }
    if (result.status === "skipped") {
      console.error("Update skipped: another install is in progress.");
      return 1;
    }
    console.error(`Update failed: ${result.error}`);
    return 1;
  }

  // Unknown ownership: guidance only — never a second in-place installer.
  console.log(
    "Unknown install ownership. Reinstall with `kunai install`, or update via your package manager (`npm`/`bun`).",
  );
  return 0;
}
