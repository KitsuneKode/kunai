import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
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

/**
 * Restrict a secret file to the current user on Windows.
 *
 * NTFS ignores POSIX mode bits, so `chmod 0o600` is a no-op there and the file
 * keeps whatever the parent directory's inherited ACL grants. `%APPDATA%` is
 * user-scoped by default, which is what most CLIs lean on -- but that is an
 * inherited default, not something this process established. Dropping
 * inheritance and granting only the current user costs one `icacls` call on a
 * path written at connect time, never in a hot loop.
 *
 * Best effort by construction: a machine without `icacls`, or a policy that
 * refuses the change, must not fail the write -- the file is then no wider than
 * the directory already was. If the new ACL somehow locks this process out, the
 * inherited ACL is restored rather than leaving an unreadable secret behind.
 */
async function restrictWindowsSecretAcl(path: string): Promise<void> {
  const account = process.env.USERNAME?.trim();
  if (!account) return;
  const domain = process.env.USERDOMAIN?.trim();
  const principal = domain ? `${domain}\\${account}` : account;

  try {
    const granted = Bun.spawn(["icacls", path, "/inheritance:r", "/grant:r", `${principal}:F`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await granted.exited) !== 0) return;

    await access(path, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    // Either icacls is unavailable, or it applied an ACL this process cannot
    // use. Restoring inheritance is the only outcome worse than doing nothing.
    try {
      const reset = Bun.spawn(["icacls", path, "/reset"], { stdout: "ignore", stderr: "ignore" });
      await reset.exited;
    } catch {
      /* nothing further to try; the caller still gets a written file */
    }
  }
}

/**
 * Write `contents` to `path` and flush it to disk before returning.
 *
 * Temp-file-plus-rename keeps readers from ever seeing a half-written file, but
 * on its own it is not durable: the rename can reach the filesystem journal
 * while the data blocks are still in the page cache, so a power loss leaves a
 * correctly named, zero-length config. Flushing the file before it is renamed
 * into place is what makes the replacement survive a crash rather than merely
 * look atomic to concurrent readers.
 *
 * `mode` is applied at creation so a secret file is never briefly visible with
 * the process umask's permissions; it is re-applied explicitly because the
 * umask can only narrow the creation mode, never widen it.
 */
async function writeAndFlush(path: string, contents: string | Uint8Array, mode?: number) {
  const handle = await open(path, "w", mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (mode !== undefined && process.platform !== "win32") await chmod(path, mode);
}

/**
 * Flush the directory entry so a completed rename survives a crash.
 *
 * POSIX only: Windows has no directory handle to sync, and its rename is
 * already recorded by the time it returns. Best effort -- a filesystem that
 * refuses to open or sync a directory must not fail an otherwise good write.
 */
async function flushDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(dir, fsConstants.O_RDONLY);
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    /* directory syncing is unsupported on some filesystems */
  } finally {
    await handle.close();
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
    // Secret-bearing files must be private before they become visible at the
    // destination. Applying the mode after rename leaves a crash window where
    // the process umask may have created a world-readable config.
    await writeAndFlush(tmp, contents, posixMode);
    if (posixMode !== undefined && process.platform === "win32") {
      await restrictWindowsSecretAcl(tmp);
    }
    await atomicMove(tmp, targetPath);
    await flushDirectory(dir);
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
    const bytes =
      data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    await writeAndFlush(tmp, bytes);
    await atomicMove(tmp, targetPath);
    await flushDirectory(dir);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function writeAtomicJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicText(targetPath, JSON.stringify(value, null, 2));
}

/**
 * Like writeAtomicText, restricted to the owner before the rename makes it
 * visible: mode `0o600` on POSIX, an inheritance-free user-only ACL on Windows.
 */
export async function writeAtomicSecretText(targetPath: string, contents: string): Promise<void> {
  await writeAtomicTextWithMode(targetPath, contents, 0o600);
}

/** Write secret-bearing JSON atomically, readable only by the owning user. */
export async function writeAtomicSecretJson(targetPath: string, value: unknown): Promise<void> {
  await writeAtomicSecretText(targetPath, JSON.stringify(value, null, 2));
}

export const __testing = { atomicMove, flushDirectory, restrictWindowsSecretAcl, writeAndFlush };
