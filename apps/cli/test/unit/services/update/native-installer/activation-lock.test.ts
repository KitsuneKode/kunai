import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  tryAcquireActivationLock,
  withActivationLock,
} from "@/services/update/native-installer/activation-lock";
import {
  activationLockPath,
  getInstallLayoutPaths,
} from "@/services/update/native-installer/install-layout";

const made: string[] = [];

function impossibleProcessStartId(): string {
  if (process.platform === "win32") return "windows-ticks:0";
  if (process.platform === "darwin") return "darwin-ps:impossible";
  return "linux-proc:0";
}

afterEach(async () => {
  for (const root of made.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-activation-lock-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.locksDir, { recursive: true });
  return layout;
}

describe("activation lock", () => {
  test("stores cross-language ownership metadata and releases only its own lock", async () => {
    const layout = await makeLayout();
    const lock = await tryAcquireActivationLock(layout, "1.2.3", {
      execPath: "/tmp/kunai-updater",
    });

    expect(lock.acquired).toBe(true);
    const path = activationLockPath(layout);
    const content = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(content).toMatchObject({
      schemaVersion: 1,
      scope: "activation",
      pid: process.pid,
      version: "1.2.3",
      execPath: "/tmp/kunai-updater",
    });
    expect(content.ownerId).toBeString();
    expect(content.acquiredAt).toBeString();
    expect(content.hostname).toBe(hostname().toLowerCase());
    expect(content.processStartId === null || typeof content.processStartId === "string").toBe(
      true,
    );

    if (lock.acquired) await lock.release();
    expect(existsSync(path)).toBe(false);
  });

  test("times out without disturbing a live owner", async () => {
    const layout = await makeLayout();
    const first = await tryAcquireActivationLock(layout, "1.0.0");
    expect(first.acquired).toBe(true);

    const second = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 30,
      pollMs: 0,
    });
    expect(second).toMatchObject({ acquired: false, holderPid: process.pid });
    expect(existsSync(activationLockPath(layout))).toBe(true);

    if (first.acquired) await first.release();
  });

  test("timeout zero still makes one immediate uncontended acquisition attempt", async () => {
    const layout = await makeLayout();
    const lock = await tryAcquireActivationLock(layout, "1.0.1", {
      timeoutMs: 0,
      pollMs: 0,
    });
    expect(lock.acquired).toBe(true);
    if (lock.acquired) await lock.release();
  });

  test("includes local acquisition queue time in the caller's deadline", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(path, "{not-json\n");

    const firstPromise = tryAcquireActivationLock(layout, "1.0.0", {
      timeoutMs: 500,
      pollMs: 5,
      corruptGraceMs: 150,
    });
    await Bun.sleep(10);
    const startedAt = performance.now();
    const second = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 30,
      pollMs: 5,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(second.acquired).toBe(false);
    expect(elapsedMs).toBeLessThan(100);

    const first = await firstPromise;
    if (first.acquired) await first.release();
  });

  test("reclaims a lock whose owner process is dead", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/dead-installer",
        ownerId: "dead-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    const lock = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 100,
      pollMs: 5,
    });
    expect(lock.acquired).toBe(true);
    const content = JSON.parse(await readFile(path, "utf8")) as { version: string };
    expect(content.version).toBe("2.0.0");

    if (lock.acquired) await lock.release();
  });

  test("only one of eight stale-lock reclaimers enters activation at a time", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/dead-installer",
        ownerId: "dead-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    let inside = 0;
    let maximumInside = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const lock = await tryAcquireActivationLock(layout, `2.0.${index}`, {
          timeoutMs: 2_000,
          pollMs: 1,
        });
        if (!lock.acquired) return false;
        inside += 1;
        maximumInside = Math.max(maximumInside, inside);
        await Bun.sleep(15);
        inside -= 1;
        await lock.release();
        return true;
      }),
    );

    expect(results).toEqual([true, true, true, true, true, true, true, true]);
    expect(maximumInside).toBe(1);
  });

  test("serializes eight separate processes reclaiming the same stale lock", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    const criticalPath = join(dirname(path), "activation-critical-section");
    const violationPath = join(dirname(path), "activation-overlap-detected");
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/dead-installer",
        ownerId: "dead-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    const modulePath = join(
      import.meta.dir,
      "../../../../../src/services/update/native-installer/activation-lock.ts",
    );
    const worker = `
      import { mkdir, rm, writeFile } from "node:fs/promises";
      import { withActivationLock } from ${JSON.stringify(modulePath)};
      const result = await withActivationLock(
        { locksDir: process.env.KUNAI_TEST_LOCKS_DIR },
        process.env.KUNAI_TEST_VERSION,
        async () => {
          let ownsSentinel = false;
          try {
            await mkdir(process.env.KUNAI_TEST_CRITICAL_PATH);
            ownsSentinel = true;
          } catch {
            await writeFile(process.env.KUNAI_TEST_VIOLATION_PATH, "overlap");
          }
          await Bun.sleep(20);
          if (ownsSentinel) await rm(process.env.KUNAI_TEST_CRITICAL_PATH, { recursive: true });
        },
        { timeoutMs: 2_000, pollMs: 1 },
      );
      process.exit(result === null ? 2 : 0);
    `;
    const processes = Array.from({ length: 8 }, (_, index) =>
      Bun.spawn([process.execPath, "-e", worker], {
        cwd: join(import.meta.dir, "../../../../.."),
        env: {
          ...process.env,
          KUNAI_TEST_LOCKS_DIR: layout.locksDir,
          KUNAI_TEST_VERSION: `3.0.${index}`,
          KUNAI_TEST_CRITICAL_PATH: criticalPath,
          KUNAI_TEST_VIOLATION_PATH: violationPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const statuses = await Promise.all(processes.map((process) => process.exited));

    expect(statuses).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(existsSync(violationPath)).toBe(false);
  });

  test("defers process-start validation for a fresh live reclaim claim", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    const claimPath = `${path}.reclaim.reused-pid-claim`;
    await writeFile(
      claimPath,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: process.pid,
        version: "1.0.0",
        execPath: "/tmp/previous-installer",
        ownerId: "reused-pid-claim",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().toLowerCase(),
        processStartId: impossibleProcessStartId(),
      })}\n`,
    );

    const fresh = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 20,
      pollMs: 5,
    });
    expect(fresh.acquired).toBe(false);
    expect(existsSync(claimPath)).toBe(true);

    const staleTime = new Date(Date.now() - 5_000);
    await utimes(claimPath, staleTime, staleTime);
    const aged = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 100,
      pollMs: 5,
    });
    expect(aged.acquired).toBe(true);
    expect(existsSync(claimPath)).toBe(false);
    if (aged.acquired) await aged.release();
  });

  test("ignores and cleans a crashed reclaim temp without electing it as a claim", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    const orphanTempPath = `${path}.reclaim.crashed-owner.tmp.orphan`;
    await writeFile(orphanTempPath, "{partial");
    const abandoned = new Date(Date.now() - 5_000);
    await utimes(orphanTempPath, abandoned, abandoned);

    const lock = await tryAcquireActivationLock(layout, "2.1.0", {
      timeoutMs: 40,
      pollMs: 5,
    });

    expect(lock.acquired).toBe(true);
    expect(existsSync(orphanTempPath)).toBe(false);
    if (lock.acquired) await lock.release();
  });

  test("never reclaims a valid lock owned by another hostname", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/remote-installer",
        ownerId: "remote-owner",
        acquiredAt: "2026-08-24T00:00:00.000Z",
        hostname: "another-host.example",
        processStartId: null,
      })}\n`,
    );

    const lock = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 30,
      pollMs: 5,
    });
    expect(lock).toEqual({ acquired: false, holderPid: 2_147_483_646 });
    expect(JSON.parse(await readFile(path, "utf8")).ownerId).toBe("remote-owner");
  });

  test("defers process-start validation for a newly published live lock", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: process.pid,
        version: "1.0.0",
        execPath: "/tmp/current-installer",
        ownerId: "fresh-live-owner",
        acquiredAt: new Date().toISOString(),
        hostname: hostname().toLowerCase(),
        processStartId: impossibleProcessStartId(),
      })}\n`,
    );

    const lock = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 20,
      pollMs: 5,
    });
    expect(lock).toEqual({ acquired: false, holderPid: process.pid });
    expect(JSON.parse(await readFile(path, "utf8")).ownerId).toBe("fresh-live-owner");
  });

  test("reclaims a reused local pid when the process-start identity differs", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: process.pid,
        version: "1.0.0",
        execPath: "/tmp/previous-installer",
        ownerId: "reused-pid-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().toLowerCase(),
        processStartId: impossibleProcessStartId(),
      })}\n`,
    );

    const lock = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 100,
      pollMs: 5,
    });
    expect(lock.acquired).toBe(true);
    if (lock.acquired) await lock.release();
  });

  test.skipIf(process.platform === "win32")(
    "does not hot-loop when exclusive creation fails while the lock path is absent",
    async () => {
      const layout = await makeLayout();
      await chmod(layout.locksDir, 0o500);
      const acquisition = tryAcquireActivationLock(layout, "5.0.0", {
        timeoutMs: 30,
        pollMs: 5,
      });
      const outcome = await Promise.race([
        acquisition.then(
          () => "settled",
          () => "settled",
        ),
        Bun.sleep(150).then(() => "hung"),
      ]);
      await chmod(layout.locksDir, 0o700);
      if (outcome === "hung") {
        const eventual = await acquisition;
        if (eventual.acquired) await eventual.release();
      }
      expect(outcome).toBe("settled");
    },
  );

  test("reclaims persistently corrupt metadata after the partial-write grace period", async () => {
    const layout = await makeLayout();
    const path = activationLockPath(layout);
    await writeFile(path, "{not-json\n");

    const lock = await tryAcquireActivationLock(layout, "3.0.0", {
      timeoutMs: 100,
      pollMs: 5,
      corruptGraceMs: 15,
    });
    expect(lock.acquired).toBe(true);
    const content = JSON.parse(await readFile(path, "utf8")) as { version: string };
    expect(content.version).toBe("3.0.0");

    if (lock.acquired) await lock.release();
  });

  test("releases the lock when activation throws", async () => {
    const layout = await makeLayout();

    await expect(
      withActivationLock(layout, "4.0.0", async () => {
        throw new Error("activation failed");
      }),
    ).rejects.toThrow("activation failed");
    expect(existsSync(activationLockPath(layout))).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "surfaces an injected release cleanup failure and preserves ownership",
    async () => {
      const layout = await makeLayout();
      const path = activationLockPath(layout);
      const lock = await tryAcquireActivationLock(layout, "4.1.0");
      expect(lock.acquired).toBe(true);
      if (!lock.acquired) return;

      try {
        await chmod(layout.locksDir, 0o500);
        await expect(lock.release()).rejects.toThrow(/release activation lock/i);
        expect(existsSync(path)).toBe(true);
      } finally {
        await chmod(layout.locksDir, 0o700);
        await lock.release();
      }
    },
  );
});
