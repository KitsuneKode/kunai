import { existsSync } from "node:fs";

import { readInstallManifest, writeInstallManifest } from "./install-manifest";
import { detectInstallMethod } from "./install-method";
import { fetchLatestVersion } from "./latest-version";
import { pickChecksum, selfReplace } from "./self-replace";
import { planUpgrade, type UpgradeArch, type UpgradeOs } from "./upgrade-planner";

const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

function currentOs(): UpgradeOs | undefined {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "windows";
  return undefined;
}

function currentArch(): UpgradeArch | undefined {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  return undefined;
}

export type RunUpgradeOptions = {
  readonly checkOnly?: boolean;
  readonly currentVersion: string;
};

/**
 * Channel-aware `kunai upgrade`. Reads the install manifest (or falls back to the
 * `detectInstallMethod` heuristic), resolves the latest version, and either
 * self-replaces (binary) or shells out to npm/bun, or prints manual guidance.
 * Returns a process exit code.
 */
export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const manifest = await readInstallManifest();
  const channel = manifest?.channel ?? detectInstallMethod({ fileExists: existsSync }).kind;
  const binPath = manifest?.binPath ?? process.execPath;
  const dlBase = manifest?.dlBase ?? DEFAULT_DL_BASE;

  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error("Could not resolve the latest version (network/API). Try again later.");
    return 1;
  }

  const os = currentOs();
  const arch = currentArch();
  const plan = planUpgrade({
    channel,
    currentVersion: opts.currentVersion,
    latestVersion: latest,
    binPath,
    dlBase,
    os,
    arch,
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
      await writeInstallManifest({ channel, version: latest, binPath, dlBase });
    }
    return code;
  }

  // self-replace
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
  await writeInstallManifest({ channel, version: latest, binPath, dlBase });
  console.log(`Updated to ${latest}.`);
  return 0;
}
