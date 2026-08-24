import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  inspectInstallManifest,
  migrateInstallManifest,
  migrateInstallManifestAtStartup,
  readInstallManifest,
  writeInstallManifest,
} from "@/services/update/install-manifest";
import { tryAcquireActivationLock } from "@/services/update/native-installer/activation-lock";
import {
  getInstallLayoutPaths,
  lockFilePath,
} from "@/services/update/native-installer/install-layout";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  return dir;
}

function migrationLayout(configDir: string) {
  const root = join(configDir, "native");
  return getInstallLayoutPaths({
    configDir,
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(5);
  }
}

const LEGACY_VERSIONED = {
  channel: "binary",
  version: "1.2.3",
  binPath: "/home/u/.local/bin/kunai",
  versionPath: "/data/kunai/versions/1.2.3/kunai",
  dlBase: "https://github.com/KitsuneKode/kunai/releases",
  installedAt: "2026-01-01T00:00:00.000Z",
  layout: "versioned",
} as const;

const LEGACY_FLAT = {
  channel: "binary",
  version: "1.0.0",
  binPath: "/home/u/.local/bin/kunai",
  dlBase: "https://github.com/KitsuneKode/kunai/releases",
  installedAt: "2026-02-01T00:00:00.000Z",
  layout: "flat",
} as const;

// Exact archive-bearing schema-2 shape emitted by 69b81763. That release did
// not yet persist artifactSourceUrl, so this fixture is a compatibility
// boundary rather than a hand-written approximation of the current schema.
const PREDECESSOR_SCHEMA_2_ARCHIVE = {
  schemaVersion: 2,
  method: "binary",
  activeVersion: "1.2.3",
  preferredChannel: "stable",
  launcherPath: "/x/kunai",
  versionedPath: "/data/versions/1.2.3/kunai",
  managedPaths: [],
  target: "linux-x64",
  artifactName: "kunai-linux-x64",
  artifactSha256: "a".repeat(64),
  artifactSizeBytes: 42,
  archiveName: "kunai-linux-x64.tar.gz",
  archiveSha256: "b".repeat(64),
  archiveSizeBytes: 21,
  archiveSourceUrl:
    "https://github.com/KitsuneKode/kunai/releases/download/v1.2.3/kunai-linux-x64.tar.gz",
  downloadBaseUrl: "https://github.com/KitsuneKode/kunai/releases",
  installedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
} as const;

test("write then read round-trips the versioned manifest", async () => {
  const dir = tempDir();
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: "1.2.3",
      launcherPath: "/x/kunai",
      versionedPath: "/data/versions/1.2.3/kunai",
      downloadBaseUrl: "https://dl",
      artifactName: "kunai-linux-x64",
      artifactSha256: "a".repeat(64),
      artifactSizeBytes: 42,
      artifactSourceUrl: "https://dl/download/v1.2.3/kunai-linux-x64",
      archiveName: "kunai-linux-x64.tar.gz",
      archiveSha256: "b".repeat(64),
      archiveSizeBytes: 21,
      archiveSourceUrl: "https://dl/download/v1.2.3/kunai-linux-x64.tar.gz",
    },
    migrationLayout(dir),
  );
  const m = await readInstallManifest(dir);
  expect(m?.schemaVersion).toBe(INSTALL_MANIFEST_SCHEMA_VERSION);
  expect(m?.method).toBe("binary");
  expect(m?.activeVersion).toBe("1.2.3");
  expect(m?.launcherPath).toBe("/x/kunai");
  expect(m?.versionedPath).toBe("/data/versions/1.2.3/kunai");
  expect(m?.downloadBaseUrl).toBe("https://dl");
  expect(m?.artifactName).toBe("kunai-linux-x64");
  expect(m?.artifactSha256).toBe("a".repeat(64));
  expect(m?.artifactSizeBytes).toBe(42);
  expect(m?.artifactSourceUrl).toBe("https://dl/download/v1.2.3/kunai-linux-x64");
  expect(m?.archiveName).toBe("kunai-linux-x64.tar.gz");
  expect(m?.archiveSha256).toBe("b".repeat(64));
  expect(m?.archiveSizeBytes).toBe(21);
  expect(m?.archiveSourceUrl).toBe("https://dl/download/v1.2.3/kunai-linux-x64.tar.gz");
  expect(m?.preferredChannel).toBe("stable");
  expect(m?.managedPaths.length).toBeGreaterThan(0);
  expect(typeof m?.installedAt).toBe("string");
  expect(typeof m?.updatedAt).toBe("string");
});

