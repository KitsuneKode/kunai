import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanupOldVersions } from "@/services/update/native-installer/cleanup-versions";
import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";

const made: string[] = [];

afterEach(async () => {
  for (const root of made.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("cleanupOldVersions", () => {
  test("resolves when the locks dir cannot be created — a probe failure is protection, not a crash", async () => {
    // ENOTDIR repro for plan 062: `locks` exists as a regular file, so the
    // lock probe's mkdir throws — previously an unhandled rejection after a
    // successful install, now just "version left alone".
    const root = await mkdtemp(join(tmpdir(), "kunai-cleanup-lock-"));
    made.push(root);
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: process.platform,
    });
    await mkdir(join(layout.versionsDir, "0.0.1"), { recursive: true });
    await writeFile(join(layout.versionsDir, "0.0.1", "kunai"), "bin");
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.locksDir, "not a directory");

    await expect(
      cleanupOldVersions(layout, join(root, "elsewhere", "kunai")),
    ).resolves.toBeUndefined();
  });
});
