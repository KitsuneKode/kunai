import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";
import { tryAcquireActivationLock } from "@/services/update/native-installer/activation-lock";
import { installLatest } from "@/services/update/native-installer/install-latest";
import {
  activationLockPath,
  getInstallLayoutPaths,
  versionBinaryPath,
  versionMetadataPath,
} from "@/services/update/native-installer/install-layout";
import { isMuslEnvironmentSync } from "@/services/update/native-installer/musl";
import { verifyStoredVersion } from "@/services/update/native-installer/version-metadata";
import {
  releaseAssetName,
  resolveReleaseBinaryTarget,
  type ReleaseBinaryTarget,
} from "@/services/update/platform-assets";

import { createReleaseArchive } from "../../../../../scripts/build-release-archives";

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-install-latest-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", process.platform === "win32" ? "kunai.exe" : "kunai"),
    platform: process.platform === "win32" ? "win32" : "linux",
  });
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(dirname(layout.launcherPath), { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  return { root, layout };
}

function hostAssetName(): string {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const libc = os === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu";
  return releaseAssetName(os, arch, libc);
}

function hostTarget(): ReleaseBinaryTarget {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const libc = os === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu";
  const target = resolveReleaseBinaryTarget(os, arch, libc);
  if (!target) throw new Error(`Missing host release target ${os}-${arch}-${libc}`);
  return target;
}

function sumsFor(assetName: string, digest: string): string {
  return `${digest}  ${assetName}\n`;
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(5);
  }
}

async function seedLauncher(launcherPath: string, versionPath: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(launcherPath, await readFile(versionPath));
    return;
  }
  await symlink(versionPath, launcherPath);
}

async function expectLauncherPointsTo(launcherPath: string, versionPath: string): Promise<void> {
  if (process.platform === "win32") {
    expect(await readFile(launcherPath)).toEqual(await readFile(versionPath));
    return;
  }
  expect(await readlink(launcherPath)).toBe(versionPath);
}

