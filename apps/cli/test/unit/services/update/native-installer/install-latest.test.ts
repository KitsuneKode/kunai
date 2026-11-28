import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  readInstallManifest,
  writeInstallManifest,
  writeInstallManifestUnderActivation,
} from "@/services/update/install-manifest";
import { tryAcquireActivationLock } from "@/services/update/native-installer/activation-lock";
import { cleanupOldVersions } from "@/services/update/native-installer/cleanup-versions";
import {
  drainInstallRetentionCleanups,
  installLatest,
} from "@/services/update/native-installer/install-latest";
import {
  activationLockPath,
  getInstallLayoutPaths,
  stagingDirForVersion,
  versionBinaryPath,
  versionMetadataPath,
} from "@/services/update/native-installer/install-layout";
import { isMuslEnvironmentSync } from "@/services/update/native-installer/musl";
import { executeRollback } from "@/services/update/native-installer/rollback";
import { verifyStoredVersion } from "@/services/update/native-installer/version-metadata";
import {
  releaseAssetName,
  resolveReleaseBinaryTarget,
  type ReleaseBinaryTarget,
} from "@/services/update/platform-assets";

import {
  createReleaseArchive,
  createZstdReleaseArchive,
} from "../../../../../scripts/build-release-archives";
import {
  releaseSigningKeys,
  SIGNED_STATEMENT_SCENARIOS,
  signStatement,
  statementFor,
} from "../../../../support/release-signing";
import { waitUntil } from "../../../../support/wait-until";

const made: string[] = [];

