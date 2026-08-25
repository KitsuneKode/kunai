import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";
import { tryAcquireActivationLock } from "@/services/update/native-installer/activation-lock";
import {
  activationLockPath,
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import { migrateFlatInstall } from "@/services/update/native-installer/migrate-flat-install";

import { describePosixOnly as describe } from "../../../../helpers/platform-gates";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function seedFlatInstall() {
  const root = await mkdtemp(join(tmpdir(), "kunai-flat-migration-lock-"));
  roots.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(dirname(layout.launcherPath), { recursive: true });
  await writeFile(layout.launcherPath, "flat-launcher", { mode: 0o755 });
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: "1.2.3",
      launcherPath: layout.launcherPath,
      downloadBaseUrl: "https://example.test/releases",
    },
    layout,
  );
  const manifest = await readInstallManifest(layout.configDir);
  if (!manifest) throw new Error("Expected seeded flat install manifest");
  return { layout, manifest };
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(5);
  }
}

describe("migrateFlatInstall activation", () => {
  test("copies the version outside the activation lock and waits before shared publication", async () => {
    const { layout, manifest } = await seedFlatInstall();
    const lock = await tryAcquireActivationLock(layout, "9.9.9");
    expect(lock.acquired).toBe(true);

    const migration = migrateFlatInstall({
      manifest,
      currentVersion: "1.2.3",
      execPath: layout.launcherPath,
      layout,
    });
    await waitForPath(versionBinaryPath(layout, "1.2.3"));
    await Bun.sleep(20);
    expect((await lstat(layout.launcherPath)).isFile()).toBe(true);

    if (lock.acquired) await lock.release();
    expect(await migration).toEqual({
      migrated: true,
      versionPath: versionBinaryPath(layout, "1.2.3"),
    });
  });

  test("restores the flat launcher before releasing when manifest commit fails", async () => {
    const { layout, manifest } = await seedFlatInstall();
    await chmod(layout.configDir, 0o500);
    try {
      await expect(
        migrateFlatInstall({
          manifest,
          currentVersion: "1.2.3",
          execPath: layout.launcherPath,
          layout,
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(layout.configDir, 0o700);
    }

    expect((await lstat(layout.launcherPath)).isFile()).toBe(true);
    expect(await readFile(layout.launcherPath, "utf8")).toBe("flat-launcher");
    expect(await Bun.file(activationLockPath(layout)).exists()).toBe(false);
  });
});
