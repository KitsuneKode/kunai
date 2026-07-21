import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  buildDoctorReport,
  formatDoctorReportText,
} from "@/services/update/native-installer/doctor";
import {
  getInstallLayoutPaths,
  versionBinaryPath,
} from "@/services/update/native-installer/install-layout";
import { beginInstallTransaction } from "@/services/update/native-installer/transaction";
import { writeInstalledVersionMetadata } from "@/services/update/native-installer/version-metadata";
import type { CapabilitySnapshot } from "@/ui";

const FIXED_DATE = "2026-07-21T10:00:00.000Z";
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function emptyCapabilities(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    mpv: true,
    ffprobe: true,
    ytDlp: true,
    chafa: true,
    magick: true,
    image: {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      dependency: "none",
      reason: "test",
    },
    issues: [],
    ...overrides,
  };
}

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "kunai-doctor-"));
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
  await mkdir(join(root, "bin"), { recursive: true });
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

async function seedLegacyManifestAndStaleState(
  root: string,
  layout: ReturnType<typeof getInstallLayoutPaths>,
) {
  const legacy = {
    channel: "binary",
    version: "1.0.0",
    binPath: layout.launcherPath,
    versionPath: versionBinaryPath(layout, "1.0.0"),
    dlBase: "https://example.test/releases",
    installedAt: "2026-01-01T00:00:00.000Z",
    layout: "versioned",
  };
  await writeFile(join(layout.configDir, "install.json"), `${JSON.stringify(legacy, null, 2)}\n`);

  const versionPath = versionBinaryPath(layout, "1.0.0");
  await mkdir(join(layout.versionsDir, "1.0.0"), { recursive: true });
  await writeFile(versionPath, "BINARY-1.0.0");
  await writeInstalledVersionMetadata(layout, {
    schemaVersion: 1,
    version: "1.0.0",
    target: "linux-x64",
    artifactName: "kunai-linux-x64",
    artifactSha256: createHash("sha256").update("BINARY-1.0.0").digest("hex"),
    sizeBytes: Buffer.byteLength("BINARY-1.0.0"),
    sourceUrl: "https://example.test/v1.0.0/kunai-linux-x64",
    verification: "release-checksum",
    installedAt: "2026-01-01T00:00:00.000Z",
  });

  await writeFile(
    join(layout.locksDir, "1.0.0.lock"),
    `${JSON.stringify({
      pid: 2_147_483_646,
      version: "1.0.0",
      execPath: versionPath,
      acquiredAt: "2020-01-01T00:00:00.000Z",
    })}\n`,
  );

  await beginInstallTransaction(layout, {
    kind: "upgrade",
    version: "2.0.0",
    pid: 2_147_483_645,
    startedAt: "2020-01-01T00:00:00.000Z",
    stagingDir: join(layout.stagingRoot, "2.0.0"),
  });

  await mkdir(join(layout.stagingRoot, "2.0.0"), { recursive: true });
  await writeFile(join(layout.stagingRoot, "2.0.0", "partial.bin"), "partial");

  await writeFile(join(root, "bin", "kunai"), "launcher-stub");
}

