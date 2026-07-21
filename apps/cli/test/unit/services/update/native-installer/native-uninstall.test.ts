import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { writeInstallManifest } from "@/services/update/install-manifest";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import { nativeUninstall } from "@/services/update/native-installer/native-uninstall";
import { beginInstallTransaction } from "@/services/update/native-installer/transaction";
import { tryAcquireVersionLock } from "@/services/update/native-installer/version-lock";
import {
  type InstalledVersionMetadata,
  writeInstalledVersionMetadata,
} from "@/services/update/native-installer/version-metadata";

const FIXED_DATE = "2026-07-21T10:00:00.000Z";
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeRoot(platform: "linux" | "win32" = "linux") {
  const root = await mkdtemp(join(tmpdir(), "kunai-uninstall-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", platform === "win32" ? "kunai.exe" : "kunai"),
    platform,
  });
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(layout.locksDir, { recursive: true });
  await mkdir(layout.transactionsDir, { recursive: true });
  await mkdir(layout.stagingRoot, { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(dirname(layout.launcherPath), { recursive: true });
  return { root, layout };
}

async function seedVerifiedVersion(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  version: string,
  content: string,
  overrides: Partial<InstalledVersionMetadata> = {},
): Promise<{ path: string; sha256: string }> {
  const bytes = new TextEncoder().encode(content);
  const path = versionBinaryPath(layout, version);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeInstalledVersionMetadata(layout, {
    schemaVersion: 1,
    version,
    target: "linux-x64-gnu",
    artifactName: "kunai-linux-x64-gnu",
    artifactSha256: sha256,
    sizeBytes: bytes.byteLength,
    sourceUrl: `https://example.test/v${version}/kunai`,
    verification: "release-checksum",
    installedAt: FIXED_DATE,
    ...overrides,
  });
  return { path, sha256 };
}

async function seedManagedUnixInstall(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  version = "1.2.3",
) {
  const { path, sha256 } = await seedVerifiedVersion(layout, version, "kunai-bin");
  await symlink(path, layout.launcherPath);
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: version,
      launcherPath: layout.launcherPath,
      versionedPath: path,
      downloadBaseUrl: "https://example.test/releases",
      artifactSha256: sha256,
    },
    layout.configDir,
  );
  return { path, sha256 };
}

async function seedUserData(layout: ReturnType<typeof getInstallLayoutPaths>, root: string) {
  const configJson = join(layout.configDir, "config.json");
  const historyDb = join(layout.dataDir, "kunai-data.sqlite");
  const cacheDb = join(layout.cacheDir, "kunai-cache.sqlite");
  const downloads = join(layout.dataDir, "downloads", "ep1.mkv");
  const externalDownloads = join(root, "external-downloads", "movie.mkv");

  await writeFile(configJson, '{"theme":"sakura"}\n');
  await writeFile(historyDb, "history");
  await writeFile(cacheDb, "cache");
  await mkdir(dirname(downloads), { recursive: true });
  await writeFile(downloads, "offline");
  await mkdir(dirname(externalDownloads), { recursive: true });
  await writeFile(externalDownloads, "external");

  return { configJson, historyDb, cacheDb, downloads, externalDownloads };
}

describe("nativeUninstall residue and preservation", () => {
  test("default uninstall removes owned lifecycle state and preserves user data", async () => {
    const { root, layout } = await makeRoot();
    await seedManagedUnixInstall(layout);
    const user = await seedUserData(layout, root);

    const stagingFile = join(layout.stagingRoot, "1.2.3", "partial.bin");
    await mkdir(dirname(stagingFile), { recursive: true });
    await writeFile(stagingFile, "partial");

    const staleLock = join(layout.locksDir, "9.9.9.lock");
    await writeFile(
      staleLock,
      `${JSON.stringify({
        pid: 2_147_483_646,
        version: "9.9.9",
        execPath: "/tmp/dead",
        acquiredAt: "2020-01-01T00:00:00.000Z",
      })}\n`,
    );

    const abandoned = await beginInstallTransaction(layout, {
      kind: "upgrade",
      version: "1.2.3",
      stagingDir: join(layout.stagingRoot, "1.2.3"),
      pid: 2_147_483_646,
    });

    const aside = `${layout.launcherPath}.old.1710000000000`;
    await writeFile(aside, "old-launcher");

    const result = await nativeUninstall({ layout, platform: "linux" });

    expect(result.status).toBe("removed");
    expect(existsSync(layout.launcherPath)).toBe(false);
    expect(existsSync(aside)).toBe(false);
    expect(existsSync(layout.versionsDir)).toBe(false);
    expect(existsSync(layout.stagingRoot)).toBe(false);
    expect(existsSync(layout.transactionsDir)).toBe(false);
    expect(existsSync(layout.locksDir)).toBe(false);
    expect(existsSync(join(layout.configDir, "install.json"))).toBe(false);

    expect(existsSync(user.configJson)).toBe(true);
    expect(existsSync(user.historyDb)).toBe(true);
    expect(existsSync(user.cacheDb)).toBe(true);
    expect(existsSync(user.downloads)).toBe(true);
    expect(existsSync(user.externalDownloads)).toBe(true);

    expect(result.preserved).toContain(layout.configDir);
    expect(result.preserved).toContain(layout.dataDir);
    expect(result.preserved).toContain(layout.cacheDir);
    expect(result.preserved).toContain(dirname(user.downloads));
    expect(result.removed).toContain(layout.launcherPath);
    expect(result.removed).toContain(layout.versionsDir);
    expect(result.removed).toContain(layout.stagingRoot);
    expect(result.removed).toContain(layout.transactionsDir);
    expect(result.removed).toContain(layout.locksDir);
    expect(result.removed).toContain(join(layout.configDir, "install.json"));
    expect(result.failed).toEqual([]);
    expect(abandoned.id).toBeTruthy();
  });

  test("--purge reports each user root and preserves external download directories", async () => {
    const { root, layout } = await makeRoot();
    await seedManagedUnixInstall(layout);
    const user = await seedUserData(layout, root);

    const result = await nativeUninstall({
      layout,
      platform: "linux",
      purge: true,
      preservePaths: [dirname(user.externalDownloads)],
    });

    expect(result.status).toBe("removed");
    expect(existsSync(layout.configDir)).toBe(false);
    expect(existsSync(layout.dataDir)).toBe(false);
    expect(existsSync(layout.cacheDir)).toBe(false);
    expect(existsSync(user.externalDownloads)).toBe(true);
    expect(result.removed).toContain(layout.configDir);
    expect(result.removed).toContain(layout.dataDir);
    expect(result.removed).toContain(layout.cacheDir);
    expect(result.preserved).toContain(dirname(user.externalDownloads));
  });
});