test("reads and safely backfills the exact predecessor schema-2 archive shape", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(path, `${JSON.stringify(PREDECESSOR_SCHEMA_2_ARCHIVE, null, 2)}\n`);

  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "loaded",
    needsMigration: true,
    manifest: {
      schemaVersion: 2,
      artifactSourceUrl:
        "https://github.com/KitsuneKode/kunai/releases/download/v1.2.3/kunai-linux-x64",
    },
  });
  expect(JSON.parse(await Bun.file(path).text())).toEqual(PREDECESSOR_SCHEMA_2_ARCHIVE);

  expect(await migrateInstallManifest(migrationLayout(dir))).toMatchObject({
    status: "migrated",
    manifest: {
      artifactSourceUrl:
        "https://github.com/KitsuneKode/kunai/releases/download/v1.2.3/kunai-linux-x64",
    },
  });
  expect(JSON.parse(await Bun.file(path).text())).toMatchObject({
    schemaVersion: 2,
    artifactSourceUrl:
      "https://github.com/KitsuneKode/kunai/releases/download/v1.2.3/kunai-linux-x64",
  });
});

test("explicit migration upgrades schema v1 without losing rollback fields", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(
    path,
    JSON.stringify({
      schemaVersion: 1,
      method: "binary",
      activeVersion: "1.2.3",
      previousVersion: "1.2.2",
      preferredChannel: "stable",
      launcherPath: "/x/kunai",
      versionedPath: "/data/versions/1.2.3/kunai",
      managedPaths: [],
      target: "linux-x64",
      artifactSha256: "c".repeat(64),
      downloadBaseUrl: "https://dl",
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  );

  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "loaded",
    needsMigration: true,
    manifest: {
      schemaVersion: 2,
      activeVersion: "1.2.3",
      previousVersion: "1.2.2",
      artifactSha256: "c".repeat(64),
    },
  });
  expect(await readInstallManifest(dir)).toMatchObject({
    schemaVersion: 2,
    activeVersion: "1.2.3",
    previousVersion: "1.2.2",
  });
  expect(JSON.parse(await Bun.file(path).text())).toMatchObject({ schemaVersion: 1 });

  expect(await migrateInstallManifest(migrationLayout(dir))).toMatchObject({
    status: "migrated",
    manifest: {
      schemaVersion: 2,
      activeVersion: "1.2.3",
      previousVersion: "1.2.2",
    },
  });
  expect(JSON.parse(await Bun.file(path).text())).toMatchObject({ schemaVersion: 2 });
});

test("schema v2 rejects partial archive provenance", async () => {
  const dir = tempDir();
  await Bun.write(
    join(dir, "install.json"),
    JSON.stringify({
      schemaVersion: 2,
      method: "binary",
      activeVersion: "1.2.3",
      preferredChannel: "stable",
      launcherPath: "/x/kunai",
      managedPaths: [],
      downloadBaseUrl: "https://dl",
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      archiveName: "kunai-linux-x64.tar.gz",
    }),
  );

  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "invalid-shape",
  });
});

test("write rejects partial archive provenance", async () => {
  const dir = tempDir();
  await expect(
    writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: "/x/kunai",
        downloadBaseUrl: "https://dl",
        archiveName: "kunai-linux-x64.tar.gz",
      },
      migrationLayout(dir),
    ),
  ).rejects.toThrow(/archive provenance/i);
});

test("write rejects empty archive provenance strings", async () => {
  const dir = tempDir();
  await expect(
    writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: "/x/kunai",
        downloadBaseUrl: "https://dl",
        archiveName: "",
        archiveSha256: "d".repeat(64),
        archiveSizeBytes: 10,
        archiveSourceUrl: "https://dl/archive",
      },
      migrationLayout(dir),
    ),
  ).rejects.toThrow(/provenance/i);
});

