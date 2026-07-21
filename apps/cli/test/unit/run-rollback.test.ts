import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { writeInstallManifest } from "@/services/update/install-manifest";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import { writeInstalledVersionMetadata } from "@/services/update/native-installer/version-metadata";
import { runRollback } from "@/services/update/run-rollback";

const FIXED_DATE = "2026-07-21T10:00:00.000Z";
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-rollback-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(layout.locksDir, { recursive: true });
  await mkdir(layout.transactionsDir, { recursive: true });
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(dirname(layout.launcherPath), { recursive: true });
  return { root, layout };
}

async function seedVerified(
  layout: ReturnType<typeof getInstallLayoutPaths>,
  version: string,
  content: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const path = versionBinaryPath(layout, version);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await writeInstalledVersionMetadata(layout, {
    schemaVersion: 1,
    version,
    target: "linux-x64-gnu",
    artifactName: "kunai-linux-x64-gnu",
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    sourceUrl: `https://example.test/v${version}/kunai`,
    verification: "release-checksum",
    installedAt: FIXED_DATE,
  });
  return path;
}

describe("runRollback", () => {
  test("--list prints verified candidates as JSON lines without writing", async () => {
    const { layout } = await makeLayout();
    await seedVerified(layout, "1.0.0", "old");
    await seedVerified(layout, "2.0.0", "new");
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "2.0.0",
        previousVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        versionedPath: versionBinaryPath(layout, "2.0.0"),
        downloadBaseUrl: "https://example.test/releases",
      },
      layout.configDir,
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const code = await runRollback({ list: true, layout });
      expect(code).toBe(0);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = lines.map((line) => JSON.parse(line));
      expect(parsed.map((c: { version: string }) => c.version).sort()).toEqual(["1.0.0", "2.0.0"]);
    } finally {
      console.log = originalLog;
    }
  });

  test("--dry-run prints plan and exits 0 without mutating", async () => {
    const { layout } = await makeLayout();
    await seedVerified(layout, "1.0.0", "old");
    await seedVerified(layout, "2.0.0", "new");
    await symlink(versionBinaryPath(layout, "2.0.0"), layout.launcherPath);
    await writeInstallManifest(
      {
        method: "binary",
        activeVersion: "2.0.0",
        previousVersion: "1.0.0",
        launcherPath: layout.launcherPath,
        versionedPath: versionBinaryPath(layout, "2.0.0"),
        downloadBaseUrl: "https://example.test/releases",
      },
      layout.configDir,
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const code = await runRollback({ dryRun: true, layout });
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("1.0.0");
      expect(lines.join("\n")).toContain("dry-run");
    } finally {
      console.log = originalLog;
    }
  });

  test("refusal exits 1 with a clear message", async () => {
    const { layout } = await makeLayout();
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

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      const code = await runRollback({ layout });
      expect(code).toBe(1);
      expect(errors.join("\n").toLowerCase()).toMatch(/native|binary|rollback/);
    } finally {
      console.error = originalError;
    }
  });
});
