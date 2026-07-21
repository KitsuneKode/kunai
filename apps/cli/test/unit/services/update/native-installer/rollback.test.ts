import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import {
  executeRollback,
  listRollbackCandidates,
  planRollback,
} from "@/services/update/native-installer/rollback";
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

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "kunai-rollback-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: process.platform === "win32" ? "win32" : "linux",
  });
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(layout.locksDir, { recursive: true });
  await mkdir(layout.transactionsDir, { recursive: true });
  await mkdir(layout.stagingRoot, { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(dirname(layout.launcherPath), { recursive: true });
  return { root, layout };
}

type TreeSnapshot = Record<string, string>;

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const out: TreeSnapshot = {};

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      const info = await stat(full);
      if (info.isDirectory()) {
        out[`${rel}/`] = "dir";
        await walk(full);
      } else {
        const bytes = await readFile(full);
        out[rel] = `${info.size}:${createHash("sha256").update(bytes).digest("hex")}`;
      }
    }
  }

  await walk(root);
  return out;
}

async function seedVerifiedVersion(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  version: string,
  content: string,
  overrides: Partial<InstalledVersionMetadata> = {},
): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const path = versionBinaryPath(layout, version);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await writeInstalledVersionMetadata(layout, {
    schemaVersion: 1,
    version,
    target: "linux-x64-gnu",
    artifactName: "kunai-linux-x64-gnu",
    artifactSha256: sha,
    sizeBytes: bytes.byteLength,
    sourceUrl: `https://example.test/v${version}/kunai-linux-x64-gnu`,
    verification: "release-checksum",
    installedAt: FIXED_DATE,
    ...overrides,
  });
  return path;
}

async function seedBinaryManifest(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  activeVersion: string,
  previousVersion?: string,
): Promise<void> {
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion,
      launcherPath: layout.launcherPath,
      versionedPath: versionBinaryPath(layout, activeVersion),
      downloadBaseUrl: "https://example.test/releases",
      target: "linux-x64-gnu",
      ...(previousVersion ? { previousVersion } : {}),
    },
    layout.configDir,
  );
}

