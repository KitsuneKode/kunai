import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";
import {
  inspectVersionLock,
  lockCurrentVersion,
  releaseCurrentVersionLock,
  tryAcquireVersionLock,
} from "@/services/update/native-installer/version-lock";

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
      transactionsDir: join(root, "transactions"),
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
      transactionsDir: join(root, "transactions"),
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

  test("lifetime lock releases through releaseCurrentVersionLock, exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-"));
    const layout = {
      dataDir: root,
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      versionsDir: join(root, "versions"),
      locksDir: join(root, "locks"),
      stagingRoot: join(root, "staging"),
      transactionsDir: join(root, "transactions"),
      launcherPath: join(root, "bin", "kunai"),
      binaryFileName: "kunai",
    };
    const execPath = join(layout.versionsDir, "1.2.3", "kunai");

    await lockCurrentVersion(layout, execPath);
    const lockPath = join(layout.locksDir, "1.2.3.lock");
    expect(existsSync(lockPath)).toBe(true);

    await releaseCurrentVersionLock();
    expect(existsSync(lockPath)).toBe(false);

    // A second release is a no-op rather than an error.
    await releaseCurrentVersionLock();
    expect(existsSync(lockPath)).toBe(false);

    await rm(root, { recursive: true, force: true });
  });

  test("lockCurrentVersion registers no signal handlers and never exits", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../../../../src/services/update/native-installer/version-lock.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/process\.once\(\s*"SIG/);
    expect(source).not.toMatch(/process\.on\(\s*"SIG/);
    expect(source).not.toMatch(/process\.exit\(/);
  });
});

describe("version lock inspection", () => {
  async function makeLayout() {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-inspect-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(layout.locksDir, { recursive: true });
    return { root, layout };
  }

  test("alive PID remains active regardless of age", async () => {
    const { root, layout } = await makeLayout();
    const lockPath = join(layout.locksDir, "1.2.3.lock");
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        version: "1.2.3",
        execPath: process.execPath,
        acquiredAt: ancient,
      })}\n`,
    );

    const inspection = await inspectVersionLock(layout, "1.2.3");
    expect(inspection).toMatchObject({
      status: "active",
      content: { pid: process.pid, version: "1.2.3" },
    });
    expect(existsSync(lockPath)).toBe(true);

    const acquire = await tryAcquireVersionLock(layout, "1.2.3");
    expect(acquire.acquired).toBe(false);
    expect(existsSync(lockPath)).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  test("read-only inspection never removes stale lock files", async () => {
    const { root, layout } = await makeLayout();
    const lockPath = join(layout.locksDir, "2.0.0.lock");
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: 2_147_483_646,
        version: "2.0.0",
        execPath: "/tmp/not-a-real-kunai",
        acquiredAt: "2020-01-01T00:00:00.000Z",
      })}\n`,
    );

    const inspection = await inspectVersionLock(layout, "2.0.0");
    expect(inspection.status).toBe("stale");
    expect(existsSync(lockPath)).toBe(true);

    await rm(root, { recursive: true, force: true });
  });
});
