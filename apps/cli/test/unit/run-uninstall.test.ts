import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import { writeInstalledVersionMetadata } from "@/services/update/native-installer/version-metadata";
import { planUninstall, runUninstall } from "@/services/update/run-uninstall";

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("npm channel plans a global npm uninstall", () => {
  const p = planUninstall({ channel: "npm-global", binPath: "/x/kunai" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") {
    expect(p.command).toEqual(["npm", "uninstall", "-g", "@kitsunekode/kunai"]);
  }
});

test("bun channel plans a global bun uninstall", () => {
  const p = planUninstall({ channel: "bun-global", binPath: "/x/kunai" });
  expect(p.kind).toBe("exec");
  if (p.kind === "exec") {
    expect(p.command).toEqual(["bun", "uninstall", "-g", "@kitsunekode/kunai"]);
  }
});

test("binary channel plans a file removal at binPath", () => {
  const p = planUninstall({ channel: "binary", binPath: "/x/kunai" });
  expect(p.kind).toBe("remove-file");
  if (p.kind === "remove-file") expect(p.path).toBe("/x/kunai");
});

test("versioned binary channel plans native uninstall", () => {
  const p = planUninstall({
    channel: "binary",
    binPath: "/x/kunai",
    layout: "versioned",
  });
  expect(p.kind).toBe("native");
  if (p.kind === "native") {
    expect(p.launcherPath).toBe("/x/kunai");
  }
});

test("source channel plans manual guidance", () => {
  const p = planUninstall({ channel: "source", binPath: "/x/kunai" });
  expect(p.kind).toBe("manual");
});

test("unknown channel plans manual guidance", () => {
  const p = planUninstall({ channel: "unknown", binPath: "/x/kunai" });
  expect(p.kind).toBe("manual");
});

test("runUninstall removes the manifest after package-manager uninstall succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-package-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.configDir, { recursive: true });
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.0",
      launcherPath: layout.launcherPath,
      downloadBaseUrl: "https://registry.npmjs.org",
    },
    layout,
  );
  const configJson = join(layout.configDir, "config.json");
  await writeFile(configJson, "{}\n");

  const commands: string[][] = [];
  const code = await runUninstall({
    purge: false,
    layout,
    execImpl: async (command) => {
      commands.push([...command]);
      return 0;
    },
  });

  expect(code).toBe(0);
  expect(commands).toEqual([["npm", "uninstall", "-g", "@kitsunekode/kunai"]]);
  expect(existsSync(join(layout.configDir, "install.json"))).toBe(false);
  expect(existsSync(configJson)).toBe(true);
});

test("runUninstall retains the manifest when package-manager uninstall fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-package-failure-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.0",
      launcherPath: layout.launcherPath,
      downloadBaseUrl: "https://registry.npmjs.org",
    },
    layout,
  );

  const code = await runUninstall({
    purge: false,
    layout,
    execImpl: async () => 7,
  });

  expect(code).toBe(7);
  expect(existsSync(join(layout.configDir, "install.json"))).toBe(true);
});

test("runUninstall keeps a concurrent package publication behind every purge root", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-package-purge-race-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.0",
      launcherPath: layout.launcherPath,
      downloadBaseUrl: "https://registry.npmjs.org",
    },
    layout,
  );
  await mkdir(layout.cacheDir, { recursive: true });
  await writeFile(join(layout.cacheDir, "cache"), "old");

  let announcePurge!: () => void;
  const purgeStarted = new Promise<void>((resolve) => {
    announcePurge = resolve;
  });
  let resumePurge!: () => void;
  const purgeMayContinue = new Promise<void>((resolve) => {
    resumePurge = resolve;
  });
  const lifecycleGuard = `${layout.dataDir}.lifecycle.lock`;
  const guardedRoots: string[] = [];
  const originalRm = rm;
  const rmImpl: typeof rm = async (path, options) => {
    if (path === layout.configDir) {
      announcePurge();
      await purgeMayContinue;
    }
    const isPurgeRoot =
      path === layout.configDir || path === layout.cacheDir || path === layout.dataDir;
    if (isPurgeRoot && existsSync(lifecycleGuard)) guardedRoots.push(String(path));
    const result = await originalRm(path, options);
    if (isPurgeRoot) expect(existsSync(lifecycleGuard)).toBe(true);
    return result;
  };

  const uninstalling = runUninstall({
    purge: true,
    layout,
    execImpl: async () => 0,
    rmImpl,
  });
  await purgeStarted;

  let publicationFinished = false;
  let announcePublicationAttempt!: () => void;
  const publicationAttempted = new Promise<void>((resolve) => {
    announcePublicationAttempt = resolve;
  });
  const publishing = (async () => {
    await writeInstallManifest(
      {
        method: "npm-global",
        activeVersion: "2.0.0",
        launcherPath: layout.launcherPath,
        downloadBaseUrl: "https://registry.npmjs.org",
      },
      layout,
      { onAcquireAttempt: announcePublicationAttempt },
    );
    publicationFinished = true;
  })();
  await publicationAttempted;

  expect(publicationFinished).toBe(false);
  resumePurge();
  expect(await uninstalling).toBe(0);
  await publishing;
  expect(guardedRoots).toEqual([layout.configDir, layout.cacheDir, layout.dataDir]);
  expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("2.0.0");
});