// Retention runs after installLatest returns and can recreate a lock directory
// inside a layout this hook already removed. Wait for it, then remove
// synchronously: `fs.promises.rm` has resolved while the directory was still there.
afterEach(async () => {
  await drainInstallRetentionCleanups();
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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
  await waitUntil(() => existsSync(path), { label: `path exists: ${path}` });
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

function releaseFixture(
  layout: Awaited<ReturnType<typeof makeLayout>>["layout"],
  version: string,
  intent: "explicit" | "install-latest" | "upgrade",
  content = `binary ${version}`,
) {
  const asset = hostAssetName();
  const checksum = sumsFor(asset, sha256Hex(content));
  return {
    layout,
    version,
    intent,
    force: true,
    dlBase: "https://example.test/releases",
    fetchImpl: async (input: string | URL | Request) => {
      const name = String(input).split("/").at(-1);
      if (name === "SHA256SUMS") return new Response(checksum);
      if (name === asset) return new Response(content);
      return new Response(null, { status: 404 });
    },
  };
}

describe("installLatest", () => {
  test.each(["upgrade", "install-latest"] as const)(
    "leaves the newer publication intact when an older %s finishes last",
    async (intent) => {
      const { layout } = await makeLayout();
      const manifestPath = join(layout.configDir, "install.json");
      expect(await installLatest(releaseFixture(layout, "2.0.0", "explicit"))).toMatchObject({
        status: "installed",
      });
      expect(await installLatest(releaseFixture(layout, "0.9.0", "explicit"))).toMatchObject({
        status: "installed",
      });

      const late = releaseFixture(layout, "1.0.0", intent);
      let newerManifest = "";
      const result = await installLatest({
        ...late,
        fetchImpl: async (input) => {
          if (String(input).endsWith("/SHA256SUMS")) {
            // Publish 2.0.0 through another activation path after the upgrade
            // read 0.9.0, while its download still owns only the 1.0.0 lock.
            expect(await executeRollback({ layout, to: "2.0.0" })).toMatchObject({
              status: "rolled-back",
              toVersion: "2.0.0",
            });
            newerManifest = await readFile(manifestPath, "utf8");
          }
          return late.fetchImpl(input);
        },
      });

      expect(result).toEqual({ status: "superseded", activeVersion: "2.0.0" });
      expect(await readFile(manifestPath, "utf8")).toBe(newerManifest);
      await expectLauncherPointsTo(layout.launcherPath, versionBinaryPath(layout, "2.0.0"));
      expect(existsSync(stagingDirForVersion(layout, "1.0.0"))).toBe(false);
      // Force retention to win the race deterministically. Once settled, its
      // abandoned-transaction pass prunes the now-empty directory; absent and
      // empty are the same settled fact — no transaction records remain.
      await drainInstallRetentionCleanups();
      await cleanupOldVersions(layout);
      const remainingTransactions = existsSync(layout.transactionsDir)
        ? await readdir(layout.transactionsDir)
        : [];
      expect(remainingTransactions).toEqual([]);
    },
  );

  test("leaves the active binary intact when a forced upgrade resolves the same version", async () => {
    const { layout } = await makeLayout();
    expect(await installLatest(releaseFixture(layout, "2.0.0", "explicit"))).toMatchObject({
      status: "installed",
    });
    const manifestPath = join(layout.configDir, "install.json");
    const manifest = await readFile(manifestPath, "utf8");

    expect(
      await installLatest(releaseFixture(layout, "2.0.0", "upgrade", "replacement binary")),
    ).toEqual({ status: "superseded", activeVersion: "2.0.0" });
    expect(await readFile(manifestPath, "utf8")).toBe(manifest);
    expect(await readFile(layout.launcherPath, "utf8")).toBe("binary 2.0.0");
    expect(await verifyStoredVersion(layout, "2.0.0")).toMatchObject({ status: "verified" });
  });

  test("an explicit install can activate an older requested version", async () => {
    const { layout } = await makeLayout();
    expect(await installLatest(releaseFixture(layout, "2.0.0", "explicit"))).toMatchObject({
      status: "installed",
    });

    expect(await installLatest(releaseFixture(layout, "1.0.0", "explicit"))).toMatchObject({
      status: "installed",
      version: "1.0.0",
    });
    await expectLauncherPointsTo(layout.launcherPath, versionBinaryPath(layout, "1.0.0"));
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      activeVersion: "1.0.0",
      previousVersion: "2.0.0",
    });
  });

  test("a forced install of latest can repair the active version", async () => {
    const { layout } = await makeLayout();
    expect(await installLatest(releaseFixture(layout, "2.0.0", "explicit"))).toMatchObject({
      status: "installed",
    });

    expect(
      await installLatest(releaseFixture(layout, "2.0.0", "install-latest", "repaired binary")),
    ).toMatchObject({ status: "installed", version: "2.0.0" });
    expect(await readFile(layout.launcherPath, "utf8")).toBe("repaired binary");
  });

  test("a profile install refuses a foreign manifest launcher before publishing", async () => {
    const { root, layout } = await makeLayout();
    expect(await installLatest(releaseFixture(layout, "2.0.0", "explicit"))).toMatchObject({
      status: "installed",
    });
    const manifestPath = join(layout.configDir, "install.json");
    const manifest = await readFile(manifestPath, "utf8");
    const versionPath = versionBinaryPath(layout, "2.0.0");
    const metadataPath = versionMetadataPath(layout, "2.0.0");
    const oldPayload = await readFile(versionPath);
    const oldMetadata = await readFile(metadataPath);

    // Same root as a profile, but a configured launcher the manifest never
    // named — publication must refuse before rewriting the payload it would
    // have claimed.
    const profileLayout = {
      ...layout,
      profileDir: root,
      launcherPath: join(root, "bin", "different-launcher"),
    };
    const result = await installLatest(
      releaseFixture(profileLayout, "2.0.0", "explicit", "distinct binary"),
    );
    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") {
      expect(result.error).toContain("disagrees with the profile's configured launcher");
    }
    expect(await readFile(versionPath)).toEqual(oldPayload);
    expect(await readFile(metadataPath)).toEqual(oldMetadata);
    expect(await readFile(manifestPath, "utf8")).toBe(manifest);
    await expectLauncherPointsTo(layout.launcherPath, versionPath);
  });

  test("a Windows profile refuses a payload too old to infer its profile", async () => {
    const { root, layout } = await makeLayout();
    const profileLayout = {
      ...layout,
      profileDir: root,
      binaryFileName: "kunai.exe",
    };
    const result = await installLatest({
      ...releaseFixture(profileLayout, "0.3.9", "explicit"),
      fetchImpl: async () => {
        throw new Error("fetch must never run for a gated version");
      },
    });
    expect(result).toEqual({
      status: "failed",
      error: "Windows profile installs require Kunai 0.4.0 or later.",
    });
    // Nothing was published or claimed: no version store entry, no manifest.
    expect(existsSync(versionBinaryPath(profileLayout, "0.3.9"))).toBe(false);
    expect(existsSync(join(profileLayout.configDir, "install.json"))).toBe(false);
  });

  test("rollback can restore the verified version replaced by an upgrade", async () => {
    const { layout } = await makeLayout();
    expect(await installLatest(releaseFixture(layout, "1.0.0", "explicit"))).toMatchObject({
      status: "installed",
    });
    expect(await installLatest(releaseFixture(layout, "2.0.0", "upgrade"))).toMatchObject({
      status: "installed",
    });

    expect(await executeRollback({ layout })).toMatchObject({
      status: "rolled-back",
      fromVersion: "2.0.0",
      toVersion: "1.0.0",
    });
    await expectLauncherPointsTo(layout.launcherPath, versionBinaryPath(layout, "1.0.0"));
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      activeVersion: "1.0.0",
      previousVersion: "2.0.0",
    });
  });

  test.each([
    ...SIGNED_STATEMENT_SCENARIOS,
    "tampered manifest",
    "missing",
    "unsigned archive",
    "archive v1 signature at v2 URL",
  ] as const)(
    "pinned updater checks version-bound signatures before activation: %s",
    async (scenario) => {
      const { layout } = await makeLayout();
      const { privateKey, spki } = releaseSigningKeys();
      const asset = hostAssetName();
      const archiveName = hostTarget().archiveName;
      const sums = sumsFor(asset, sha256Hex("binary"));
      const archiveSums = sumsFor(archiveName, sha256Hex("archive"));
      const signature = signStatement(
        privateKey,
        statementFor(scenario),
        "1.2.3",
        "SHA256SUMS",
        scenario === "tampered manifest" ? sums + " " : sums,
      );
      const archiveSignature = signStatement(
        privateKey,
        scenario === "archive v1 signature at v2 URL" ? "v1 signature at v2 URL" : "valid",
        "1.2.3",
        "SHA256SUMS.archives",
        archiveSums,
      );
      const requested: string[] = [];
      const result = await installLatest({
        intent: "explicit",
        layout,
        version: "1.2.3",
        releasePublicKey: spki,
        fetchImpl: async (input) => {
          const name = String(input).split("/").at(-1) ?? "";
          requested.push(name);
          if (name === "SHA256SUMS") return new Response(sums);
          if (name === "SHA256SUMS.sig" && scenario !== "missing") return new Response(signature);
          if (name === "SHA256SUMS.archives" && scenario.includes("archive"))
            return new Response(archiveSums);
          if (name === "SHA256SUMS.archives.sig" && scenario === "archive v1 signature at v2 URL")
            return new Response(archiveSignature);
          if (name === asset) return new Response("binary");
          return new Response(null, { status: 404 });
        },
      });
      const accepted = scenario === "valid";
      if (accepted !== (result.status === "installed")) throw new Error(JSON.stringify(result));
      expect(result.status).toBe(accepted ? "installed" : "failed");
      expect(existsSync(layout.launcherPath)).toBe(accepted);
      // A rejected release is never recorded, so the next check does not call it current.
      expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe(
        accepted ? "1.2.3" : undefined,
      );
      if (!accepted) {
        expect(requested).not.toContain(archiveName);
        expect(requested).not.toContain(asset);
      }
    },
  );

  test("pinned updater installs a release whose archive manifest is present and signed", async () => {
    // The path every published release takes: SHA256SUMS.archives and its .sig
    // both exist and verify, so the archive is fetched, its member checked
    // against the signed SHA256SUMS, and the raw asset never requested.
    const { layout } = await makeLayout();
    const { privateKey, spki } = releaseSigningKeys();
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("SIGNED-ARCHIVED-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);
    const sums = sumsFor(releaseTarget.out, sha256Hex(bytes));
    const archiveSums = sumsFor(releaseTarget.archiveName, sha256Hex(archive));
    const signatures = new Map([
      ["SHA256SUMS.sig", signStatement(privateKey, "valid", "1.2.3", "SHA256SUMS", sums)],
      [
        "SHA256SUMS.archives.sig",
        signStatement(privateKey, "valid", "1.2.3", "SHA256SUMS.archives", archiveSums),
      ],
    ]);
    const requested: string[] = [];
    const result = await installLatest({
      intent: "explicit",
      layout,
      version: "1.2.3",
      releasePublicKey: spki,
      fetchImpl: async (input) => {
        const name = String(input).split("/").at(-1) ?? "";
        requested.push(name);
        if (name === "SHA256SUMS") return new Response(sums);
        if (name === "SHA256SUMS.archives") return new Response(archiveSums);
        const signature = signatures.get(name);
        if (signature) return new Response(signature);
        if (name === releaseTarget.archiveName) return new Response(archive);
        return new Response(null, { status: 404 });
      },
    });

    if (result.status !== "installed") throw new Error(JSON.stringify(result));
    expect(requested).toContain("SHA256SUMS.sig");
    expect(requested).toContain("SHA256SUMS.archives.sig");
    expect(requested).toContain(releaseTarget.archiveName);
    expect(requested).not.toContain(releaseTarget.out);
    expect(await Bun.file(versionBinaryPath(layout, "1.2.3")).text()).toBe(
      "SIGNED-ARCHIVED-BINARY",
    );
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      activeVersion: "1.2.3",
      artifactName: releaseTarget.out,
      archiveName: releaseTarget.archiveName,
      archiveSha256: sha256Hex(archive),
    });
  });

  test.skipIf(!hostTarget().zstdArchiveName)(
    "takes the smaller .tar.zst when the signed archive manifest lists it",
    async () => {
      const { layout } = await makeLayout();
      const releaseTarget = hostTarget();
      const zstdName = releaseTarget.zstdArchiveName ?? "";
      const bytes = new TextEncoder().encode("ZSTD-ARCHIVED-BINARY");
      const gzip = createReleaseArchive(releaseTarget, bytes);
      const zstd = createZstdReleaseArchive(releaseTarget, bytes);
      const requested: string[] = [];

      const result = await installLatest({
        intent: "explicit",
        version: "3.3.0",
        force: true,
        layout,
        dlBase: "https://example.test/releases",
        fetchImpl: async (input) => {
          const name = String(input).split("/").at(-1) ?? "";
          requested.push(name);
          if (name === "SHA256SUMS.archives") {
            return new Response(
              sumsFor(releaseTarget.archiveName, sha256Hex(gzip)) +
                sumsFor(zstdName, sha256Hex(zstd)),
            );
          }
          if (name === "SHA256SUMS")
            return new Response(sumsFor(releaseTarget.out, sha256Hex(bytes)));
          if (name === zstdName) return new Response(zstd);
          if (name === releaseTarget.archiveName) return new Response(gzip);
          return new Response(null, { status: 404 });
        },
      });

      expect(result).toMatchObject({ status: "installed", version: "3.3.0" });
      expect(requested).toContain(zstdName);
      expect(requested).not.toContain(releaseTarget.archiveName);
      expect(requested).not.toContain(releaseTarget.out);
      expect(await Bun.file(versionBinaryPath(layout, "3.3.0")).text()).toBe(
        "ZSTD-ARCHIVED-BINARY",
      );
      expect(await readInstallManifest(layout.configDir)).toMatchObject({
        archiveName: zstdName,
        archiveSha256: sha256Hex(zstd),
        artifactSha256: sha256Hex(bytes),
      });
    },
  );

  test.skipIf(!hostTarget().zstdArchiveName)(
    "rejects a .tar.zst whose bytes do not match the signed archive manifest",
    async () => {
      const { layout } = await makeLayout();
      const releaseTarget = hostTarget();
      const zstdName = releaseTarget.zstdArchiveName ?? "";
      const bytes = new TextEncoder().encode("ZSTD-ARCHIVED-BINARY");
      const zstd = createZstdReleaseArchive(releaseTarget, bytes);
      const tampered = createZstdReleaseArchive(releaseTarget, new TextEncoder().encode("EVIL"));

      const result = await installLatest({
        intent: "explicit",
        version: "3.3.1",
        force: true,
        layout,
        dlBase: "https://example.test/releases",
        fetchImpl: async (input) => {
          const name = String(input).split("/").at(-1) ?? "";
          if (name === "SHA256SUMS.archives")
            return new Response(sumsFor(zstdName, sha256Hex(zstd)));
          if (name === "SHA256SUMS")
            return new Response(sumsFor(releaseTarget.out, sha256Hex(bytes)));
          if (name === zstdName) return new Response(tampered);
          return new Response(null, { status: 404 });
        },
      });

      expect(result).toMatchObject({ status: "failed" });
      expect(existsSync(versionBinaryPath(layout, "3.3.1"))).toBe(false);
    },
  );

  test("installs the verified archive member and records transport plus binary provenance", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("ARCHIVED-VERIFIED-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);
    const binaryDigest = sha256Hex(bytes);
    const archiveDigest = sha256Hex(archive);
    const requested: string[] = [];

    const result = await installLatest({
      intent: "explicit",
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
      intent: "explicit",
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

  test.each([404, 410] as const)(
    "%i archive response falls back to the verified raw asset",
    async (status) => {
      const { layout } = await makeLayout();
      const releaseTarget = hostTarget();
      const bytes = new TextEncoder().encode(`LEGACY-RAW-BINARY-${status}`);
      const digest = sha256Hex(bytes);
      const requested: string[] = [];

      const result = await installLatest({
        intent: "explicit",
        version: "2.9.1",
        force: true,
        layout,
        dlBase: "https://example.test/releases",
        fetchImpl: async (input) => {
          const url = String(input);
          requested.push(url);
          if (url.endsWith("/SHA256SUMS.archives")) {
            return new Response(sumsFor(releaseTarget.archiveName, "a".repeat(64)));
          }
          if (url.endsWith("/SHA256SUMS")) {
            return new Response(sumsFor(releaseTarget.out, digest));
          }
          if (url.endsWith(`/${releaseTarget.archiveName}`)) {
            return new Response("missing", { status });
          }
          if (url.endsWith(`/${releaseTarget.out}`)) return new Response(bytes);
          return new Response("missing", { status: 404 });
        },
      });

      expect(result).toMatchObject({ status: "installed", version: "2.9.1" });
      expect(requested.some((url) => url.endsWith(`/${releaseTarget.archiveName}`))).toBe(true);
      expect(requested.some((url) => url.endsWith(`/${releaseTarget.out}`))).toBe(true);
      expect(await Bun.file(versionBinaryPath(layout, "2.9.1")).text()).toBe(
        `LEGACY-RAW-BINARY-${status}`,
      );
      expect((await readInstallManifest(layout.configDir))?.archiveName).toBeUndefined();
    },
  );

  test("archive server failure never falls back or disturbs the active install", async () => {
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
      layout,
    );
    const releaseTarget = hostTarget();
    const rawRequested: string[] = [];

    const result = await installLatest({
      intent: "explicit",
      version: "2.9.2",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) {
          return new Response(sumsFor(releaseTarget.archiveName, "a".repeat(64)));
        }
        if (url.endsWith("/SHA256SUMS")) {
          return new Response(sumsFor(releaseTarget.out, "b".repeat(64)));
        }
        if (url.endsWith(`/${releaseTarget.archiveName}`)) {
          return new Response("unavailable", { status: 500 });
        }
        if (url.endsWith(`/${releaseTarget.out}`)) rawRequested.push(url);
        return new Response("missing", { status: 404 });
      },
    });

    expect(result).toMatchObject({ status: "failed", error: "Download failed with HTTP 500" });
    expect(rawRequested).toEqual([]);
    await expectLauncherPointsTo(layout.launcherPath, previousPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("1.0.0");
    expect(existsSync(stagingDirForVersion(layout, "2.9.2"))).toBe(false);
  });

  test("present malformed archive manifest fails closed without raw fallback", async () => {
    const { layout } = await makeLayout();
    const releaseTarget = hostTarget();
    const rawRequested: string[] = [];

    const result = await installLatest({
      intent: "explicit",
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
      intent: "explicit",
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
      layout,
    );
    const releaseTarget = hostTarget();
    const bytes = new TextEncoder().encode("NEW-BINARY");
    const archive = createReleaseArchive(releaseTarget, bytes);

    const result = await installLatest({
      intent: "explicit",
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
      layout,
    );

    const assetName = hostAssetName();
    const goodBytes = new TextEncoder().encode("NEW-BINARY");
    const badSums = sumsFor(assetName, "0".repeat(64));

    const result = await installLatest({
      intent: "explicit",
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
      intent: "explicit",
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

  describe("update.marker", () => {
    async function installWithMarker(
      options: {
        readonly releaseMarker?: "update.marker";
        readonly markerEnv?: Record<string, string>;
      },
      onMarker: () => Promise<Response>,
    ) {
      const { layout } = await makeLayout();
      const assetName = hostAssetName();
      const bytes = new TextEncoder().encode("VERIFIED-BINARY");
      const markers: string[] = [];
      const result = await installLatest({
        intent: "upgrade",
        version: "3.1.4",
        force: true,
        layout,
        dlBase: "https://example.test/releases",
        ...options,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith(".marker")) {
            markers.push(url);
            return onMarker();
          }
          if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
          if (url.includes("SHA256SUMS")) return new Response(sumsFor(assetName, sha256Hex(bytes)));
          if (url.includes(assetName)) return new Response(bytes);
          return new Response("missing", { status: 404 });
        },
      });
      return { result, markers };
    }

    test("is requested after a verified activation and never awaited by the update", async () => {
      // The marker request never answers. If the update awaited it, this
      // install would never resolve.
      const { result, markers } = await installWithMarker(
        { releaseMarker: "update.marker", markerEnv: {} },
        () => new Promise<Response>(() => {}),
      );
      expect(result.status).toBe("installed");
      expect(markers).toEqual(["https://example.test/releases/download/v3.1.4/update.marker"]);
      expect(result.status === "installed" && result.releaseMarker).toBeInstanceOf(Promise);
    });

    test("a failing marker never fails the update", async () => {
      const { result } = await installWithMarker(
        { releaseMarker: "update.marker", markerEnv: {} },
        async () => {
          throw new Error("offline");
        },
      );
      expect(result.status).toBe("installed");
      if (result.status === "installed")
        await expect(result.releaseMarker).resolves.toBeUndefined();
    });

    test.each([[{ DO_NOT_TRACK: "1" }], [{ CI: "true" }], [{ KUNAI_NO_MARKER: "1" }]])(
      "is skipped under %j",
      async (markerEnv) => {
        const { result, markers } = await installWithMarker(
          { releaseMarker: "update.marker", markerEnv },
          async () => new Response("ok"),
        );
        expect(result.status).toBe("installed");
        expect(markers).toEqual([]);
      },
    );

    test("is not requested by a plain install", async () => {
      const { markers } = await installWithMarker(
        { markerEnv: {} },
        async () => new Response("ok"),
      );
      expect(markers).toEqual([]);
    });
  });

  test("downloads and installs the version before waiting to activate shared state", async () => {
    const { layout } = await makeLayout();
    const held = await tryAcquireActivationLock(layout, "1.0.0");
    expect(held.acquired).toBe(true);

    const assetName = hostAssetName();
    const bytes = new TextEncoder().encode("WAITING-TO-ACTIVATE");
    const digest = sha256Hex(bytes);
    const install = installLatest({
      intent: "explicit",
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

  test("does not replace package ownership published while the native binary downloads", async () => {
    const { layout } = await makeLayout();
    const held = await tryAcquireActivationLock(layout, "1.0.0");
    expect(held.acquired).toBe(true);

    const assetName = hostAssetName();
    const bytes = new TextEncoder().encode("DOWNLOADED-BUT-NOT-ACTIVATED");
    const digest = sha256Hex(bytes);
    const install = installLatest({
      intent: "explicit",
      version: "2.0.0",
      force: true,
      layout,
      dlBase: "https://example.test/releases",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/SHA256SUMS.archives")) return new Response("missing", { status: 404 });
        if (url.includes("SHA256SUMS")) return new Response(sumsFor(assetName, digest));
        if (url.includes(assetName)) return new Response(bytes);
        return new Response("missing", { status: 404 });
      },
    });

    await waitForPath(versionMetadataPath(layout, "2.0.0"));
    await writeInstallManifestUnderActivation(
      {
        method: "npm-global",
        activeVersion: "9.9.9",
        launcherPath: layout.launcherPath,
        downloadBaseUrl: "https://registry.npmjs.org",
      },
      layout,
    );
    if (held.acquired) await held.release();

    expect(await install).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Install ownership changed"),
    });
    expect(await readInstallManifest(layout.configDir)).toMatchObject({
      method: "npm-global",
      activeVersion: "9.9.9",
    });
    expect(existsSync(layout.launcherPath)).toBe(false);
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
      intent: "explicit",
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
        layout,
      );
      const beforeManifest = await readFile(join(layout.configDir, "install.json"), "utf8");
      await chmod(layout.configDir, 0o555);

      const assetName = hostAssetName();
      const bytes = new TextEncoder().encode("NEW-BINARY");
      const digest = sha256Hex(bytes);
      let result;
      try {
        result = await installLatest({
          intent: "explicit",
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
        layout,
      );
      const beforeManifest = await readFile(join(layout.configDir, "install.json"), "utf8");
      await chmod(layout.configDir, 0o555);

      const assetName = hostAssetName();
      const bytes = new TextEncoder().encode("NEW-BINARY");
      const digest = sha256Hex(bytes);
      let result;
      try {
        result = await installLatest({
          intent: "explicit",
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