test("write requires extracted-binary provenance when archive provenance is present", async () => {
  const dir = tempDir();
  await expect(
    writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.2.3",
        launcherPath: "/x/kunai",
        downloadBaseUrl: "https://dl",
        archiveName: "kunai-linux-x64.tar.gz",
        archiveSha256: "d".repeat(64),
        archiveSizeBytes: 10,
        archiveSourceUrl: "https://dl/archive",
      },
      migrationLayout(dir),
    ),
  ).rejects.toThrow(/extracted binary provenance/i);
});

test("read returns null when manifest is absent", async () => {
  const dir = tempDir();
  expect(await readInstallManifest(dir)).toBeNull();
  expect(await inspectInstallManifest(dir)).toEqual({ status: "missing" });
});

test("inspection reports migration without writing", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(path, JSON.stringify(LEGACY_VERSIONED));
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "loaded",
    needsMigration: true,
  });
  expect(await Bun.file(path).text()).toBe(before);
});

test("explicit migration upgrades legacy versioned binary atomically", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(path, `${JSON.stringify(LEGACY_VERSIONED, null, 2)}\n`);
  const migrated = await migrateInstallManifest(migrationLayout(dir));
  expect(migrated.status).toBe("migrated");
  const m = await readInstallManifest(dir);
  expect(m).toMatchObject({
    schemaVersion: 2,
    method: "binary",
    activeVersion: "1.2.3",
    launcherPath: "/home/u/.local/bin/kunai",
    versionedPath: "/data/kunai/versions/1.2.3/kunai",
    downloadBaseUrl: "https://github.com/KitsuneKode/kunai/releases",
    preferredChannel: "stable",
    installedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(m?.managedPaths.length).toBeGreaterThan(0);
  expect(m?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");

  const onDisk = JSON.parse(await Bun.file(path).text()) as typeof m;
  expect(onDisk).toMatchObject({
    schemaVersion: 2,
    method: "binary",
    activeVersion: "1.2.3",
    installedAt: "2026-01-01T00:00:00.000Z",
  });
  // Second read is idempotent (no further migration).
  const again = await inspectInstallManifest(dir);
  expect(again).toMatchObject({ status: "loaded", needsMigration: false });
});

test("explicit migration upgrades legacy flat binary without versionedPath", async () => {
  const dir = tempDir();
  await Bun.write(join(dir, "install.json"), JSON.stringify(LEGACY_FLAT));
  expect((await migrateInstallManifest(migrationLayout(dir))).status).toBe("migrated");
  const m = await readInstallManifest(dir);
  expect(m).toMatchObject({
    schemaVersion: 2,
    method: "binary",
    activeVersion: "1.0.0",
    launcherPath: "/home/u/.local/bin/kunai",
    installedAt: "2026-02-01T00:00:00.000Z",
  });
  expect(m?.versionedPath).toBeUndefined();
  expect(m?.managedPaths.length).toBeGreaterThan(0);
});

test.each([
  ["npm-global", "2.0.0"],
  ["bun-global", "2.1.0"],
  ["source", "0.3.0"],
] as const)(
  "legacy %s is converted in memory without unsafe native-lock publication",
  async (channel, version) => {
    const dir = tempDir();
    const path = join(dir, "install.json");
    const legacy = JSON.stringify({
      channel,
      version,
      binPath: "/usr/bin/kunai",
      dlBase: "https://dl.example/releases",
      installedAt: "2026-03-01T00:00:00.000Z",
    });
    await Bun.write(path, legacy);
    expect((await migrateInstallManifest(migrationLayout(dir))).status).toBe("deferred");
    const m = await readInstallManifest(dir);
    expect(m).toMatchObject({
      schemaVersion: 2,
      method: channel,
      activeVersion: version,
      launcherPath: "/usr/bin/kunai",
      managedPaths: [],
      installedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(await Bun.file(path).text()).toBe(legacy);
  },
);

test("migration does not overwrite a newer activation published while it waits", async () => {
  const dir = tempDir();
  const layout = migrationLayout(dir);
  const path = join(dir, "install.json");
  await Bun.write(path, JSON.stringify(LEGACY_VERSIONED));

  const activation = await tryAcquireActivationLock(layout, "9.9.9");
  expect(activation.acquired).toBe(true);
  const migration = migrateInstallManifest(layout);
  await waitForPath(lockFilePath(layout, "1.2.3"));

  const replacement = {
    schemaVersion: 2,
    method: "binary",
    activeVersion: "9.9.9",
    preferredChannel: "stable",
    launcherPath: layout.launcherPath,
    versionedPath: join(layout.versionsDir, "9.9.9", "kunai"),
    managedPaths: [],
    downloadBaseUrl: "https://new.example.test/releases",
    installedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  };
  await Bun.write(path, `${JSON.stringify(replacement)}\n`);
  if (activation.acquired) await activation.release();

  expect(await migration).toMatchObject({
    status: "unchanged",
    manifest: { activeVersion: "9.9.9" },
  });
  expect(JSON.parse(await Bun.file(path).text())).toEqual(replacement);
});

test("migration does not recreate a manifest removed while it waits", async () => {
  const dir = tempDir();
  const layout = migrationLayout(dir);
  const path = join(dir, "install.json");
  await Bun.write(path, JSON.stringify(LEGACY_VERSIONED));

  const activation = await tryAcquireActivationLock(layout, "9.9.9");
  expect(activation.acquired).toBe(true);
  const migration = migrateInstallManifest(layout);
  await waitForPath(lockFilePath(layout, "1.2.3"));
  await Bun.file(path).delete();
  if (activation.acquired) await activation.release();

  expect(await migration).toEqual({ status: "missing" });
  expect(existsSync(path)).toBe(false);
});

test("package publication serializes with migration and wins without stale overwrite", async () => {
  const dir = tempDir();
  const layout = migrationLayout(dir);
  const path = join(dir, "install.json");
  await Bun.write(path, JSON.stringify(LEGACY_VERSIONED));

  const activation = await tryAcquireActivationLock(layout, "9.9.9");
  expect(activation.acquired).toBe(true);

  let packagePublished = false;
  const migration = migrateInstallManifest(layout);
  const packageWrite = writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "9.9.9",
      launcherPath: "/npm/bin/kunai",
      downloadBaseUrl: "https://new.example.test/releases",
    },
    layout,
  ).then(() => {
    packagePublished = true;
    return true;
  });
  await waitForPath(lockFilePath(layout, "1.2.3"));
  await Bun.sleep(25);
  expect(packagePublished).toBe(false);

  if (activation.acquired) await activation.release();
  await Promise.all([migration, packageWrite]);

  expect(await readInstallManifest(dir)).toMatchObject({
    schemaVersion: 2,
    method: "npm-global",
    activeVersion: "9.9.9",
    launcherPath: "/npm/bin/kunai",
  });
});

test("startup migration diagnoses invalid state and errors but keeps contention quiet", async () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  await migrateInstallManifestAtStartup({
    migrate: async () => ({ status: "invalid", reason: "invalid-shape" }),
    warn,
  });
  await migrateInstallManifestAtStartup({
    migrate: async () => ({ status: "lock-contention" }),
    warn,
  });
  await migrateInstallManifestAtStartup({
    migrate: async () => {
      throw new Error("disk unavailable");
    },
    warn,
  });

  expect(warnings).toEqual([
    "Kunai install manifest migration skipped invalid install.json (invalid-shape).",
    "Kunai install manifest migration failed: disk unavailable",
  ]);
});

test("inspect reports invalid JSON without writing", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(path, "{ not valid json");
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "invalid-json",
  });
  expect(await readInstallManifest(dir)).toBeNull();
  expect(await Bun.file(path).text()).toBe(before);
});

