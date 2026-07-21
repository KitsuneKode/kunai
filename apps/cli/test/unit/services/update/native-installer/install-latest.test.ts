import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";
import { installLatest } from "@/services/update/native-installer/install-latest";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
  versionMetadataPath,
} from "@/services/update/native-installer/install-layout";
import { isMuslEnvironmentSync } from "@/services/update/native-installer/musl";
import { verifyStoredVersion } from "@/services/update/native-installer/version-metadata";
import { releaseAssetName } from "@/services/update/platform-assets";

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
    launcherPath: join(root, "bin", "kunai"),
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

function sumsFor(assetName: string, digest: string): string {
  return `${digest}  ${assetName}\n`;
}

describe("installLatest", () => {
  test("checksum failure preserves launcher and manifest", async () => {
    const { layout } = await makeLayout();
    const previousPath = versionBinaryPath(layout, "1.0.0");
    await mkdir(dirname(previousPath), { recursive: true });
    await writeFile(previousPath, "OLD-BINARY");
    await symlink(previousPath, layout.launcherPath);
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
    expect(await readlink(layout.launcherPath)).toBe(previousPath);
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
    expect(await readlink(layout.launcherPath)).toBe(versionPath);
    expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("3.1.4");

    const metaRaw = await readFile(versionMetadataPath(layout, "3.1.4"), "utf8");
    const meta = JSON.parse(metaRaw) as { verification: string; artifactSha256: string };
    expect(meta.verification).toBe("release-checksum");
    expect(meta.artifactSha256).toBe(digest);
    expect(await verifyStoredVersion(layout, "3.1.4")).toMatchObject({ status: "verified" });
  });
});