describe("listRollbackCandidates / planRollback (read-only)", () => {
  test("lists only trusted checksum-verified local versions", async () => {
    const { layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "v100");
    await seedVerifiedVersion(layout, "2.0.0", "v200");
    const legacyPath = versionBinaryPath(layout, "1.5.0");
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, "legacy");
    await writeInstalledVersionMetadata(layout, {
      schemaVersion: 1,
      version: "1.5.0",
      target: "linux-x64-gnu",
      artifactName: "kunai-linux-x64-gnu",
      artifactSha256: createHash("sha256").update("legacy").digest("hex"),
      sizeBytes: 6,
      sourceUrl: "https://example.test/v1.5.0/kunai",
      verification: "legacy-unverified",
      installedAt: FIXED_DATE,
    });
    const corruptPath = versionBinaryPath(layout, "1.1.0");
    await mkdir(dirname(corruptPath), { recursive: true });
    await writeFile(corruptPath, "corrupt-now");
    await writeInstalledVersionMetadata(layout, {
      schemaVersion: 1,
      version: "1.1.0",
      target: "linux-x64-gnu",
      artifactName: "kunai-linux-x64-gnu",
      artifactSha256: "a".repeat(64),
      sizeBytes: 10,
      sourceUrl: "https://example.test/v1.1.0/kunai",
      verification: "release-checksum",
      installedAt: FIXED_DATE,
    });

    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const candidates = await listRollbackCandidates(layout);
    expect(candidates.map((c) => c.version).sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(candidates.find((c) => c.version === "1.0.0")).toMatchObject({
      previous: true,
      active: false,
      lockStatus: "missing",
      target: "linux-x64-gnu",
    });
    expect(candidates.find((c) => c.version === "2.0.0")).toMatchObject({
      active: true,
      previous: false,
    });
  });

  test("planning does not mutate state", async () => {
    const { root, layout } = await makeRoot();
    const previousPath = await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const before = await snapshotTree(root);
    const plan = await planRollback(layout);
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") {
      expect(plan.candidate.version).toBe("1.0.0");
      expect(plan.candidate.versionPath).toBe(previousPath);
    }
    expect(await snapshotTree(root)).toEqual(before);
  });

  test("excludes versions with an active lock from candidates", async () => {
    const { layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const lock = await tryAcquireVersionLock(layout, "1.0.0");
    expect(lock.acquired).toBe(true);
    try {
      const candidates = await listRollbackCandidates(layout);
      expect(candidates.map((c) => c.version)).toEqual(["2.0.0"]);
      const plan = await planRollback(layout);
      expect(plan).toMatchObject({ status: "refused", code: "locked" });
    } finally {
      if (lock.acquired) await lock.release();
    }
  });

  test("stale locks remain eligible with lockStatus stale", async () => {
    const { layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");
    await writeFile(
      join(layout.locksDir, "1.0.0.lock"),
      `${JSON.stringify({
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/dead",
        acquiredAt: FIXED_DATE,
      })}\n`,
    );

    const candidates = await listRollbackCandidates(layout);
    expect(candidates.find((c) => c.version === "1.0.0")?.lockStatus).toBe("stale");
  });
});

describe("executeRollback activation and refusal", () => {
  test("default targets previousVersion and swaps launcher + manifest", async () => {
    const { layout } = await makeRoot();
    const previousPath = await seedVerifiedVersion(layout, "1.0.0", "old");
    const activePath = await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(activePath, layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const result = await executeRollback(layout);
    expect(result).toEqual({
      status: "rolled-back",
      fromVersion: "2.0.0",
      toVersion: "1.0.0",
    });
    expect(await readlink(layout.launcherPath)).toBe(previousPath);
    const manifest = await readInstallManifest(layout.configDir);
    expect(manifest?.activeVersion).toBe("1.0.0");
    expect(manifest?.previousVersion).toBe("2.0.0");
    expect(manifest?.versionedPath).toBe(previousPath);
    expect(manifest?.preferredChannel).toBe("stable");
  });

  test("explicit --to validates strictly and activates that version", async () => {
    const { layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "v1");
    const midPath = await seedVerifiedVersion(layout, "1.5.0", "v15");
    await seedVerifiedVersion(layout, "2.0.0", "v2");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const result = await executeRollback(layout, { to: "1.5.0" });
    expect(result).toMatchObject({ status: "rolled-back", toVersion: "1.5.0" });
    expect(await readlink(layout.launcherPath)).toBe(midPath);
  });

  test("refuses invalid --to without change", async () => {
    const { root, layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");
    const before = await snapshotTree(root);

    for (const to of ["v1.0.0", "1.0.0-beta", "01.0.0", "not-a-version"]) {
      const result = await executeRollback(layout, { to });
      expect(result).toMatchObject({ status: "refused", code: "invalid-version" });
    }
    expect(await snapshotTree(root)).toEqual(before);
  });

  test("refuses active lock, corrupt, missing, and non-native without change", async () => {
    const { root, layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    const lock = await tryAcquireVersionLock(layout, "1.0.0");
    expect(lock.acquired).toBe(true);
    let before = await snapshotTree(root);
    expect(await executeRollback(layout)).toMatchObject({ status: "refused", code: "locked" });
    expect(await snapshotTree(root)).toEqual(before);
    if (lock.acquired) await lock.release();

    await writeFile(versionBinaryPath(layout, "1.0.0"), "tampered");
    before = await snapshotTree(root);
    expect(await executeRollback(layout)).toMatchObject({ status: "refused", code: "corrupt" });
    expect(await snapshotTree(root)).toEqual(before);

    await rm(join(layout.versionsDir, "1.0.0"), { recursive: true, force: true });
    before = await snapshotTree(root);
    expect(await executeRollback(layout)).toMatchObject({ status: "refused", code: "missing" });
    expect(await snapshotTree(root)).toEqual(before);

    await writeInstallManifest(
      {
        method: "npm-global",
        activeVersion: "2.0.0",
        previousVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        downloadBaseUrl: "https://example.test/releases",
      },
      layout.configDir,
    );
    before = await snapshotTree(root);
    expect(await executeRollback(layout)).toMatchObject({ status: "refused", code: "non-native" });
    expect(await snapshotTree(root)).toEqual(before);
  });

  test("dry-run performs no write", async () => {
    const { root, layout } = await makeRoot();
    await seedVerifiedVersion(layout, "1.0.0", "old");
    await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");
    const before = await snapshotTree(root);

    const result = await executeRollback(layout, { dryRun: true });
    expect(result).toEqual({
      status: "dry-run",
      fromVersion: "2.0.0",
      toVersion: "1.0.0",
    });
    expect(await snapshotTree(root)).toEqual(before);
  });

  test("restores launcher when manifest write fails after swap", async () => {
    const { layout } = await makeRoot();
    const previousPath = await seedVerifiedVersion(layout, "1.0.0", "old");
    const activePath = await seedVerifiedVersion(layout, "2.0.0", "new");
    await symlink(activePath, layout.launcherPath);
    await seedBinaryManifest(layout, "2.0.0", "1.0.0");

    // Read-only config dir: plan can still read install.json, write fails.
    const { chmod } = await import("node:fs/promises");
    await chmod(layout.configDir, 0o555);

    try {
      const result = await executeRollback(layout);
      expect(result.status).toBe("failed");
      expect(await readlink(layout.launcherPath)).toBe(activePath);
      expect(existsSync(previousPath)).toBe(true);
    } finally {
      await chmod(layout.configDir, 0o755);
    }
  });
});
