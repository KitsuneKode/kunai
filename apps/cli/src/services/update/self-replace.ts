import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Find the checksum for `assetName` in a `SHA256SUMS` file body. */
export function pickChecksum(sumsFile: string, assetName: string): string | null {
  for (const line of sumsFile.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === assetName) return hash ?? null;
  }
  return null;
}

export function verifyChecksum(actual: string, expected: string): boolean {
  return actual.length > 0 && actual === expected;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Delete a stale `<binary>.old` left by a prior Windows self-replace. The aside
 * file cannot be removed while still memory-mapped, but succeeds on the next
 * launch. Safe to call on every platform/startup.
 */
export async function cleanupOldBinary(binPath: string): Promise<void> {
  const dir = dirname(binPath);
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (entry.endsWith(".old")) {
      await rm(join(dir, entry), { force: true }).catch(() => {});
    }
  }
}

export type SelfReplaceInput = {
  readonly binPath: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
  readonly platform?: NodeJS.Platform;
};

/**
 * Atomically replace the running binary with verified new bytes. Same-volume
 * temp + rename. On Windows, the running `.exe` cannot be overwritten but CAN be
 * renamed aside, so we move it to `.old` and drop the new one in its place.
 */
export async function selfReplace(input: SelfReplaceInput): Promise<void> {
  const actual = await sha256(input.bytes);
  if (!verifyChecksum(actual, input.expectedSha256)) {
    throw new Error(`Checksum mismatch: expected ${input.expectedSha256}, got ${actual}`);
  }

  const platform = input.platform ?? process.platform;
  const dir = dirname(input.binPath);
  const tmp = join(dir, `.kunai-new-${process.pid}`);
  await writeFile(tmp, input.bytes);
  await chmod(tmp, 0o755).catch(() => {});

  if (platform === "win32") {
    const aside = `${input.binPath}.old`;
    await rm(aside, { force: true }).catch(() => {});
    await renameWithRetry(input.binPath, aside);
    await renameWithRetry(tmp, input.binPath);
    return;
  }
  await rename(tmp, input.binPath);
}

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
