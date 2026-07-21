import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Retry rename to absorb transient AV/Defender locks (mainly Windows). */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await Bun.sleep(150 * (i + 1));
    }
  }
}

/**
 * Atomically write bytes to `targetPath` via same-dir temp + rename.
 */
export async function atomicWriteBinary(targetPath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, bytes);
  await chmod(tmp, 0o755).catch(() => {});
  await rename(tmp, targetPath);
}

/**
 * Atomically install a staged file into `targetPath` via same-dir copy + rename.
 * Leaves the source in place (caller owns staging cleanup).
 */
export async function atomicInstallBinaryFromFile(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  await copyFile(sourcePath, tmp);
  await chmod(tmp, 0o755).catch(() => {});
  await rename(tmp, targetPath);
}

/**
 * Point the user-facing launcher at the versioned binary.
 * Unix: symlink. Windows: copy with rename-aside for running exe.
 */
export async function updateLauncher(input: {
  readonly launcherPath: string;
  readonly versionPath: string;
  readonly platform?: NodeJS.Platform;
}): Promise<void> {
  const platform = input.platform ?? process.platform;
  await mkdir(dirname(input.launcherPath), { recursive: true });

  if (platform === "win32") {
    if (existsSync(input.launcherPath)) {
      const aside = `${input.launcherPath}.old.${Date.now()}`;
      await rm(aside, { force: true }).catch(() => {});
      await renameWithRetry(input.launcherPath, aside).catch(async () => {
        await rm(input.launcherPath, { force: true });
      });
    }
    await copyFile(input.versionPath, input.launcherPath);
    await chmod(input.launcherPath, 0o755).catch(() => {});
    return;
  }

  if (existsSync(input.launcherPath)) {
    try {
      const current = await readlink(input.launcherPath);
      if (current === input.versionPath) return;
    } catch {
      // not a symlink — replace
      await rm(input.launcherPath, { force: true });
    }
  }

  const tmpLink = `${input.launcherPath}.tmp.${process.pid}`;
  await rm(tmpLink, { force: true }).catch(() => {});
  await symlink(input.versionPath, tmpLink);
  await rename(tmpLink, input.launcherPath);
}

export type LauncherOwnership = "managed" | "unmanaged" | "missing";

/**
 * Determine whether the launcher path is installer-owned.
 * Unix: symlink whose target lives under versionsDir.
 * Windows: file whose sha256 matches expectedSha256 (never size alone).
 */
export async function inspectLauncherOwnership(input: {
  readonly launcherPath: string;
  readonly versionsDir: string;
  readonly expectedSha256?: string;
  readonly platform?: NodeJS.Platform;
}): Promise<LauncherOwnership> {
  if (!existsSync(input.launcherPath)) return "missing";

  const platform = input.platform ?? process.platform;
  const versions = input.versionsDir.replaceAll("\\", "/");

  if (platform === "win32") {
    const expected = input.expectedSha256?.toLowerCase();
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return "unmanaged";
    try {
      const bytes = new Uint8Array(await Bun.file(input.launcherPath).arrayBuffer());
      const actual = createHash("sha256").update(bytes).digest("hex");
      return actual === expected ? "managed" : "unmanaged";
    } catch {
      return "unmanaged";
    }
  }

  try {
    const target = await readlink(input.launcherPath);
    const normalizedTarget = target.replaceAll("\\", "/");
    if (normalizedTarget.includes(`${versions}/`) || normalizedTarget === versions) {
      return "managed";
    }
    return "unmanaged";
  } catch {
    return "unmanaged";
  }
}

/** Remove Windows rename-aside leftovers owned by launcher activation (`*.old.<ts>`). */
export async function removeLauncherCopyAsides(launcherPath: string): Promise<string[]> {
  const dir = dirname(launcherPath);
  const prefix = `${basename(launcherPath)}.old.`;
  if (!existsSync(dir)) return [];

  const removed: string[] = [];
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (!entry.startsWith(prefix)) continue;
    const full = join(dir, entry);
    try {
      await rm(full, { force: true });
      removed.push(full);
    } catch {
      // best-effort
    }
  }
  return removed;
}

/**
 * Remove launcher only when it is installer-owned (safe unlink).
 * Windows requires expectedSha256 checksum match.
 */
export async function removeLauncherIfVersioned(input: {
  readonly launcherPath: string;
  readonly versionsDir: string;
  readonly expectedSha256?: string;
  readonly platform?: NodeJS.Platform;
}): Promise<boolean> {
  const ownership = await inspectLauncherOwnership(input);
  if (ownership !== "managed") return false;

  await rm(input.launcherPath, { force: true });
  return true;
}