test("inspect rejects future schema without writing", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  const future = {
    schemaVersion: 99,
    method: "binary",
    activeVersion: "1.0.0",
    preferredChannel: "stable",
    launcherPath: "/x/kunai",
    managedPaths: [],
    downloadBaseUrl: "https://dl",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await Bun.write(path, JSON.stringify(future));
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "unsupported-schema",
  });
  expect(await readInstallManifest(dir)).toBeNull();
  expect(await Bun.file(path).text()).toBe(before);
});

test("inspect rejects missing timestamp on legacy", async () => {
  const dir = tempDir();
  await Bun.write(
    join(dir, "install.json"),
    JSON.stringify({
      channel: "binary",
      version: "1.2.3",
      binPath: "/x/kunai",
      dlBase: "https://dl",
    }),
  );
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "missing-timestamp",
  });
  expect(await readInstallManifest(dir)).toBeNull();
});

test("inspect rejects invalid version", async () => {
  const dir = tempDir();
  await Bun.write(
    join(dir, "install.json"),
    JSON.stringify({
      channel: "binary",
      version: "1.2.3-beta",
      binPath: "/x/kunai",
      dlBase: "https://dl",
      installedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "invalid-version",
  });
  expect(await readInstallManifest(dir)).toBeNull();
});

test("inspect rejects malicious managed paths on schema v1", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  const layout = getInstallLayoutPaths({ configDir: dir, launcherPath: "/x/kunai" });
  const malicious = {
    schemaVersion: 1,
    method: "binary",
    activeVersion: "1.0.0",
    preferredChannel: "stable",
    launcherPath: "/x/kunai",
    managedPaths: ["/etc/passwd", join(layout.dataDir, "..", "..", "escape")],
    downloadBaseUrl: "https://dl",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await Bun.write(path, JSON.stringify(malicious));
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "malicious-managed-paths",
  });
  expect(await readInstallManifest(dir)).toBeNull();
  expect(await Bun.file(path).text()).toBe(before);
});