test("runUninstall reports purge failures instead of claiming the root was removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-purge-failure-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.0",
      launcherPath: layout.launcherPath,
      downloadBaseUrl: "https://registry.npmjs.org",
    },
    layout,
  );

  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const code = await runUninstall({
      purge: true,
      layout,
      execImpl: async () => 0,
      rmImpl: async (path, options) => {
        if (path === layout.cacheDir) throw new Error("cache busy");
        return rm(path, options);
      },
    });
    expect(code).toBe(1);
  } finally {
    console.error = originalError;
  }
  expect(errors).toContain(`Failed to remove ${layout.cacheDir}: cache busy`);
});

for (const [manager, expectedCommand] of [
  ["npm", ["npm", "uninstall", "-g", "@kitsunekode/kunai"]],
  ["bun", ["bun", "uninstall", "-g", "@kitsunekode/kunai"]],
] as const) {
  test(`runUninstall delegates a no-manifest compiled child to ${manager}`, async () => {
    const root = await mkdtemp(join(tmpdir(), `kunai-run-uninstall-${manager}-context-`));
    made.push(root);
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    const commands: string[][] = [];

    const code = await runUninstall({
      purge: false,
      layout,
      detectInstallMethodInput: {
        packagedBinary: true,
        env: {
          KUNAI_MANAGED_PACKAGE_MANAGER: manager,
          KUNAI_MANAGED_PACKAGE_ROOT: join(root, "package"),
        },
      },
      execImpl: async (command) => {
        commands.push([...command]);
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(commands).toEqual([[...expectedCommand]]);
  });
}

test("runUninstall native path preserves config/history/cache/downloads by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(dirname(layout.launcherPath), { recursive: true });

  const bytes = new TextEncoder().encode("bin");
  const versionPath = versionBinaryPath(layout, "1.0.0");
  await mkdir(dirname(versionPath), { recursive: true });
  await writeFile(versionPath, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await writeInstalledVersionMetadata(layout, {
    schemaVersion: 1,
    version: "1.0.0",
    target: "linux-x64-gnu",
    artifactName: "kunai-linux-x64-gnu",
    artifactSha256: sha,
    sizeBytes: bytes.byteLength,
    sourceUrl: "https://example.test/v1.0.0/kunai",
    verification: "release-checksum",
    installedAt: "2026-07-21T10:00:00.000Z",
  });
  await symlink(versionPath, layout.launcherPath);
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: "1.0.0",
      launcherPath: layout.launcherPath,
      versionedPath: versionPath,
      downloadBaseUrl: "https://example.test/releases",
      artifactSha256: sha,
    },
    layout,
  );

  const configJson = join(layout.configDir, "config.json");
  const historyDb = join(layout.dataDir, "kunai-data.sqlite");
  const cacheDb = join(layout.cacheDir, "kunai-cache.sqlite");
  const downloads = join(layout.dataDir, "downloads", "ep.mkv");
  await writeFile(configJson, "{}\n");
  await writeFile(historyDb, "hist");
  await mkdir(layout.cacheDir, { recursive: true });
  await writeFile(cacheDb, "cache");
  await mkdir(dirname(downloads), { recursive: true });
  await writeFile(downloads, "dl");

  const code = await runUninstall({
    purge: false,
    layout,
    platform: "linux",
  });
  expect(code).toBe(0);
  expect(existsSync(layout.launcherPath)).toBe(false);
  expect(existsSync(layout.versionsDir)).toBe(false);
  expect(existsSync(join(layout.configDir, "install.json"))).toBe(false);
  expect(existsSync(configJson)).toBe(true);
  expect(existsSync(historyDb)).toBe(true);
  expect(existsSync(cacheDb)).toBe(true);
  expect(existsSync(downloads)).toBe(true);
});

test("homebrew channel plans manual removal guidance and never deletes the binary", () => {
  const p = planUninstall({ channel: "homebrew", binPath: "/opt/homebrew/bin/kunai" });
  expect(p.kind).toBe("manual");
  if (p.kind === "manual") expect(p.message).toContain("brew uninstall kunai");
});

test("scoop channel plans manual removal guidance and never deletes the binary", () => {
  const p = planUninstall({
    channel: "scoop",
    binPath: "C:\\Users\\k\\scoop\\apps\\kunai\\current\\kunai.exe",
  });
  expect(p.kind).toBe("manual");
  if (p.kind === "manual") expect(p.message).toContain("scoop uninstall kunai");
});

test("system-package channel plans manual removal guidance and never deletes the binary", () => {
  const p = planUninstall({ channel: "system-package", binPath: "/usr/bin/kunai" });
  expect(p.kind).toBe("manual");
  if (p.kind === "manual") expect(p.message).toContain("pacman -R kunai-bin");
});

test("runUninstall refuses an injected profileDir that is not the resolved profile root", async () => {
  // The layout seam is for tests of the *default* layout: a profileDir it
  // carries must match the environment's own override, or ownership cannot
  // be trusted and nothing — not even the manifest — may be read.
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-foreign-profile-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });

  const code = await runUninstall({
    purge: false,
    layout: { ...layout, profileDir: join(root, "elsewhere") },
  });
  // DesktopProfileError — invalid/unowned profile roots exit 2.
  expect(code).toBe(2);
});

