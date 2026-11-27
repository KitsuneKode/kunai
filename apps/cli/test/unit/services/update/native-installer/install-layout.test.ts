import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getInstallLayoutPaths,
  isInsideStagingRoot,
  lockFilePath,
  parseVersionFromExecPath,
  removeStagingAndPruneParents,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import type { CanonicalVersion } from "@/services/update/version";

describe("install layout paths", () => {
  const containmentCases = [
    {
      label: "POSIX direct child",
      path: "/cache/kunai/staging/1.2.3",
      root: "/cache/kunai/staging",
      expected: true,
    },
    {
      label: "POSIX root",
      path: "/cache/kunai/staging",
      root: "/cache/kunai/staging",
      expected: false,
    },
    {
      label: "POSIX sibling prefix",
      path: "/cache/kunai/staging-old/1.2.3",
      root: "/cache/kunai/staging",
      expected: false,
    },
    {
      label: "POSIX traversal",
      path: "/cache/kunai/staging/1.2.3/../../../sentinel",
      root: "/cache/kunai/staging",
      expected: false,
    },
    {
      label: "Windows direct child",
      path: String.raw`C:\cache\kunai\staging\1.2.3`,
      root: String.raw`C:\cache\kunai\staging`,
      expected: true,
    },
    {
      label: "Windows root",
      path: String.raw`C:\cache\kunai\staging`,
      root: String.raw`C:\cache\kunai\staging`,
      expected: false,
    },
    {
      label: "Windows sibling prefix",
      path: String.raw`C:\cache\kunai\staging-old\1.2.3`,
      root: String.raw`C:\cache\kunai\staging`,
      expected: false,
    },
    {
      label: "Windows traversal",
      path: String.raw`C:\cache\kunai\staging\1.2.3\..\..\..\sentinel`,
      root: String.raw`C:\cache\kunai\staging`,
      expected: false,
    },
  ] as const;

  for (const { label, path, root, expected } of containmentCases) {
    test(`classifies ${label} structurally`, () => {
      expect(isInsideStagingRoot(path, root)).toBe(expected);
    });
  }

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

  test("removeStagingAndPruneParents refuses traversal before recursive removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-staging-containment-"));
    const stagingRoot = join(root, "cache", "staging");
    const external = join(root, "sentinel");
    await mkdir(join(stagingRoot, "1.2.3"), { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "keep.txt"), "keep");

    await expect(
      removeStagingAndPruneParents(`${stagingRoot}/1.2.3/../../../sentinel`, stagingRoot),
    ).rejects.toThrow("outside the staging root");

    expect(await readdir(external)).toEqual(["keep.txt"]);
  });

  test("a cross-family target never interprets the host's inherited profile override", () => {
    // On a Windows CI host process.env.KUNAI_CONFIG_DIR is a drive path a
    // POSIX target cannot read (and vice versa): the target must resolve its
    // own defaults instead of throwing or adopting the alien root.
    const opposite = process.platform === "win32" ? "linux" : "win32";
    const layout = getInstallLayoutPaths({ platform: opposite });
    expect(layout.dataDir).toBeTruthy();
    expect(layout.launcherPath).toBeTruthy();
  });

  test("an injected env with a valid profile produces a matching config and launcher", () => {
    // Same contract the shell installers derive: profile-rooted config dir
    // and a launcher under <profile>/bin — per path family, in-memory only.
    const cases = [
      {
        platform: "win32" as const,
        env: {
          USERPROFILE: "C:\\Users\\T",
          APPDATA: "C:\\Users\\T\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\T\\AppData\\Local",
          KUNAI_CONFIG_DIR: "C:\\profile",
        },
        configDir: "C:\\profile\\config",
        launcherPath: "C:\\profile\\bin\\kunai.cmd",
        profileDir: "C:\\profile",
      },
      {
        platform: "linux" as const,
        env: { HOME: "/home/t", KUNAI_CONFIG_DIR: "/srv/profile" },
        configDir: "/srv/profile/config",
        launcherPath: "/srv/profile/bin/kunai",
        profileDir: "/srv/profile",
      },
    ];
    for (const testCase of cases) {
      const layout = getInstallLayoutPaths({ platform: testCase.platform, env: testCase.env });
      expect(layout.configDir).toBe(testCase.configDir);
      expect(layout.launcherPath).toBe(testCase.launcherPath);
      expect(layout.profileDir).toBe(testCase.profileDir);

      // An override that only spells the canonical dir differently still
      // resolves to the canonical dir and keeps the profile attachment.
      const alias = getInstallLayoutPaths({
        platform: testCase.platform,
        env: testCase.env,
        configDir: testCase.configDir + (testCase.platform === "win32" ? "\\." : "/."),
      });
      expect(alias.configDir).toBe(testCase.configDir);
      expect(alias.profileDir).toBe(testCase.profileDir);

      // A genuinely different configDir is not the profile layout.
      const foreign = getInstallLayoutPaths({
        platform: testCase.platform,
        env: testCase.env,
        configDir: `${testCase.configDir}-other`,
      });
      expect(foreign.configDir).toBe(`${testCase.configDir}-other`);
      expect(foreign.profileDir).toBeUndefined();
    }
  });

  test("default layouts keep an absolute platform launcher and no profile", () => {
    const cases = [
      {
        platform: "linux" as const,
        env: { HOME: "/home/t" },
        launcherPath: "/home/t/.local/bin/kunai",
      },
      {
        platform: "darwin" as const,
        env: { HOME: "/Users/t" },
        launcherPath: "/Users/t/.local/bin/kunai",
      },
      {
        platform: "win32" as const,
        env: {
          USERPROFILE: "C:\\Users\\T",
          APPDATA: "C:\\Users\\T\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\T\\AppData\\Local",
        },
        launcherPath: "C:\\Users\\T\\AppData\\Local\\kunai\\bin\\kunai.exe",
      },
    ];
    for (const testCase of cases) {
      const layout = getInstallLayoutPaths({
        platform: testCase.platform,
        env: testCase.env,
      });
      expect(layout.profileDir).toBeUndefined();
      expect(layout.launcherPath).toBe(testCase.launcherPath);
    }
  });

  test.each([
    {
      platform: "linux" as const,
      env: { HOME: "/home/t", KUNAI_CONFIG_DIR: "/srv/profile" },
      bin: "/srv/profile/bin",
      platformDefaultBin: "/home/t/.local/bin",
    },
    {
      platform: "win32" as const,
      env: {
        USERPROFILE: "C:\\Users\\T",
        APPDATA: "C:\\Users\\T\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\T\\AppData\\Local",
        KUNAI_CONFIG_DIR: "C:\\profile",
      },
      bin: "C:\\profile\\bin",
      platformDefaultBin: "C:\\Users\\T\\AppData\\Local\\kunai\\bin",
    },
  ])(
    "a profile accepts KUNAI_BIN_DIR only when it names the derived bin ($platform)",
    ({ platform, env, bin, platformDefaultBin }) => {
      const ok = getInstallLayoutPaths({ platform, env: { ...env, KUNAI_BIN_DIR: bin } });
      expect(ok.profileDir).toBe(env.KUNAI_CONFIG_DIR);
      for (const bad of ["", join(bin, "..", "other"), platformDefaultBin]) {
        expect(() =>
          getInstallLayoutPaths({ platform, env: { ...env, KUNAI_BIN_DIR: bad } }),
        ).toThrow("KUNAI_BIN_DIR");
      }
    },
  );
});
