import { existsSync } from "node:fs";

import { readInstallManifest } from "./install-manifest";
import { detectInstallMethod } from "./install-method";
import { getInstallDiagnostics } from "./native-installer/install-diagnostic";
import { installLatest } from "./native-installer/install-latest";
import { migrateFlatInstall } from "./native-installer/migrate-flat-install";
import { isMuslEnvironmentSync } from "./native-installer/musl";
import { detectPlatform } from "./platform-assets";
import { resolveLatestVersion } from "./resolve-latest-version";
import { pickChecksum, selfReplace } from "./self-replace";
import { planUpgrade } from "./upgrade-planner";

const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

export type RunUpgradeOptions = {
  readonly checkOnly?: boolean;
  readonly currentVersion: string;
};

/**
 * Channel-aware `kunai upgrade`. Reads the install manifest (or falls back to the
 * `detectInstallMethod` heuristic), resolves the latest version, and either
 * installs into the versioned store (binary) or shells out to npm/bun.
 * Returns a process exit code.
 */
export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const manifest = await readInstallManifest();
  const channel = manifest?.channel ?? detectInstallMethod({ fileExists: existsSync }).kind;
  const binPath = manifest?.binPath ?? process.execPath;
  const dlBase = manifest?.dlBase ?? DEFAULT_DL_BASE;

  if (opts.checkOnly) {
    const diagnostics = await getInstallDiagnostics();
    for (const d of diagnostics) {
      const prefix = d.level === "error" ? "Error" : d.level === "warn" ? "Warning" : "Info";
      console.log(`${prefix}: ${d.message}`);
    }
  }

  const latest = await resolveLatestVersion(channel);
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
    const proc = Bun.spawn(plan.command, { stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    if (code === 0) {
      const { writeInstallManifest } = await import("./install-manifest");
      await writeInstallManifest({ channel, version: latest, binPath, dlBase });
    }
    return code;
  }

  // Binary channel: migrate flat installs, then use versioned native installer.
  if (channel === "binary") {
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

  // Fallback: in-place self-replace for unknown binary-like paths.
  const [binRes, sumRes] = await Promise.all([fetch(plan.downloadUrl), fetch(plan.checksumUrl)]);
  if (!binRes.ok || !sumRes.ok) {
    console.error(
      `Download failed (binary ${binRes.status}, checksums ${sumRes.status}). Try \`--method npm\` or retry.`,
    );
    return 1;
  }
  const expected = pickChecksum(await sumRes.text(), plan.assetName);
  if (!expected) {
    console.error(`No checksum entry for ${plan.assetName}; aborting.`);
    return 1;
  }
  try {
    await selfReplace({
      binPath,
      bytes: new Uint8Array(await binRes.arrayBuffer()),
      expectedSha256: expected,
    });
  } catch (err) {
    console.error(`Update failed: ${(err as Error).message}`);
    return 1;
  }
  const { writeInstallManifest } = await import("./install-manifest");
  await writeInstallManifest({ channel, version: latest, binPath, dlBase, layout: "flat" });
  console.log(`Updated to ${latest}.`);
  return 0;
}
