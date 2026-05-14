import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function tempPath(targetPath: string): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  return join(dir, `.${base}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`);
}

async function atomicMove(tmp: string, targetPath: string): Promise<void> {
  try {
    await rename(tmp, targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (
      process.platform === "win32" &&
      (code === "EPERM" || code === "EEXIST" || code === "ENOTEMPTY")
    ) {
      await unlink(targetPath).catch(() => {});
      await rename(tmp, targetPath);
    } else {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

/** Write `contents` to `targetPath` via a same-directory temp file + rename (crash-safe). */
export async function writeAtomicText(targetPath: string, contents: string): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmp = tempPath(targetPath);

  try {
    await Bun.write(tmp, contents);
    await atomicMove(tmp, targetPath);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
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
