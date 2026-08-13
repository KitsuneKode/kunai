import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { __testing } from "@/infra/fs/atomic-write";

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