test("runUninstall under an owned profile purges managed dirs but keeps the root and marker", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "kunai-run-uninstall-profile-"));
  made.push(root);
  const profileDir = join(root, "profile");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, ".kunai-profile"), "kunai-profile-v1\n");
  // An unrelated sibling inside the profile survives the purge.
  await writeFile(join(profileDir, "keep-me.txt"), "unrelated");

  const saved = process.env.KUNAI_CONFIG_DIR;
  process.env.KUNAI_CONFIG_DIR = profileDir;
  try {
    const layout = getInstallLayoutPaths({ platform: "linux" });
    expect(layout.profileDir).toBe(profileDir);
    // A non-binary manifest under a profile cannot delegate to an
    // account-wide remover: manual plan, but --purge still clears storage.
    await mkdir(layout.configDir, { recursive: true });
    await writeInstallManifest(
      {
        method: "npm-global",
        activeVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        downloadBaseUrl: "https://registry.npmjs.org",
      },
      layout,
    );
    for (const dir of [layout.dataDir, layout.cacheDir, join(profileDir, "tmp")]) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(join(layout.dataDir, "kunai-data.sqlite"), "data");

    const commands: string[][] = [];
    const code = await runUninstall({
      purge: true,
      force: true,
      layout,
      platform: "linux",
      execImpl: async (command) => {
        commands.push([...command]);
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(commands).toEqual([]);
    expect(existsSync(layout.configDir)).toBe(false);
    expect(existsSync(layout.dataDir)).toBe(false);
    expect(existsSync(layout.cacheDir)).toBe(false);
    expect(existsSync(join(profileDir, "tmp"))).toBe(false);
    expect(existsSync(join(profileDir, ".kunai-profile"))).toBe(true);
    expect(existsSync(join(profileDir, "keep-me.txt"))).toBe(true);
    expect(existsSync(profileDir)).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.KUNAI_CONFIG_DIR;
    else process.env.KUNAI_CONFIG_DIR = saved;
  }
});
