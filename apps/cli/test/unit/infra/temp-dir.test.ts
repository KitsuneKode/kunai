import { describe, expect, test } from "bun:test";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPrivateTempDir } from "@/infra/fs/temp-dir";

describe("createPrivateTempDir", () => {
  test("creates a fresh directory under the OS temp dir", async () => {
    const dir = await createPrivateTempDir("hls");
    try {
      expect(dir.startsWith(join(tmpdir(), "kunai-hls-"))).toBe(true);
      expect((await stat(dir)).isDirectory()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("never returns the same directory twice", async () => {
    const dirs = await Promise.all([
      createPrivateTempDir("hls"),
      createPrivateTempDir("hls"),
      createPrivateTempDir("hls"),
    ]);
    try {
      expect(new Set(dirs).size).toBe(dirs.length);
    } finally {
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    }
  });

  test("returns a directory nothing has written to yet", async () => {
    const dir = await createPrivateTempDir("hls");
    try {
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "creates the directory private to this user",
    async () => {
      // This is the assertion that discriminates the fix. mkdir(recursive:true)
      // creates with 0777 & ~umask -- 0755 on a typical box -- leaving the
      // playlist we are about to hand mpv world-readable, and (because
      // recursive:true also succeeds on a path that already exists)
      // adoptable by a local user who pre-created it. mkdtemp creates 0700 and
      // fails on collision, so the directory is always one we just made.
      //
      // POSIX only: Windows does not model mode bits this way.
      const dir = await createPrivateTempDir("media");
      try {
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
