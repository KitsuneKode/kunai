import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { tryAcquireVersionLock } from "@/services/update/native-installer/version-lock";

describe("version lock", () => {
  test("acquires and releases a per-version lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-"));
    const layout = {
      dataDir: root,
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      versionsDir: join(root, "versions"),
      locksDir: join(root, "locks"),
      stagingRoot: join(root, "staging"),
      launcherPath: join(root, "bin", "kunai"),
      binaryFileName: "kunai",
    };
    await mkdir(layout.locksDir, { recursive: true });

    const first = await tryAcquireVersionLock(layout, "1.0.0");
    expect(first.acquired).toBe(true);

    const second = await tryAcquireVersionLock(layout, "1.0.0");
    expect(second.acquired).toBe(false);

    if (first.acquired) await first.release();

    const third = await tryAcquireVersionLock(layout, "1.0.0");
    expect(third.acquired).toBe(true);
    if (third.acquired) await third.release();

    await rm(root, { recursive: true, force: true });
  });

  test("stores pid metadata in lock file", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-"));
    const layout = {
      dataDir: root,
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      versionsDir: join(root, "versions"),
      locksDir: join(root, "locks"),
      stagingRoot: join(root, "staging"),
      launcherPath: join(root, "bin", "kunai"),
      binaryFileName: "kunai",
    };
    await mkdir(layout.locksDir, { recursive: true });

    const lock = await tryAcquireVersionLock(layout, "9.9.9");
    expect(lock.acquired).toBe(true);
    const content = JSON.parse(await readFile(join(layout.locksDir, "9.9.9.lock"), "utf8")) as {
      pid: number;
      version: string;
    };
    expect(content.pid).toBe(process.pid);
    expect(content.version).toBe("9.9.9");

    if (lock.acquired) await lock.release();
    await rm(root, { recursive: true, force: true });
  });
});
