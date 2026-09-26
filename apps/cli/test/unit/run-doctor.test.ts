import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MPV_INSTALL, buildRemediationLines } from "@/infra/os/install-commands";
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
    curl: { present: true, impersonates: true, profile: "chrome150" },
    image: {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      reason: "test",
    },
    issues: [],
  };
}

/**
 * Every dependency absent, which is the state that used to exit 0. `mpv` is
 * `degraded` rather than `fatal` on purpose (the shell still mounts), so this
 * report is warnings-only.
 */
function missingMpvCapabilities(): CapabilitySnapshot {
  return {
    ...emptyCapabilities(),
    mpv: false,
    issues: [
      {
        id: "mpv-missing",
        severity: "degraded",
        message: "mpv not found — required for playback (shell still available).",
        install: MPV_INSTALL,
        remediation: buildRemediationLines(MPV_INSTALL),
      },
    ],
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

  /**
   * Warnings do not fail by default, and that is deliberate — a missing mpv
   * still leaves setup and the non-playback shell working. The gap it left is
   * that a script asking "is this install healthy?" got 0 for an install that
   * cannot play a video. `--strict` is that mode, and this pins both halves:
   * the same report is 0 by default and 1 under `--strict`.
   */
  test("strict mode exits 1 on warnings that the default mode tolerates", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    const base = {
      json: false,
      layout,
      now: () => FIXED_DATE,
      runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
      pathValue: "",
      platform: "linux" as const,
      fileExists: () => false,
    };
    const withMissingDeps = {
      ...base,
      probeCapabilities: async () => missingMpvCapabilities(),
    };

    try {
      expect(await runDoctor(withMissingDeps)).toBe(0);
      expect(await runDoctor({ ...withMissingDeps, strict: true })).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });

  test("strict mode still exits 0 when there is nothing to report", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    try {
      expect(
        await runDoctor({
          json: false,
          strict: true,
          layout,
          now: () => FIXED_DATE,
          runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
          pathValue: "",
          platform: "linux",
          fileExists: () => false,
          probeCapabilities: async () => emptyCapabilities(),
        }),
      ).toBe(0);
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