describe("nativeUninstall refusal", () => {
  test("active lock blocks without mutation", async () => {
    const { root, layout } = await makeRoot();
    await seedManagedUnixInstall(layout);
    const user = await seedUserData(layout, root);
    const beforeManifest = await readFile(join(layout.configDir, "install.json"), "utf8");

    const lock = await tryAcquireVersionLock(layout, "1.2.3");
    expect(lock.acquired).toBe(true);

    const result = await nativeUninstall({ layout, platform: "linux", force: true });
    expect(result.status).toBe("blocked");
    expect(existsSync(layout.launcherPath)).toBe(true);
    expect(existsSync(layout.versionsDir)).toBe(true);
    expect(await readFile(join(layout.configDir, "install.json"), "utf8")).toBe(beforeManifest);
    expect(existsSync(user.configJson)).toBe(true);
    expect(existsSync(join(layout.locksDir, "1.2.3.lock"))).toBe(true);

    if (lock.acquired) await lock.release();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("active transaction blocks without mutation", async () => {
    const { layout } = await makeRoot();
    await seedManagedUnixInstall(layout);
    const before = await readdir(layout.versionsDir);

    await beginInstallTransaction(layout, {
      kind: "install",
      version: "1.2.3",
      pid: process.pid,
    });

    const result = await nativeUninstall({ layout, platform: "linux" });
    expect(result.status).toBe("blocked");
    expect(existsSync(layout.launcherPath)).toBe(true);
    expect(await readdir(layout.versionsDir)).toEqual(before);
    expect(existsSync(join(layout.configDir, "install.json"))).toBe(true);
  });

  test("unmanaged launcher blocks without mutation", async () => {
    const { layout } = await makeRoot();
    const { path, sha256 } = await seedVerifiedVersion(layout, "1.2.3", "kunai-bin");
    await writeFile(layout.launcherPath, "#!/bin/sh\necho foreign\n");
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: layout.launcherPath,
        versionedPath: path,
        downloadBaseUrl: "https://example.test/releases",
        artifactSha256: sha256,
      },
      layout.configDir,
    );

    const result = await nativeUninstall({ layout, platform: "linux" });
    expect(result.status).toBe("blocked");
    expect(await readFile(layout.launcherPath, "utf8")).toContain("foreign");
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(layout.configDir, "install.json"))).toBe(true);
  });

  test("Windows launcher ownership requires checksum match", async () => {
    const { layout } = await makeRoot("win32");
    const { path, sha256 } = await seedVerifiedVersion(layout, "1.2.3", "owned-bytes");
    await writeFile(layout.launcherPath, "owned-bytes");
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: layout.launcherPath,
        versionedPath: path,
        downloadBaseUrl: "https://example.test/releases",
        artifactSha256: sha256,
      },
      layout.configDir,
    );

    const ok = await nativeUninstall({ layout, platform: "win32" });
    expect(ok.status).toBe("removed");
    expect(existsSync(layout.launcherPath)).toBe(false);

    const { layout: layout2 } = await makeRoot("win32");
    const seeded = await seedVerifiedVersion(layout2, "1.2.3", "owned-bytes");
    await writeFile(layout2.launcherPath, "tampered-launcher");
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: layout2.launcherPath,
        versionedPath: seeded.path,
        downloadBaseUrl: "https://example.test/releases",
        artifactSha256: seeded.sha256,
      },
      layout2.configDir,
    );

    const blocked = await nativeUninstall({ layout: layout2, platform: "win32" });
    expect(blocked.status).toBe("blocked");
    expect(existsSync(layout2.launcherPath)).toBe(true);
    expect(existsSync(seeded.path)).toBe(true);
  });

  test("partial failure keeps the install manifest", async () => {
    const { layout } = await makeRoot();
    await seedManagedUnixInstall(layout);

    const originalRm = rm;
    let versionsAttempted = false;
    const rmSpy = async (path: Parameters<typeof rm>[0], options?: Parameters<typeof rm>[1]) => {
      if (typeof path === "string" && path === layout.versionsDir) {
        versionsAttempted = true;
        throw new Error("simulated versions removal failure");
      }
      return originalRm(path, options);
    };

    const result = await nativeUninstall({
      layout,
      platform: "linux",
      rmImpl: rmSpy,
    });

    expect(versionsAttempted).toBe(true);
    expect(result.status).toBe("partial");
    expect(existsSync(join(layout.configDir, "install.json"))).toBe(true);
    expect(result.failed.some((f) => f.path === layout.versionsDir)).toBe(true);
  });
});
