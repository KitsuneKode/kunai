import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  __testing,
  writeAtomicBytes,
  writeAtomicJson,
  writeAtomicSecretJson,
} from "@/infra/fs/atomic-write";

/** POSIX-only: NTFS ignores mode bits, so asserting them there proves nothing. */
const testPosixMode = process.platform === "win32" ? test.skip : test;

const roots: string[] = [];

async function makeFiles(): Promise<{
  backup: string;
  root: string;
  target: string;
  tmp: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "kunai-atomic-write-"));
  roots.push(root);
  const target = join(root, "config.json");
  const tmp = join(root, ".config.json.tmp");
  const backup = join(root, ".config.json.backup");
  await writeFile(target, "old");
  await writeFile(tmp, "new");
  return { backup, root, target, tmp };
}

function fsError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomicMove", () => {
  test("normally replaces the target without leaving temporary files", async () => {
    const { backup, target, tmp } = await makeFiles();

    await __testing.atomicMove(tmp, target, {
      backupPath: backup,
      fs: { lstat, rename, unlink },
      platform: "linux",
    });

    expect(await readFile(target, "utf8")).toBe("new");
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(backup)).toBe(false);
  });

  test("uses a same-directory backup for the Windows replacement fallback", async () => {
    const { target, tmp } = await makeFiles();
    const operations: string[] = [];
    let generatedBackup: string | undefined;
    let renameAttempt = 0;

    await __testing.atomicMove(tmp, target, {
      fs: {
        lstat,
        rename: async (from, to) => {
          operations.push(`rename:${from}->${to}`);
          renameAttempt += 1;
          if (renameAttempt === 1) throw fsError("EPERM", "replace blocked");
          if (renameAttempt === 2) generatedBackup = to;
          await rename(from, to);
        },
        unlink: async (path) => {
          operations.push(`unlink:${path}`);
          await unlink(path);
        },
      },
      platform: "win32",
    });

    expect(await readFile(target, "utf8")).toBe("new");
    expect(existsSync(tmp)).toBe(false);
    expect(generatedBackup).toBeDefined();
    expect(dirname(generatedBackup!)).toBe(dirname(target));
    expect(existsSync(generatedBackup!)).toBe(false);
    expect(operations).toEqual([
      `rename:${tmp}->${target}`,
      `rename:${target}->${generatedBackup}`,
      `rename:${tmp}->${target}`,
      `unlink:${generatedBackup}`,
    ]);
  });

  test("does not treat a directory as a replaceable Windows file target", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-atomic-write-directory-"));
    roots.push(root);
    const target = join(root, "config.json");
    const tmp = join(root, ".config.json.tmp");
    await mkdir(target);
    await writeFile(tmp, "new");

    const result = __testing.atomicMove(tmp, target, {
      fs: {
        lstat,
        rename: async () => {
          throw fsError("EEXIST", "replace blocked");
        },
        unlink,
      },
      platform: "win32",
    });

    await expect(result).rejects.toThrow("replace blocked");
    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(existsSync(tmp)).toBe(false);
  });

  test("restores the original target and cleans the temp file when installation fails", async () => {
    const { backup, target, tmp } = await makeFiles();
    let renameAttempt = 0;

    const result = __testing.atomicMove(tmp, target, {
      backupPath: backup,
      fs: {
        lstat,
        rename: async (from, to) => {
          renameAttempt += 1;
          if (renameAttempt === 1) throw fsError("EPERM", "replace blocked");
          if (renameAttempt === 3) throw fsError("EIO", "install failed");
          await rename(from, to);
        },
        unlink,
      },
      platform: "win32",
    });

    await expect(result).rejects.toThrow("install failed");
    expect(await readFile(target, "utf8")).toBe("old");
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(backup)).toBe(false);
  });

  test("retains the backup and reports both errors when restoration also fails", async () => {
    const { backup, target, tmp } = await makeFiles();
    let renameAttempt = 0;

    const result = __testing.atomicMove(tmp, target, {
      backupPath: backup,
      fs: {
        lstat,
        rename: async (from, to) => {
          renameAttempt += 1;
          if (renameAttempt === 1) throw fsError("EPERM", "replace blocked");
          if (renameAttempt === 3) throw fsError("EIO", "install failed");
          if (renameAttempt === 4) throw fsError("EACCES", "restore failed");
          await rename(from, to);
        },
        unlink,
      },
      platform: "win32",
    });

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String)).toEqual([
      "Error: install failed",
      "Error: restore failed",
    ]);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
    expect(await readFile(backup, "utf8")).toBe("old");
  });
});

describe("secret and durable writes", () => {
  async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "kunai-atomic-secret-"));
    roots.push(root);
    return root;
  }

  testPosixMode("a secret write is owner-only before it is ever visible", async () => {
    const root = await makeRoot();
    const target = join(root, "sync-tokens.json");
    await writeAtomicSecretJson(target, { anilist: { accessToken: "t", userId: 1 } });

    const stats = await lstat(target);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  testPosixMode(
    "a secret rewrite stays owner-only when the previous file was wide open",
    async () => {
      const root = await makeRoot();
      const target = join(root, "config.json");
      await writeFile(target, "{}", { mode: 0o666 });

      await writeAtomicSecretJson(target, { videasySessionToken: "s" });

      const stats = await lstat(target);
      expect(stats.mode & 0o777).toBe(0o600);
    },
  );

  testPosixMode("an ordinary write is not silently narrowed to owner-only", async () => {
    const root = await makeRoot();
    const target = join(root, "plain.json");
    await writeAtomicJson(target, { ok: true });

    const stats = await lstat(target);
    expect(stats.mode & 0o600).toBe(0o600);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ ok: true });
  });

  test("writeAtomicBytes round-trips every accepted payload shape", async () => {
    const root = await makeRoot();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    for (const [name, payload] of [
      ["uint8array", bytes],
      ["arraybuffer", bytes.buffer.slice(0)],
      ["blob", new Blob([bytes])],
    ] as const) {
      const target = join(root, `${name}.bin`);
      await writeAtomicBytes(target, payload);
      expect(new Uint8Array(await readFile(target))).toEqual(bytes);
    }
  });

  test("a directory flush never fails a write that already landed", async () => {
    const root = await makeRoot();
    await expect(__testing.flushDirectory(join(root, "does-not-exist"))).resolves.toBeUndefined();
  });

  test("Windows ACL hardening is skipped rather than guessed when the user is unknown", async () => {
    const root = await makeRoot();
    const target = join(root, "secret.json");
    await writeFile(target, "{}");

    const previousUser = process.env.USERNAME;
    delete process.env.USERNAME;
    try {
      await expect(__testing.restrictWindowsSecretAcl(target)).resolves.toBeUndefined();
      expect(await readFile(target, "utf8")).toBe("{}");
    } finally {
      if (previousUser !== undefined) process.env.USERNAME = previousUser;
    }
  });
});