describe("buildDoctorReport", () => {
  test("doctor does not migrate or clean", async () => {
    const { root, layout } = await makeRoot();
    await seedLegacyManifestAndStaleState(root, layout);
    const before = await snapshotTree(root);

    await buildDoctorReport({
      layout,
      now: () => FIXED_DATE,
      runningExecutable: { path: layout.launcherPath, version: "1.0.0" },
      pathValue: join(root, "bin"),
      platform: process.platform === "win32" ? "win32" : "linux",
      fileExists: existsSync,
      probeCapabilities: async () => emptyCapabilities(),
    });

    expect(await snapshotTree(root)).toEqual(before);

    const manifestRaw = await readFile(join(layout.configDir, "install.json"), "utf8");
    expect(JSON.parse(manifestRaw)).toMatchObject({ channel: "binary", version: "1.0.0" });
    expect(await readdir(layout.locksDir)).toContain("1.0.0.lock");
    expect((await readdir(layout.transactionsDir)).length).toBeGreaterThan(0);
    expect(await Bun.file(join(layout.stagingRoot, "2.0.0", "partial.bin")).exists()).toBe(true);
  });

  test("report includes executable, PATH, manifest, versions, locks, transactions, platform, deps", async () => {
    const { root, layout } = await makeRoot();
    await seedLegacyManifestAndStaleState(root, layout);

    const report = await buildDoctorReport({
      layout,
      now: () => FIXED_DATE,
      runningExecutable: { path: layout.launcherPath, version: "1.0.0" },
      pathValue: join(root, "bin"),
      platform: process.platform === "win32" ? "win32" : "linux",
      fileExists: existsSync,
      probeCapabilities: async () =>
        emptyCapabilities({
          mpv: false,
          issues: [
            {
              id: "mpv-missing",
              severity: "degraded",
              message: "mpv not found — required for playback (shell still available).",
              remediation: ["Arch:   sudo pacman -S mpv"],
            },
          ],
        }),
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe(FIXED_DATE);
    expect(report.runningExecutable).toEqual({
      path: layout.launcherPath,
      version: "1.0.0",
    });
    expect(report.pathCandidates.length).toBeGreaterThanOrEqual(1);
    expect(report.pathCandidates[0]?.winner).toBe(true);
    expect(report.manifest).toMatchObject({
      status: "loaded",
      needsMigration: true,
    });
    expect(report.launcher.path).toBe(layout.launcherPath);
    expect(report.versions.some((v) => v.version === "1.0.0")).toBe(true);
    expect(report.locks.some((l) => l.version === "1.0.0" && l.inspection.status === "stale")).toBe(
      true,
    );
    expect(report.transactions.length).toBeGreaterThan(0);
    expect(report.platform.os).toBeDefined();
    expect(report.dependencies.mpv).toBe(false);
    expect(report.findings.some((f) => f.code === "legacy-manifest-needs-migration")).toBe(true);
    expect(report.findings.some((f) => f.code === "stale-lock")).toBe(true);
    expect(report.findings.some((f) => f.code === "abandoned-transaction")).toBe(true);
    expect(report.findings.some((f) => f.code === "mpv-missing")).toBe(true);
    expect(report.findings.every((f) => Array.isArray(f.remediation))).toBe(true);

    const text = formatDoctorReportText(report);
    expect(text).toContain(layout.launcherPath);
    expect(text).toContain("PATH candidates");
    expect(text).toContain("Manifest");
    expect(text).toContain("1.0.0");
    expect(text).toContain("Remediation");
  });

  test("text formatting includes remediations for error findings", async () => {
    const { layout } = await makeRoot();
    const report = await buildDoctorReport({
      layout,
      now: () => FIXED_DATE,
      runningExecutable: { path: "/tmp/kunai", version: "9.9.9" },
      pathValue: "",
      platform: "linux",
      fileExists: () => false,
      probeCapabilities: async () => emptyCapabilities(),
      inspectManifest: async () => ({
        status: "loaded",
        needsMigration: false,
        manifest: {
          schemaVersion: 1,
          method: "binary",
          activeVersion: "9.9.9",
          preferredChannel: "stable",
          launcherPath: layout.launcherPath,
          versionedPath: versionBinaryPath(layout, "9.9.9"),
          managedPaths: [layout.dataDir, layout.cacheDir],
          downloadBaseUrl: "https://example.test/releases",
          installedAt: FIXED_DATE,
          updatedAt: FIXED_DATE,
        },
      }),
    });

    expect(
      report.findings.some((f) => f.severity === "error" && f.code === "missing-version-binary"),
    ).toBe(true);
    const text = formatDoctorReportText(report);
    expect(text).toContain("missing-version-binary");
    expect(text).toMatch(/Remediation|kunai upgrade/);
  });
});
