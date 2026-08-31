import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("FileStorage", () => {
  test.skipIf(process.platform === "win32")(
    "writes config files with owner-only permissions on POSIX",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
      tempDirs.push(dir);
      const configPath = join(dir, "config.json");
      const storage = new FileStorage({ config: configPath });

      await storage.write("config", { providerRelay: { baseUrl: "https://relay.example" } });

      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    },
  );

  test.skipIf(process.platform === "win32")(
    "repairs permissive existing config permissions when loading on POSIX",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
      tempDirs.push(dir);
      const configPath = join(dir, "config.json");
      await writeFile(configPath, '{"providerRelay":{"token":"secret"}}');
      await chmod(configPath, 0o644);

      const storage = new FileStorage({ config: configPath });

      await expect(storage.read("config")).resolves.toEqual({
        providerRelay: { token: "secret" },
      });
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    },
  );

  test.skipIf(process.platform === "win32")(
    "keeps corrupt config backups owner-only on POSIX",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
      tempDirs.push(dir);
      const configPath = join(dir, "config.json");
      const backupPath = `${configPath}.corrupt.bak`;
      await writeFile(configPath, '{"providerRelay":{"token":"secret"}');
      await chmod(configPath, 0o644);

      const storage = new FileStorage({ config: configPath });

      await expect(storage.read("config")).resolves.toBeNull();
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
    },
  );

  test("reads a missing file as nothing stored, without a backup or a warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    const warnings: string[] = [];
    const storage = new FileStorage({ config: configPath }, (message) => warnings.push(message));

    // The read path used to chmod outside its guard, so a file that vanished
    // after the existence check rejected with ENOENT instead of returning null.
    await expect(storage.read("config")).resolves.toBeNull();
    expect(warnings).toEqual([]);
    await expect(stat(`${configPath}.corrupt.bak`)).rejects.toThrow();
  });

  test("backs up the corrupt file's actual bytes, not an empty placeholder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    const corrupt = '{"providerRelay":{"token":"secret"}';
    await writeFile(configPath, corrupt);

    const warnings: string[] = [];
    const storage = new FileStorage({ config: configPath }, (message) => warnings.push(message));

    await expect(storage.read("config")).resolves.toBeNull();
    // The backup exists to preserve the content — an empty one destroys it.
    await expect(readFile(`${configPath}.corrupt.bak`, "utf8")).resolves.toBe(corrupt);
    expect(warnings).toHaveLength(1);
  });

  test("keeps the write queue usable after a failed write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const storage = new FileStorage({ config: dir });
    await expect(storage.write("config", { broken: true })).rejects.toThrow();

    const configPath = join(dir, "config.json");
    const recovered = new FileStorage({ config: configPath });
    await recovered.write("config", { ok: true });

    await expect(recovered.read<{ ok: boolean }>("config")).resolves.toEqual({ ok: true });
    await expect(readFile(configPath, "utf8")).resolves.toContain('"ok": true');
  });
});