test("inspect rejects invalid previousVersion", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  const bad = {
    schemaVersion: 1,
    method: "binary",
    activeVersion: "1.0.1",
    previousVersion: "1.0.0-beta",
    preferredChannel: "stable",
    launcherPath: "/x/kunai",
    managedPaths: [],
    downloadBaseUrl: "https://dl",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await Bun.write(path, JSON.stringify(bad));
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "invalid",
    reason: "invalid-version",
  });
  expect(await readInstallManifest(dir)).toBeNull();
  expect(await Bun.file(path).text()).toBe(before);
});

test("write rejects non-canonical previousVersion", async () => {
  const dir = tempDir();
  await expect(
    writeInstallManifest(
      {
        method: "binary",
        activeVersion: "1.0.1",
        previousVersion: "v1.0.0",
        launcherPath: "/x/kunai",
        downloadBaseUrl: "https://dl",
      },
      migrationLayout(dir),
    ),
  ).rejects.toThrow(/previousVersion/);
});

test("write accepts canonical previousVersion", async () => {
  const dir = tempDir();
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: "1.0.1",
      previousVersion: "1.0.0",
      launcherPath: "/x/kunai",
      versionedPath: "/data/versions/1.0.1/kunai",
      downloadBaseUrl: "https://dl",
    },
    migrationLayout(dir),
  );
  const m = await readInstallManifest(dir);
  expect(m?.previousVersion).toBe("1.0.0");
});

test("write preserves installedAt and refreshes updatedAt", async () => {
  const dir = tempDir();
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.0",
      launcherPath: "/usr/bin/kunai",
      downloadBaseUrl: "https://dl",
    },
    migrationLayout(dir),
  );
  const first = await readInstallManifest(dir);
  expect(first?.managedPaths).toEqual([]);
  await Bun.sleep(5);
  await writeInstallManifest(
    {
      method: "npm-global",
      activeVersion: "1.0.1",
      launcherPath: "/usr/bin/kunai",
      downloadBaseUrl: "https://dl",
    },
    migrationLayout(dir),
  );
  const second = await readInstallManifest(dir);
  expect(second?.installedAt).toBe(first?.installedAt);
  expect(second?.activeVersion).toBe("1.0.1");
  expect(second?.updatedAt).not.toBe(first?.updatedAt);
});
