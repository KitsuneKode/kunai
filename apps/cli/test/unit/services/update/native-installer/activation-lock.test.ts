import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      pollMs: 5,
    });
    expect(second).toMatchObject({ acquired: false, holderPid: process.pid });
    expect(existsSync(activationLockPath(layout))).toBe(true);

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
        processStartId: "linux-proc:0",
      })}\n`,
    );

    const lock = await tryAcquireActivationLock(layout, "2.0.0", {
      timeoutMs: 100,
      pollMs: 5,
    });
    expect(lock.acquired).toBe(true);
    if (lock.acquired) await lock.release();
  });

  test("does not hot-loop when exclusive creation fails while the lock path is absent", async () => {
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
  });

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
});
