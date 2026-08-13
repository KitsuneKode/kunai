import { chmod, lstat, mkdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function tempPath(targetPath: string): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  return join(dir, `.${base}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`);
}

function backupPath(targetPath: string): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  return join(dir, `.${base}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.bak`);
}

interface AtomicFileOps {
  lstat(path: string): Promise<{ isDirectory(): boolean }>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

interface AtomicMoveOptions {
  backupPath?: string;
  fs?: AtomicFileOps;
  platform?: NodeJS.Platform;
}

const nodeAtomicFileOps: AtomicFileOps = { lstat, rename, unlink };

function isWindowsReplaceConflict(error: unknown, platform: NodeJS.Platform): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return platform === "win32" && (code === "EPERM" || code === "EEXIST" || code === "ENOTEMPTY");
}

async function removeIfPresent(path: string, fs: AtomicFileOps): Promise<void> {
  await fs.unlink(path).catch(() => {});
}

async function atomicMove(
  tmp: string,
  targetPath: string,
  options: AtomicMoveOptions = {},
): Promise<void> {
  const fs = options.fs ?? nodeAtomicFileOps;
  const platform = options.platform ?? process.platform;

  try {
    await fs.rename(tmp, targetPath);
  } catch (err) {
    if (!isWindowsReplaceConflict(err, platform)) {
      await removeIfPresent(tmp, fs);
      throw err;
    }

    const targetStats = await fs.lstat(targetPath).catch(async (statError) => {
      await removeIfPresent(tmp, fs);
      const failure = new AggregateError(
        [err, statError],
        "Atomic replacement failed while inspecting the previous target",
        { cause: statError },
      );
      throw failure;
    });
    if (targetStats.isDirectory()) {
      await removeIfPresent(tmp, fs);
      throw err;
    }

    const backup = options.backupPath ?? backupPath(targetPath);
    try {
      await fs.rename(targetPath, backup);
    } catch (backupError) {
      await removeIfPresent(tmp, fs);
      const failure = new AggregateError(
        [err, backupError],
        "Atomic replacement failed before the previous target could be preserved",
        { cause: backupError },
      );
      throw failure;
    }

    try {
      await fs.rename(tmp, targetPath);
    } catch (installError) {
      try {
        await fs.rename(backup, targetPath);
      } catch (restoreError) {
        await removeIfPresent(tmp, fs);
        const failure = new AggregateError(
          [installError, restoreError],
          `Atomic replacement and restoration failed; previous target retained at ${backup}`,
          { cause: restoreError },
        );
        throw failure;
      }

      await removeIfPresent(tmp, fs);
      throw installError;
    }

    await fs.unlink(backup);
  }
}

async function writeAtomicTextWithMode(
  targetPath: string,
  contents: string,
  posixMode?: number,
): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmp = tempPath(targetPath);

  try {
    await Bun.write(tmp, contents);
    // Secret-bearing files must be private before they become visible at the
    // destination. Applying the mode after rename leaves a crash window where
    // the process umask may have created a world-readable config.
    if (posixMode !== undefined && process.platform !== "win32") {
      await chmod(tmp, posixMode);
    }
    await atomicMove(tmp, targetPath);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Write `contents` to `targetPath` via a same-directory temp file + rename (crash-safe). */
export async function writeAtomicText(targetPath: string, contents: string): Promise<void> {
  await writeAtomicTextWithMode(targetPath, contents);
}

/** Write `data` to `targetPath` via atomic temp + rename (crash-safe). Accepts ArrayBuffer, Uint8Array, or Blob. */
export async function writeAtomicBytes(
  targetPath: string,
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmp = tempPath(targetPath);

  try {
    await Bun.write(tmp, data);
    await atomicMove(tmp, targetPath);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function writeAtomicJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicText(targetPath, JSON.stringify(value, null, 2));
}

/** Like writeAtomicText with mode 0o600 applied before rename on POSIX. */
export async function writeAtomicSecretText(targetPath: string, contents: string): Promise<void> {
  await writeAtomicTextWithMode(targetPath, contents, 0o600);
}

/** Write secret-bearing JSON atomically with owner-only POSIX permissions. */
export async function writeAtomicSecretJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicSecretText(targetPath, JSON.stringify(value, null, 2));
}

export const __testing = { atomicMove };
