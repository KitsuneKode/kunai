import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getInstallLayoutPaths,
  versionBinaryPath,
  versionMetadataPath,
} from "@/services/update/native-installer/install-layout";
import {
  type InstalledVersionMetadata,
  verifyStoredVersion,
  writeInstalledVersionMetadata,
} from "@/services/update/native-installer/version-metadata";

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-meta-"));
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.versionsDir, { recursive: true });
  return { root, layout };
}

function baseMetadata(overrides: Partial<InstalledVersionMetadata> = {}): InstalledVersionMetadata {
  return {
    schemaVersion: 1,
    version: "1.2.3",
    target: "linux-x64-gnu",
    artifactName: "kunai-linux-x64-gnu",
    artifactSha256: "a".repeat(64),
    sizeBytes: 4,
    sourceUrl: "https://example.test/v1.2.3/kunai-linux-x64-gnu",
    verification: "release-checksum",
    installedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

async function seedBinary(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  version: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = versionBinaryPath(layout, version);
  await mkdir(join(layout.versionsDir, version), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

describe("version metadata", () => {
  test("legacy self-attestation is not rollback-verified", async () => {
    const { root, layout } = await makeLayout();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha = createHash("sha256").update(bytes).digest("hex");
    await seedBinary(layout, "1.2.3", bytes);
    await writeInstalledVersionMetadata(
      layout,
      baseMetadata({
        verification: "legacy-unverified",
        artifactSha256: sha,
        sizeBytes: bytes.byteLength,
      }),
    );

    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "untrusted-metadata",
    });

    await rm(root, { recursive: true, force: true });
  });

  test("release-checksum metadata verifies matching binary", async () => {
    const { root, layout } = await makeLayout();
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const sha = createHash("sha256").update(bytes).digest("hex");
    await seedBinary(layout, "1.2.3", bytes);
    const metadata = baseMetadata({
      artifactSha256: sha,
      sizeBytes: bytes.byteLength,
      verification: "release-checksum",
    });
    await writeInstalledVersionMetadata(layout, metadata);

    expect(await verifyStoredVersion(layout, "1.2.3")).toEqual({
      status: "verified",
      metadata,
    });
    expect(versionMetadataPath(layout, "1.2.3")).toBe(
      join(layout.versionsDir, "1.2.3", "version.json"),
    );

    await rm(root, { recursive: true, force: true });
  });

  test("reports missing binary and metadata distinctly", async () => {
    const { root, layout } = await makeLayout();

    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "missing-binary",
    });

    await seedBinary(layout, "1.2.3", new Uint8Array([1]));
    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "missing-metadata",
    });

    await rm(root, { recursive: true, force: true });
  });

  test("rejects invalid metadata, size mismatch, and checksum mismatch", async () => {
    const { root, layout } = await makeLayout();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await seedBinary(layout, "1.2.3", bytes);

    await writeFile(versionMetadataPath(layout, "1.2.3"), "{not-json");
    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "invalid-metadata",
    });

    await writeInstalledVersionMetadata(
      layout,
      baseMetadata({
        artifactSha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: 99,
      }),
    );
    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "size-mismatch",
    });

    await writeInstalledVersionMetadata(
      layout,
      baseMetadata({
        artifactSha256: "b".repeat(64),
        sizeBytes: bytes.byteLength,
      }),
    );
    expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
      status: "checksum-mismatch",
    });

    await rm(root, { recursive: true, force: true });
  });
});
