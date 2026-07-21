import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "../install-manifest";
import { fetchLatestVersion } from "../latest-version";
import { detectPlatform, releaseAssetName, type PlatformLibc } from "../platform-assets";
import { pickChecksum, verifyChecksum } from "../self-replace";
import { normalizeRequestedVersion, parseCanonicalVersion } from "../version";
import { cleanupOldVersions } from "./cleanup-versions";
import {
  DEFAULT_DL_BASE,
  getInstallLayoutPaths,
  stagingDirForVersion,
  versionBinaryPath,
  type InstallLayoutPaths,
} from "./install-layout";
import { atomicWriteBinary, updateLauncher } from "./launcher";
import { isMuslEnvironmentSync } from "./musl";
import { withVersionLock } from "./version-lock";

export type InstallLatestResult =
  | { readonly status: "up-to-date"; readonly version: string }
  | { readonly status: "installed"; readonly version: string; readonly versionPath: string }
  | { readonly status: "skipped"; readonly reason: "lock-contention" }
  | { readonly status: "failed"; readonly error: string };

export type InstallLatestOptions = {
  readonly version?: string;
  readonly force?: boolean;
  readonly dlBase?: string;
  readonly layout?: InstallLayoutPaths;
  readonly fetchImpl?: typeof fetch;
  readonly libc?: PlatformLibc;
};

let inFlightInstall: Promise<InstallLatestResult> | null = null;

/**
 * Download, verify, and install the latest (or pinned) binary into the versioned
 * store, then update the launcher symlink. Module-level singleflight.
 */
export function installLatest(options: InstallLatestOptions = {}): Promise<InstallLatestResult> {
  if (inFlightInstall) return inFlightInstall;
  const promise = installLatestImpl(options).finally(() => {
    if (inFlightInstall === promise) inFlightInstall = null;
  });
  inFlightInstall = promise;
  return promise;
}

async function installLatestImpl(options: InstallLatestOptions): Promise<InstallLatestResult> {
  const layout = options.layout ?? getInstallLayoutPaths();
  const manifest = await readInstallManifest(layout.configDir);
  const dlBase = options.dlBase ?? manifest?.dlBase ?? DEFAULT_DL_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  const resolved =
    options.version && options.version !== "latest"
      ? normalizeRequestedVersion(options.version)
      : parseCanonicalVersion((await fetchLatestVersion(fetchImpl)) ?? "");
  if (!resolved) {
    return { status: "failed", error: "Could not resolve target version." };
  }

  const { os, arch } = detectPlatform();
  if (!os || !arch) {
    return { status: "failed", error: "Could not detect OS/arch." };
  }

  const libc = options.libc ?? (os === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu");
  const assetName = releaseAssetName(os, arch, libc);
  const tag = `v${resolved}`;
  const downloadUrl = `${dlBase}/download/${tag}/${assetName}`;
  const checksumUrl = `${dlBase}/download/${tag}/SHA256SUMS`;
  const versionPath = versionBinaryPath(layout, resolved);

  if (!options.force && existsSync(versionPath) && manifest?.version === resolved) {
    return { status: "up-to-date", version: resolved };
  }

  const result = await withVersionLock(layout, resolved, async () => {
    const [binRes, sumRes] = await Promise.all([fetchImpl(downloadUrl), fetchImpl(checksumUrl)]);
    if (!binRes.ok || !sumRes.ok) {
      throw new Error(`Download failed (binary ${binRes.status}, checksums ${sumRes.status})`);
    }

    const bytes = new Uint8Array(await binRes.arrayBuffer());
    const expected = pickChecksum(await sumRes.text(), assetName);
    if (!expected) {
      throw new Error(`No checksum entry for ${assetName}`);
    }

    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (!verifyChecksum(actual, expected)) {
      throw new Error(`Checksum mismatch for ${assetName}`);
    }

    const staging = stagingDirForVersion(layout, resolved);
    await mkdir(staging, { recursive: true });
    const stagedPath = join(staging, assetName);
    await writeFile(stagedPath, bytes);

    await mkdir(dirname(versionPath), { recursive: true });
    await atomicWriteBinary(versionPath, bytes);
    await rm(staging, { recursive: true, force: true }).catch(() => {});

    await updateLauncher({
      launcherPath: manifest?.binPath ?? layout.launcherPath,
      versionPath,
    });

    await writeInstallManifest({
      channel: "binary",
      version: resolved,
      binPath: manifest?.binPath ?? layout.launcherPath,
      versionPath,
      dlBase,
      layout: "versioned",
    });

    void cleanupOldVersions(layout);

    return { status: "installed" as const, version: resolved, versionPath };
  });

  if (result === null) {
    return { status: "skipped", reason: "lock-contention" };
  }

  return result;
}

export type SetupMessage = {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
};

/** PATH and launcher diagnostics after install. */
export async function checkInstall(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
): Promise<SetupMessage[]> {
  const messages: SetupMessage[] = [];
  const pathEnv = process.env.PATH ?? "";
  const binDir = dirname(layout.launcherPath);

  if (!existsSync(layout.launcherPath)) {
    messages.push({ level: "error", message: `Launcher missing: ${layout.launcherPath}` });
    return messages;
  }

  if (!pathEnv.split(":").includes(binDir) && !pathEnv.split(";").includes(binDir)) {
    messages.push({
      level: "warn",
      message: `Add ${binDir} to your PATH, then restart your shell.`,
    });
  } else {
    messages.push({ level: "info", message: `Launcher ready at ${layout.launcherPath}` });
  }

  return messages;
}
