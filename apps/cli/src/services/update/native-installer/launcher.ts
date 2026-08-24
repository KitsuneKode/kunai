import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface LauncherFileOps {
  chmod(path: string, mode: number): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const nodeLauncherFileOps: LauncherFileOps = { chmod, copyFile, rename, rm };

/** Retry rename to absorb transient AV/Defender locks (mainly Windows). */
async function renameWithRetry(
  from: string,
  to: string,
  options: {
    readonly attempts?: number;
    readonly fs?: LauncherFileOps;
    readonly sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 5;
  const fs = options.fs ?? nodeLauncherFileOps;
  const sleep = options.sleep ?? Bun.sleep;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(150 * (i + 1));
    }
  }
}

interface WindowsLauncherOptions {
  readonly asidePath?: string;
  readonly attempts?: number;
  readonly candidatePath?: string;
  readonly fs?: LauncherFileOps;
  readonly sleep?: (ms: number) => Promise<void>;
}

async function updateWindowsLauncher(
  input: { readonly launcherPath: string; readonly versionPath: string },
  options: WindowsLauncherOptions = {},
): Promise<void> {
  const fs = options.fs ?? nodeLauncherFileOps;
  const suffix = `${process.pid}.${Date.now()}`;
  const candidate = options.candidatePath ?? `${input.launcherPath}.new.${suffix}`;
  const aside = options.asidePath ?? `${input.launcherPath}.old.${Date.now()}`;
  const renameOptions = {
    attempts: options.attempts,
    fs,
    sleep: options.sleep,
  };

  await fs.rm(candidate, { force: true }).catch(() => {});
  try {
    // Finish staging the replacement before moving the last-known-good launcher.
    await fs.copyFile(input.versionPath, candidate);
    await fs.chmod(candidate, 0o755).catch(() => {});

    if (!existsSync(input.launcherPath)) {
      await renameWithRetry(candidate, input.launcherPath, renameOptions);
      return;
    }

    await fs.rm(aside, { force: true }).catch(() => {});
    await renameWithRetry(input.launcherPath, aside, renameOptions);
    try {
      await renameWithRetry(candidate, input.launcherPath, renameOptions);
    } catch (installError) {
      try {
        await renameWithRetry(aside, input.launcherPath, renameOptions);
      } catch (restoreError) {
        const failure = new AggregateError(
          [installError, restoreError],
          `Launcher activation and restoration failed; previous launcher retained at ${aside}`,
          { cause: restoreError },
        );
        throw failure;
      }
      throw installError;
    }
  } finally {
    await fs.rm(candidate, { force: true }).catch(() => {});
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
    await updateWindowsLauncher(input);
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

export type LauncherSnapshot =
  | { readonly kind: "missing"; readonly launcherPath: string; readonly platform: NodeJS.Platform }
  | {
      readonly kind: "symlink";
      readonly launcherPath: string;
      readonly platform: NodeJS.Platform;
      readonly target: string;
    }
  | {
      readonly kind: "file";
      readonly launcherPath: string;
      readonly platform: NodeJS.Platform;
      readonly backupPath: string;
    };

/** Capture the exact pre-activation launcher until its manifest commit succeeds. */
export async function captureLauncherSnapshot(
  launcherPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<LauncherSnapshot> {
  try {
    await lstat(launcherPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing", launcherPath, platform };
    }
    throw error;
  }

  if (platform !== "win32") {
    try {
      return { kind: "symlink", launcherPath, platform, target: await readlink(launcherPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EINVAL") throw error;
    }
  }

  const backupPath = `${launcherPath}.activation-backup.${process.pid}.${Date.now()}`;
  await copyFile(launcherPath, backupPath);
  return { kind: "file", launcherPath, platform, backupPath };
}

/** Restore a launcher snapshot without consuming its last-known-good backup. */
export async function restoreLauncherSnapshot(snapshot: LauncherSnapshot): Promise<void> {
  if (snapshot.kind === "missing") {
    await rm(snapshot.launcherPath, { force: true });
    return;
  }
  if (snapshot.kind === "symlink") {
    const candidate = `${snapshot.launcherPath}.restore.${process.pid}.${Date.now()}`;
    await rm(candidate, { force: true }).catch(() => {});
    try {
      await symlink(snapshot.target, candidate);
      await rename(candidate, snapshot.launcherPath);
    } finally {
      await rm(candidate, { force: true }).catch(() => {});
    }
    return;
  }
  if (snapshot.platform === "win32") {
    await updateWindowsLauncher({
      launcherPath: snapshot.launcherPath,
      versionPath: snapshot.backupPath,
    });
    return;
  }
  const candidate = `${snapshot.launcherPath}.restore.${process.pid}.${Date.now()}`;
  await rm(candidate, { force: true }).catch(() => {});
  try {
    await copyFile(snapshot.backupPath, candidate);
    await rename(candidate, snapshot.launcherPath);
  } finally {
    await rm(candidate, { force: true }).catch(() => {});
  }
}

export async function discardLauncherSnapshot(snapshot: LauncherSnapshot): Promise<void> {
  if (snapshot.kind === "file") {
    await rm(snapshot.backupPath, { force: true });
  }
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

export const __testing = { updateWindowsLauncher };
