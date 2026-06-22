import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

/**
 * Remove launcher only when it points into the versioned store (safe unlink).
 */
export async function removeLauncherIfVersioned(input: {
  readonly launcherPath: string;
  readonly versionsDir: string;
}): Promise<boolean> {
  if (!existsSync(input.launcherPath)) return false;

  if (process.platform === "win32") {
    const normalized = input.launcherPath.replaceAll("\\", "/");
    const versions = input.versionsDir.replaceAll("\\", "/");
    if (!normalized.toLowerCase().includes(versions.toLowerCase())) {
      // Windows launcher is a copy; remove if versions dir exists
      await rm(input.launcherPath, { force: true });
      return true;
    }
    await rm(input.launcherPath, { force: true });
    return true;
  }

  try {
    const target = await readlink(input.launcherPath);
    const versions = input.versionsDir.replaceAll("\\", "/");
    if (target.replaceAll("\\", "/").includes(versions)) {
      await rm(input.launcherPath, { force: true });
      return true;
    }
  } catch {
    // not a symlink
  }
  return false;
}
