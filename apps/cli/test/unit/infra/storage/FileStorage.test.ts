import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";
import { getKunaiPaths } from "@kunai/storage";

import { applyStorageRootEnv } from "../../../helpers/storage-env";

/**
 * Corrupt-config backups are timestamped, so a test asserts on the set of
 * backups that exist rather than on one fixed name. A fixed `.corrupt.bak` was
 * the defect: every launch overwrote the previous one.
 *
 * `dirname`/`basename` rather than string surgery: the first version split on
 * `"/"`, which is right on POSIX and silently wrong on Windows, where the
 * separator is `\`. It passed on Linux and failed three tests on the Windows
 * parity leg.
 */
async function corruptBackups(configPath: string): Promise<string[]> {
  const dir = dirname(configPath);
  const base = basename(configPath);
  return (await readdir(dir)).filter((name) => name.startsWith(`${base}.corrupt.`)).sort();
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("FileStorage default path resolution", () => {
  // The module used to build its path map as a module-level constant, so
  // `getKunaiPaths()` ran while the file was being imported and froze the
  // developer's real config.json in. A suite that imported this file — however
  // indirectly — before pointing its storage root at a sandbox then wrote the
  // live profile. Import has already happened by the time this test runs, which
  // is exactly the condition that used to lose: the root set here must still win.
  test("honours a storage root set after this module was imported", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-root-"));
    tempDirs.push(dir);

    // Captured before the override so the guard below is a plain inequality.
    // Comparing path *spelling* is what two earlier versions of this test got
    // wrong: macOS hands out `/var/...` for a directory that resolves to
    // `/private/var/...`, and Windows reports the 8.3 form (`RUNNER~1`) where
    // `realpath` gives the long one. Neither is the point.
    const liveConfigPath = getKunaiPaths().configPath;

    const restore = applyStorageRootEnv(dir);
    try {
      // The same resolver the production default calls, evaluated now — so this
      // asserts deferral without hard-coding any platform's storage layout.
      const expected = getKunaiPaths().configPath;

      // Refuse to write until the sandbox is proven to be in effect. If a
      // platform ever stops honouring the override this fails here, rather than
      // writing the developer's real profile.
      expect(expected).not.toBe(liveConfigPath);

      await new FileStorage().write("config", { sandboxed: true });

      expect(await Bun.file(expected).exists()).toBe(true);

      // Empty string, never null: `toContain` rejects a null receiver, and
      // whether the machine running this happens to have a real config.json is
      // not something the test may depend on — it does on a developer box and
      // does not on a fresh CI runner.
      const liveContents = await Bun.file(liveConfigPath)
        .text()
        .catch(() => "");
      expect(liveContents).not.toContain("sandboxed");
    } finally {
      restore();
    }
  });

  test("an unknown key still throws, and exists() still answers false", async () => {
    const storage = new FileStorage({ config: "/tmp/kunai-unused.json" });

    expect(storage.read("nope")).rejects.toThrow("Unknown storage key: nope");
    expect(await storage.exists("nope")).toBe(false);
  });
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
      await writeFile(configPath, '{"providerRelay":{"token":"secret"}');
      await chmod(configPath, 0o644);

      const storage = new FileStorage({ config: configPath });

      await expect(storage.read("config")).resolves.toBeNull();
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      const [backup] = await corruptBackups(configPath);
      expect(backup).toBeDefined();
      expect((await stat(join(dir, backup!))).mode & 0o777).toBe(0o600);
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
    expect(await corruptBackups(configPath)).toEqual([]);
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
    const [backup] = await corruptBackups(configPath);
    expect(backup).toBeDefined();
    await expect(readFile(join(dir, backup!), "utf8")).resolves.toBe(corrupt);
    expect(warnings).toHaveLength(1);
  });

  /**
   * The defect this naming scheme exists to prevent. A fixed `.corrupt.bak`
   * meant the second launch overwrote the first launch's only copy — and since
   * the unreadable config is never rewritten, every later launch re-detected,
   * re-warned and re-clobbered it. Proven here with two distinct sentinels.
   */
  test("two corrupt launches keep both sets of bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");

    await writeFile(configPath, "CORRUPT-SENTINEL-AAA");
    const first = new FileStorage({ config: configPath });
    await expect(first.read("config")).resolves.toBeNull();

    await writeFile(configPath, "CORRUPT-SENTINEL-BBB");
    const second = new FileStorage({ config: configPath });
    await expect(second.read("config")).resolves.toBeNull();

    const backups = await corruptBackups(configPath);
    expect(backups).toHaveLength(2);
    const contents = await Promise.all(
      backups.map(async (name) => readFile(join(dir, name), "utf8")),
    );
    expect(contents.sort()).toEqual(["CORRUPT-SENTINEL-AAA", "CORRUPT-SENTINEL-BBB"]);
  });

  test("the corrupt-config warning does not claim the file was rewritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    const corrupt = "{ this is not json";
    await writeFile(configPath, corrupt);

    const warnings: string[] = [];
    const storage = new FileStorage({ config: configPath }, (message) => warnings.push(message));
    await expect(storage.read("config")).resolves.toBeNull();

    // The claim has to match the behaviour: nothing rewrites `configPath`, so
    // "has been reset to defaults" sent people looking for a rewrite that never
    // happened, and the bytes are still sitting there.
    expect(warnings[0]).not.toMatch(/reset/i);
    await expect(readFile(configPath, "utf8")).resolves.toBe(corrupt);
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
