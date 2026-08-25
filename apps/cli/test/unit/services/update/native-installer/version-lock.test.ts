import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import {
  activationLockPath,
  getInstallLayoutPaths,
  lifecycleGuardPath,
} from "@/services/update/native-installer/install-layout";
import {
  inspectVersionLock,
  lifecycleLockPath,
  lockCurrentVersion,
  releaseCurrentVersionLock,
  tryAcquireVersionLock,
  tryAcquireLifecycleLock,
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

  test("a live lifecycle lock prevents a new version install from bypassing uninstall", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });

    const lifecycle = await tryAcquireLifecycleLock(layout);
    expect(lifecycle.acquired).toBe(true);
    expect(existsSync(`${layout.dataDir}.lifecycle.lock`)).toBe(true);
    const content = JSON.parse(
      await readFile(`${layout.dataDir}.lifecycle.lock`, "utf8"),
    ) as Record<string, unknown>;
    expect(content).toMatchObject({
      schemaVersion: 1,
      scope: "lifecycle",
      pid: process.pid,
      hostname: hostname().trim().toLowerCase(),
    });
    expect(content.ownerId).toBeString();
    expect(content.processStartId === null || typeof content.processStartId === "string").toBe(
      true,
    );
    const version = await tryAcquireVersionLock(layout, "1.2.3");
    expect(version.acquired).toBe(false);

    if (lifecycle.acquired) await lifecycle.release();
    expect(existsSync(`${layout.dataDir}.lifecycle.lock`)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  test("an external purge-safe lifecycle guard blocks a new version install", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-external-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(root, { recursive: true });
    await writeFile(
      `${layout.dataDir}.lifecycle.lock`,
      `${JSON.stringify({
        pid: process.pid,
        version: "0.0.0",
        execPath: process.execPath,
        acquiredAt: new Date().toISOString(),
      })}\n`,
    );

    const version = await tryAcquireVersionLock(layout, "1.2.3");
    expect(version).toMatchObject({ acquired: false, holderPid: process.pid });

    await rm(root, { recursive: true, force: true });
  });

  test("a foreign-host lifecycle guard fails closed even when its pid is dead locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-foreign-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(root, { recursive: true });
    await writeFile(
      `${layout.dataDir}.lifecycle.lock`,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "lifecycle",
        pid: 2_147_483_646,
        version: "0.0.0",
        execPath: "/remote/kunai",
        ownerId: "remote-owner",
        acquiredAt: "2026-08-24T00:00:00.000Z",
        hostname: " Another-Host.Example ",
        processStartId: null,
      })}\n`,
    );

    const version = await tryAcquireVersionLock(layout, "1.2.3");
    expect(version).toEqual({ acquired: false, holderPid: 2_147_483_646 });
    expect(existsSync(`${layout.dataDir}.lifecycle.lock`)).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  test("a same-host lifecycle guard with a reused pid is stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-reused-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(root, { recursive: true });
    await writeFile(
      `${layout.dataDir}.lifecycle.lock`,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "lifecycle",
        pid: process.pid,
        version: "0.0.0",
        execPath: process.execPath,
        ownerId: "reused-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().trim().toLowerCase(),
        processStartId: process.platform === "win32" ? "windows-ticks:0" : "linux-proc:0",
      })}\n`,
    );

    const version = await tryAcquireVersionLock(layout, "1.2.3", {
      execPath: process.execPath,
      processStartIdLookup: () =>
        process.platform === "win32" ? "windows-ticks:1" : "linux-proc:1",
    });
    expect(version.acquired).toBe(true);
    if (version.acquired) await version.release();

    await rm(root, { recursive: true, force: true });
  });

  test("legacy lifecycle records keep local live-pid compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-legacy-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(root, { recursive: true });
    await writeFile(
      `${layout.dataDir}.lifecycle.lock`,
      `${JSON.stringify({
        pid: process.pid,
        version: "0.0.0",
        execPath: process.execPath,
        acquiredAt: new Date().toISOString(),
      })}\n`,
    );

    expect(await tryAcquireVersionLock(layout, "1.2.3")).toEqual({
      acquired: false,
      holderPid: process.pid,
    });

    await rm(root, { recursive: true, force: true });
  });

  test("a partial lifecycle guard blocks during grace and becomes recoverable when abandoned", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-partial-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    const guardPath = `${layout.dataDir}.lifecycle.lock`;
    await mkdir(root, { recursive: true });
    await writeFile(guardPath, "");

    expect((await tryAcquireVersionLock(layout, "1.2.3")).acquired).toBe(false);

    const abandoned = new Date(Date.now() - 1_000);
    await utimes(guardPath, abandoned, abandoned);
    const recovered = await tryAcquireVersionLock(layout, "1.2.3");
    expect(recovered.acquired).toBe(true);
    if (recovered.acquired) await recovered.release();

    await rm(root, { recursive: true, force: true });
  });

  test("an incomplete schema-1 lifecycle record receives corrupt grace", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-invalid-lifecycle-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    const guardPath = `${layout.dataDir}.lifecycle.lock`;
    await mkdir(root, { recursive: true });
    await writeFile(
      guardPath,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "lifecycle",
        version: "0.0.0",
        execPath: process.execPath,
        ownerId: "partial-owner",
        acquiredAt: new Date().toISOString(),
        hostname: hostname().trim().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    expect((await tryAcquireVersionLock(layout, "1.2.3")).acquired).toBe(false);

    const abandoned = new Date(Date.now() - 1_000);
    await utimes(guardPath, abandoned, abandoned);
    const recovered = await tryAcquireVersionLock(layout, "1.2.3");
    expect(recovered.acquired).toBe(true);
    if (recovered.acquired) await recovered.release();

    await rm(root, { recursive: true, force: true });
  });

  test("two contenders serialize reclaim of an aged corrupt lifecycle guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-racing-lifecycle-reclaim-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    const guardPath = lifecycleGuardPath(layout);
    await mkdir(root, { recursive: true });
    await writeFile(guardPath, "");
    const abandoned = new Date(Date.now() - 1_000);
    await utimes(guardPath, abandoned, abandoned);

    const contentionOptions = {
      force: true,
      activationLockTimeoutMs: 40,
    };
    const contenders = await Promise.all([
      tryAcquireLifecycleLock(layout, contentionOptions),
      tryAcquireLifecycleLock(layout, contentionOptions),
    ]);
    const winners = contenders.filter((result) => result.acquired);

    try {
      expect(winners).toHaveLength(1);
      expect(existsSync(activationLockPath(layout))).toBe(true);
      expect(existsSync(guardPath)).toBe(true);
      const external = JSON.parse(await readFile(guardPath, "utf8")) as { ownerId?: string };
      const internal = JSON.parse(await readFile(lifecycleLockPath(layout), "utf8")) as {
        ownerId?: string;
      };
      expect(external.ownerId).toBeString();
      expect(internal.ownerId).toBe(external.ownerId);
    } finally {
      await Promise.all(
        contenders.map(async (result) => {
          if (result.acquired) await result.release();
        }),
      );
      await rm(root, { recursive: true, force: true });
    }
  });

  test("backout surfaces lifecycle guard cleanup failure before releasing activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-lock-lifecycle-backout-failure-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    const guardPath = lifecycleGuardPath(layout);
    await mkdir(layout.locksDir, { recursive: true });
    await writeFile(
      lifecycleLockPath(layout),
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "lifecycle",
        pid: process.pid,
        version: "0.0.0",
        execPath: process.execPath,
        ownerId: "existing-owner",
        acquiredAt: new Date().toISOString(),
        hostname: hostname().trim().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    let activationHeldDuringBackout = false;
    const injectedRm: typeof rm = async (path, options) => {
      if (path === guardPath) {
        activationHeldDuringBackout = existsSync(activationLockPath(layout));
        throw new Error("injected lifecycle guard removal failure");
      }
      return await rm(path, options);
    };
    const acquisitionOptions = {
      activationLockTimeoutMs: 40,
      rmImpl: injectedRm,
    };

    try {
      await expect(tryAcquireLifecycleLock(layout, acquisitionOptions)).rejects.toThrow(
        /back out lifecycle lock/i,
      );
      expect(activationHeldDuringBackout).toBe(true);
      expect(existsSync(guardPath)).toBe(true);
      expect(existsSync(activationLockPath(layout))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "surfaces failure to remove an owner-matching lifecycle guard",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "kunai-lock-release-lifecycle-"));
      const layout = getInstallLayoutPaths({
        dataDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        launcherPath: join(root, "bin", "kunai"),
        platform: "linux",
      });
      const lifecycle = await tryAcquireLifecycleLock(layout);
      expect(lifecycle.acquired).toBe(true);
      if (!lifecycle.acquired) return;

      try {
        await chmod(layout.locksDir, 0o500);
        await expect(lifecycle.release()).rejects.toThrow(/release lifecycle lock/i);
        expect(existsSync(lifecycleLockPath(layout))).toBe(true);
      } finally {
        await chmod(layout.locksDir, 0o700);
        await lifecycle.release();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
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

  test("young corrupt lock is inspect-stale and immediately reclaimable", async () => {
    const { root, layout } = await makeLayout();
    const lockPath = join(layout.locksDir, "3.1.4.lock");
    await writeFile(lockPath, "{not-valid-json\n");

    const inspection = await inspectVersionLock(layout, "3.1.4");
    expect(inspection).toMatchObject({
      status: "stale",
      content: null,
    });
    expect(existsSync(lockPath)).toBe(true);

    const acquire = await tryAcquireVersionLock(layout, "3.1.4");
    expect(acquire.acquired).toBe(true);
    if (acquire.acquired) await acquire.release();

    await rm(root, { recursive: true, force: true });
  });
});
