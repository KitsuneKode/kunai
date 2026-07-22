import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getInstallLayoutPaths,
  lockFilePath,
  parseVersionFromExecPath,
  removeStagingAndPruneParents,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import type { CanonicalVersion } from "@/services/update/version";

describe("install layout paths", () => {
  test("derives versioned paths from data dir", () => {
    const layout = getInstallLayoutPaths({
      dataDir: "/data/kunai",
      cacheDir: "/cache/kunai",
      configDir: "/config/kunai",
      launcherPath: "/home/user/.local/bin/kunai",
      platform: "linux",
    });

    expect(layout.versionsDir).toBe("/data/kunai/versions");
    expect(layout.locksDir).toBe("/data/kunai/locks");
    expect(layout.transactionsDir).toBe("/data/kunai/transactions");
    expect(layout.stagingRoot).toBe("/cache/kunai/staging");
    expect(versionBinaryPath(layout, "1.2.3")).toBe("/data/kunai/versions/1.2.3/kunai");
    expect(lockFilePath(layout, "1.2.3")).toBe("/data/kunai/locks/1.2.3.lock");
  });

  test("parses semver from versioned exec paths", () => {
    const layout = getInstallLayoutPaths({
      dataDir: "/data/kunai",
      cacheDir: "/cache/kunai",
      configDir: "/config/kunai",
      platform: "linux",
    });
    const execPath = join(layout.versionsDir, "2.0.1", "kunai");
    expect(parseVersionFromExecPath(execPath, layout)).toBe("2.0.1" as CanonicalVersion);
    expect(parseVersionFromExecPath("/usr/bin/kunai", layout)).toBeNull();
  });

  test("rejects path-like and non-strict versions before join", () => {
    const layout = getInstallLayoutPaths({
      dataDir: "/data/kunai",
      cacheDir: "/cache/kunai",
      configDir: "/config/kunai",
      platform: "linux",
    });
    expect(() => versionBinaryPath(layout, "../1.2.3")).toThrow(/Invalid install version/);
    expect(() => lockFilePath(layout, "1.2.3-beta")).toThrow(/Invalid install version/);
    expect(() => versionBinaryPath(layout, "01.2.3")).toThrow(/Invalid install version/);
    expect(
      parseVersionFromExecPath(join(layout.versionsDir, "1.2.3-beta", "kunai"), layout),
    ).toBeNull();
  });

  test("removeStagingAndPruneParents clears empty version and staging roots", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kunai-staging-prune-"));
    const stagingRoot = join(cacheDir, "staging");
    const staging = join(stagingRoot, "1.0.1", "txn-1");
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "partial.bin"), "x");

    await removeStagingAndPruneParents(staging, stagingRoot);

    expect(await readdir(cacheDir)).toEqual([]);
  });
});
