import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";
import { runDoctor } from "@/services/update/run-doctor";
import type { CapabilitySnapshot } from "@/ui";

const FIXED_DATE = "2026-07-21T10:00:00.000Z";
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function emptyCapabilities(): CapabilitySnapshot {
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
  };
}

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-run-doctor-"));
  made.push(root);
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.configDir, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  return { root, layout };
}

describe("runDoctor", () => {
  test("prints exact JSON report for --json", async () => {
    const { layout } = await makeLayout();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      const code = await runDoctor({
        json: true,
        layout,
        now: () => FIXED_DATE,
        runningExecutable: { path: "/tmp/kunai", version: "0.3.0" },
        pathValue: "",
        platform: "linux",
        fileExists: () => false,
        probeCapabilities: async () => emptyCapabilities(),
      });

      expect(code).toBe(0);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        generatedAt: FIXED_DATE,
        runningExecutable: { path: "/tmp/kunai", version: "0.3.0" },
      });
      expect(lines[0]).toBe(JSON.stringify(parsed));
    } finally {
      console.log = originalLog;
    }
  });

  test("exits 1 only when findings include errors", async () => {
    const { layout } = await makeLayout();
    await writeFile(
      join(layout.configDir, "install.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        method: "binary",
        activeVersion: "1.2.3",
        preferredChannel: "stable",
        launcherPath: layout.launcherPath,
        versionedPath: join(layout.dataDir, "versions", "1.2.3", "kunai"),
        managedPaths: [layout.dataDir, layout.cacheDir],
        downloadBaseUrl: "https://example.test/releases",
        installedAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      })}\n`,
    );

    const originalLog = console.log;
    console.log = () => {};
    try {
      const code = await runDoctor({
        json: false,
        layout,
        now: () => FIXED_DATE,
        runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
        pathValue: "",
        platform: "linux",
        fileExists: () => false,
        probeCapabilities: async () => emptyCapabilities(),
      });
      expect(code).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });

  test("text mode prints human-readable report without writing", async () => {
    const { layout } = await makeLayout();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const code = await runDoctor({
        json: false,
        layout,
        now: () => FIXED_DATE,
        runningExecutable: { path: "/tmp/kunai", version: "0.3.0" },
        pathValue: "",
        platform: "linux",
        fileExists: () => false,
        probeCapabilities: async () => emptyCapabilities(),
      });
      expect(code).toBe(0);
      const text = lines.join("\n");
      expect(text).toContain("Kunai doctor");
      expect(text).toContain("/tmp/kunai");
      expect(text).not.toMatch(/^\s*\{/);
    } finally {
      console.log = originalLog;
    }
  });
});
