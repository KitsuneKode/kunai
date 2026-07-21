import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  INSTALL_MANIFEST_SCHEMA_VERSION,
  inspectInstallManifest,
  readInstallManifest,
  writeInstallManifest,
} from "@/services/update/install-manifest";
import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  return dir;
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

test("write then read round-trips the versioned manifest", async () => {
  const dir = tempDir();
  await writeInstallManifest(
    {
      method: "binary",
      activeVersion: "1.2.3",
      launcherPath: "/x/kunai",
      versionedPath: "/data/versions/1.2.3/kunai",
      downloadBaseUrl: "https://dl",
    },
    dir,
  );
  const m = await readInstallManifest(dir);
  expect(m?.schemaVersion).toBe(INSTALL_MANIFEST_SCHEMA_VERSION);
  expect(m?.method).toBe("binary");
  expect(m?.activeVersion).toBe("1.2.3");
  expect(m?.launcherPath).toBe("/x/kunai");
  expect(m?.versionedPath).toBe("/data/versions/1.2.3/kunai");
  expect(m?.downloadBaseUrl).toBe("https://dl");
  expect(m?.preferredChannel).toBe("stable");
  expect(m?.managedPaths.length).toBeGreaterThan(0);
  expect(typeof m?.installedAt).toBe("string");
  expect(typeof m?.updatedAt).toBe("string");
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

test("read migrates legacy versioned binary atomically", async () => {
  const dir = tempDir();
  const path = join(dir, "install.json");
  await Bun.write(path, `${JSON.stringify(LEGACY_VERSIONED, null, 2)}\n`);
  const m = await readInstallManifest(dir);
  expect(m).toMatchObject({
    schemaVersion: 1,
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
    schemaVersion: 1,
    method: "binary",
    activeVersion: "1.2.3",
    installedAt: "2026-01-01T00:00:00.000Z",
  });
  // Second read is idempotent (no further migration).
  const again = await inspectInstallManifest(dir);
  expect(again).toMatchObject({ status: "loaded", needsMigration: false });
});

test("read migrates legacy flat binary without versionedPath", async () => {
  const dir = tempDir();
  await Bun.write(join(dir, "install.json"), JSON.stringify(LEGACY_FLAT));
  const m = await readInstallManifest(dir);
  expect(m).toMatchObject({
    schemaVersion: 1,
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
] as const)("read migrates legacy %s with empty managedPaths", async (channel, version) => {
  const dir = tempDir();
  await Bun.write(
    join(dir, "install.json"),
    JSON.stringify({
      channel,
      version,
      binPath: "/usr/bin/kunai",
      dlBase: "https://dl.example/releases",
      installedAt: "2026-03-01T00:00:00.000Z",
    }),
  );
  const m = await readInstallManifest(dir);
  expect(m).toMatchObject({
    schemaVersion: 1,
    method: channel,
    activeVersion: version,
    launcherPath: "/usr/bin/kunai",
    managedPaths: [],
    installedAt: "2026-03-01T00:00:00.000Z",
  });
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
      dir,
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
    dir,
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
    dir,
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
    dir,
  );
  const second = await readInstallManifest(dir);
  expect(second?.installedAt).toBe(first?.installedAt);
  expect(second?.activeVersion).toBe("1.0.1");
  expect(second?.updatedAt).not.toBe(first?.updatedAt);
});