describe("installLatest", () => {
  test("installs the verified archive member and records transport plus binary provenance", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("ARCHIVED-VERIFIED-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);
    const binaryDigest = sha256Hex(bytes);
    const archiveDigest = sha256Hex(archive);
    const requested: string[] = [];

    const result = await installLatest({
      version: "3.2.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/SHA256SUMS.archives")) {
          return new Response(sumsFor(releaseTarget.archiveName, archiveDigest));
        }
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, binaryDigest));
        }
        if (url.endsWith(`/${releaseTarget.archiveName}`)) return new Response(archive);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({ status: "installed", version: "3.2.0" });
    expect(await Bun.file(versionBinaryPath(layout, "3.2.0")).text()).toBe(
      "ARCHIVED-VERIFIED-BINARY",
    );
    expect(requested.some((url) => url.endsWith(`/${releaseTarget.out}`))).toBe(false);
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      schemaVersion: 2,
      artifactName: releaseTarget.out,
      artifactSha256: binaryDigest,
      artifactSizeBytes: bytes.length,
      artifactSourceUrl: `https://example.test/releases/download/v3.2.0/${releaseTarget.out}`,
      archiveName: releaseTarget.archiveName,
      archiveSha256: archiveDigest,
      archiveSizeBytes: archive.length,
      archiveSourceUrl: `https://example.test/releases/download/v3.2.0/${releaseTarget.archiveName}`,
    });
    expect(JSON.parse(await Bun.file(versionMetadataPath(layout, "3.2.0")).text())).toMatchObject({
      artifactName: releaseTarget.out,
      artifactSha256: binaryDigest,
      sizeBytes: bytes.length,
      sourceUrl: `https://example.test/releases/download/v3.2.0/${releaseTarget.out}`,
      archiveName: releaseTarget.archiveName,
      archiveSha256: archiveDigest,
      archiveSizeBytes: archive.length,
      archiveSourceUrl: `https://example.test/releases/download/v3.2.0/${releaseTarget.archiveName}`,
    });
  });

  test("410 archive manifest response falls back to the verified raw asset", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("LEGACY-RAW-BINARY");
    const digest = sha256Hex(bytes);
    const requested: string[] = [];

    const result = await installLatest({
      version: "2.9.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/SHA256SUMS.archives")) {
          return new Response("gone", { status: 410 });
        }
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, digest));
        }
        if (url.endsWith(`/${releaseTarget.out}`)) return new Response(bytes);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({ status: "installed", version: "2.9.0" });
    expect(requested.some((url) => url.endsWith(`/${releaseTarget.archiveName}`))).toBe(false);
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      artifactName: releaseTarget.out,
      artifactSha256: digest,
      artifactSizeBytes: bytes.length,
      artifactSourceUrl: `https://example.test/releases/download/v2.9.0/${releaseTarget.out}`,
    });
    expect((await readInstallManifest(layout.configDir))?.archiveName).toBeUndefined();
  });

  test("present malformed archive manifest fails closed without raw fallback", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const rawRequested: string[] = [];

    const result = await installLatest({
      version: "3.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("malformed\n");
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, "a".repeat(64)));
        }
        if (url.endsWith(`/${releaseTarget.out}`)) rawRequested.push(url);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: `No checksum entry for ${releaseTarget.archiveName}`,
    });
    expect(rawRequested).toEqual([]);
    expect(await readInstallManifest(layout.configDir)).toBeNull();
  });

  test("archive extraction fails closed when the raw artifact checksum mismatches", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("WRONG-EXTRACTED-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);

    const result = await installLatest({
      version: "3.0.1",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) {
          return new Response(sumsFor(releaseTarget.archiveName, sha256Hex(archive)));
        }
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, "0".repeat(64)));
        }
        if (url.endsWith(`/${releaseTarget.archiveName}`)) return new Response(archive);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: `Checksum mismatch for extracted ${releaseTarget.out}`,
    });
    expect(existsSync(versionBinaryPath(layout, "3.0.1"))).toBe(false);
    expect(await readInstallManifest(layout.configDir)).toBeNull();
  });

  test("archive checksum failure preserves the active launcher and manifest", async () => {
    const { layout } = await makeLayout();
    const previousPath = versionBinaryPath(layout, "1.0.0");
    await mkdir(dirname(previousPath), { recursive: true });
    await writeFile(previousPath, "OLD-BINARY");
    await seedLauncher(layout.launcherPath, previousPath);
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        versionedPath: previousPath,
        downloadBaseUrl: "https://example.test/releases",
        artifactSha256: sha256Hex("OLD-BINARY"),
      },
      layout.configDir,
    );
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("NEW-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);

    const result = await installLatest({
      version: "2.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) {
          return new Response(sumsFor(releaseTarget.archiveName, "0".repeat(64)));
        }
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, sha256Hex(bytes)));
        }
        if (url.endsWith(`/${releaseTarget.archiveName}`)) return new Response(archive);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: `Checksum mismatch for ${releaseTarget.archiveName}`,
    });
    await expectLauncherPointsTo(layout.launcherPath, previousPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("1.0.0");
  });

  test("checksum failure preserves launcher and manifest", async () => {
    const { layout } = await makeLayout();
    const previousPath = versionBinaryPath(layout, "1.0.0");
    await mkdir(dirname(previousPath), { recursive: true });
    await writeFile(previousPath, "OLD-BINARY");
    await seedLauncher(layout.launcherPath, previousPath);
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        versionedPath: previousPath,
        downloadBaseUrl: "https://example.test/releases",
        artifactSha256: sha256Hex("OLD-BINARY"),
      },
      layout.configDir,
    );

    const assetName = hostAssetName();
    const goodBytes = new TextEncoder().encode("NEW-BINARY");
    const badSums = sumsFor(assetName, "0".repeat(64));

    const result = await installLatest({
      version: "2.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
        if (url.includes("SHA256SUMS")) {
          return new Response(badSums, { status: 200 });
        }
        if (url.includes(assetName)) {
          return new Response(goodBytes, { status: 200 });
        }
        return new Response("missing", { status: 404 });
      },
    });

    expect(result.status).toBe("failed");
    await expectLauncherPointsTo(layout.launcherPath, previousPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("1.0.0");
  });

  test("successful install writes version metadata after checksum verification", async () => {
    const { layout } = await makeLayout();
    const assetName = hostAssetName();
    const bytes = new TextEncoder().encode("VERIFIED-BINARY");
    const digest = sha256Hex(bytes);

    const result = await installLatest({
      version: "3.1.4",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
        if (url.includes("SHA256SUMS")) {
          return new Response(sumsFor(assetName, digest), { status: 200 });
        }
        if (url.includes(assetName)) {
          return new Response(bytes, { status: 200 });
        }
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({ status: "installed", version: "3.1.4" });
    const versionPath = versionBinaryPath(layout, "3.1.4");
    expect(await Bun.file(versionPath).text()).toBe("VERIFIED-BINARY");
    await expectLauncherPointsTo(layout.launcherPath, versionPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("3.1.4");

    const metaRaw = await readFile(versionMetadataPath(layout, "3.1.4"), "utf8");
    const meta = JSON.parse(metaRaw) as { verification: string; artifactSha256: string };
    expect(meta.verification).toBe("release-checksum");
    expect(meta.artifactSha256).toBe(digest);
    expect(await verifyStoredVersion(layout, "3.1.4")).toMatchObject({ status: "verified" });
  });

  test("downloads and installs the version before waiting to activate shared state", async () => {
    const { layout } = await makeLayout();
    const held = await tryAcquireActivationLock(layout, "1.0.0");
    expect(held.acquired).toBe(true);

    const assetName = hostAssetName();
    const bytes = new TextEncoder().encode("WAITING-TO-ACTIVATE");
    const digest = sha256Hex(bytes);
    const install = installLatest({
      version: "2.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
        if (url.includes("SHA256SUMS")) {
          return new Response(sumsFor(assetName, digest), { status: 200 });
        }
        if (url.includes(assetName)) return new Response(bytes, { status: 200 });
        return new Response("missing", { status: 404 });
      },
    });

    const versionPath = versionBinaryPath(layout, "2.0.0");
    await waitForPath(versionMetadataPath(layout, "2.0.0"));
    expect(await Bun.file(versionPath).text()).toBe("WAITING-TO-ACTIVATE");
    expect(existsSync(layout.launcherPath)).toBe(false);
    expect(await readInstallManifest(layout.configDir)).toBeNull();

    if (held.acquired) await held.release();
    expect(await install).toMatchObject({ status: "installed", version: "2.0.0" });
    await expectLauncherPointsTo(layout.launcherPath, versionPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("2.0.0");
  });

  test("releases a reclaimed activation lock when manifest publication fails", async () => {
    const { layout } = await makeLayout();
    const path = activationLockPath(layout);
    await mkdir(layout.locksDir, { recursive: true });
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
        hostname: hostname().trim().toLowerCase(),
        processStartId: null,
      })}\n`,
    );
    await rm(layout.configDir, { recursive: true, force: true });
    await writeFile(layout.configDir, "not-a-directory");

    const assetName = hostAssetName();
    const bytes = new TextEncoder().encode("MANIFEST-WILL-FAIL");
    const digest = sha256Hex(bytes);
    const result = await installLatest({
      version: "4.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
        if (url.includes("SHA256SUMS")) {
          return new Response(sumsFor(assetName, digest), { status: 200 });
        }
        if (url.includes(assetName)) return new Response(bytes, { status: 200 });
        return new Response("missing", { status: 404 });
      },
    });

    expect(result.status).toBe("failed");
    expect(existsSync(path)).toBe(false);
  });

  const testPosix = process.platform === "win32" ? test.skip : test;
  testPosix(
    "restores the previous launcher when manifest commit fails after replacement",
    async () => {
      const { layout } = await makeLayout();
      const previousPath = versionBinaryPath(layout, "1.0.0");
      await mkdir(dirname(previousPath), { recursive: true });
      await writeFile(previousPath, "OLD-BINARY");
      await seedLauncher(layout.launcherPath, previousPath);
      await writeInstallManifest(
        {
          method: "binary",
          activeVersion: "1.0.0",
          launcherPath: layout.launcherPath,
          versionedPath: previousPath,
          downloadBaseUrl: "https://example.test/releases",
          artifactSha256: sha256Hex("OLD-BINARY"),
        },
        layout.configDir,
      );
      const beforeManifest = await readFile(join(layout.configDir, "install.json"), "utf8");
      await chmod(layout.configDir, 0o555);

      const assetName = hostAssetName();
      const bytes = new TextEncoder().encode("NEW-BINARY");
      const digest = sha256Hex(bytes);
      let result;
      try {
        result = await installLatest({
          version: "2.0.0",
          force: true,
          layout,
          dlBase: "https://example.test/releases",
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/SHA256SUMS.archives")) {
              return new Response("missing", { status: 404 });
            }
            if (url.includes("SHA256SUMS")) {
              return new Response(sumsFor(assetName, digest), { status: 200 });
            }
            if (url.includes(assetName)) return new Response(bytes, { status: 200 });
            return new Response("missing", { status: 404 });
          },
        });
      } finally {
        await chmod(layout.configDir, 0o755);
      }

      expect(result?.status).toBe("failed");
      await expectLauncherPointsTo(layout.launcherPath, previousPath);
      expect(await readFile(join(layout.configDir, "install.json"), "utf8")).toBe(beforeManifest);
      expect(existsSync(activationLockPath(layout))).toBe(false);
    },
  );

  testPosix(
    "restores a legacy flat launcher when manifest commit fails after replacement",
    async () => {
      const { layout } = await makeLayout();
      await writeFile(layout.launcherPath, "LEGACY-FLAT-BINARY", { mode: 0o755 });
      await writeInstallManifest(
        {
          method: "binary",
          activeVersion: "1.0.0",
          launcherPath: layout.launcherPath,
          downloadBaseUrl: "https://example.test/releases",
        },
        layout.configDir,
      );
      const beforeManifest = await readFile(join(layout.configDir, "install.json"), "utf8");
      await chmod(layout.configDir, 0o555);

      const assetName = hostAssetName();
      const bytes = new TextEncoder().encode("NEW-BINARY");
      const digest = sha256Hex(bytes);
      let result;
      try {
        result = await installLatest({
          version: "2.0.0",
          force: true,
          layout,
          dlBase: "https://example.test/releases",
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/SHA256SUMS.archives")) {
              return new Response("missing", { status: 404 });
            }
            if (url.includes("SHA256SUMS")) {
              return new Response(sumsFor(assetName, digest), { status: 200 });
            }
            if (url.includes(assetName)) return new Response(bytes, { status: 200 });
            return new Response("missing", { status: 404 });
          },
        });
      } finally {
        await chmod(layout.configDir, 0o755);
      }

      expect(result?.status).toBe("failed");
      expect(await readFile(layout.launcherPath, "utf8")).toBe("LEGACY-FLAT-BINARY");
      expect(await readFile(join(layout.configDir, "install.json"), "utf8")).toBe(beforeManifest);
      expect(existsSync(activationLockPath(layout))).toBe(false);
    },
  );
});
