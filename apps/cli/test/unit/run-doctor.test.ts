import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURL_INSTALL, MPV_INSTALL, YT_DLP_INSTALL } from "@/infra/os/install-commands";
import { emptyMpvHardwareAccelProbe } from "@/infra/player/mpv-hwaccel-probe";
import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";
import { runDoctor, type RunDoctorOptions } from "@/services/update/run-doctor";
import type { CapabilitySnapshot } from "@/ui";
import { getKunaiPaths } from "@kunai/storage";

import { applyStorageRootEnv } from "../helpers/storage-env";

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
    mpvRequired: true,
    vlc: true,
    vlcRequired: false,
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
    mpvHardwareAccel: emptyMpvHardwareAccelProbe("not-probed"),
    issues: [],
    ...overrides,
  };
}

const noProfileMpvHwdecRead = {
  mpvHwdecMode: "mpv-default" as const,
  readMpvHwdecMode: async () => {
    throw new Error("runDoctor test touched the profile mpv hardware config");
  },
};

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
        ...noProfileMpvHwdecRead,
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
        ...noProfileMpvHwdecRead,
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

  test("exits 1 when mpv is missing — playback is the product, not a warning", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    try {
      const code = await runDoctor({
        ...noProfileMpvHwdecRead,
        json: false,
        layout,
        now: () => FIXED_DATE,
        runningExecutable: { path: "/tmp/kunai", version: "0.3.0" },
        pathValue: "",
        platform: "linux",
        fileExists: () => false,
        probeCapabilities: async () => ({
          ...emptyCapabilities(),
          mpv: false,
          issues: [
            {
              id: "mpv-missing",
              severity: "degraded",
              message: "mpv not found — required for playback (shell still available).",
              install: MPV_INSTALL,
              remediation: [],
            },
          ],
        }),
      });
      expect(code).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });

  test("lane-conditional missing deps stay warnings and keep exit 0", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    try {
      const code = await runDoctor({
        ...noProfileMpvHwdecRead,
        json: false,
        layout,
        now: () => FIXED_DATE,
        runningExecutable: { path: "/tmp/kunai", version: "0.3.0" },
        pathValue: "",
        platform: "linux",
        fileExists: () => false,
        probeCapabilities: async () => ({
          ...emptyCapabilities(),
          ytDlp: false,
          curl: { present: false, impersonates: false, profile: null },
          issues: [
            {
              id: "yt-dlp-missing",
              severity: "degraded",
              message: "yt-dlp not found — YouTube playback and downloads require yt-dlp.",
              install: YT_DLP_INSTALL,
              remediation: [],
            },
            {
              id: "curl-missing",
              severity: "degraded",
              message: "curl not found — anime providers need it.",
              install: CURL_INSTALL,
              remediation: [],
            },
          ],
        }),
      });
      expect(code).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });

  /**
   * `--strict` turns warnings into a non-zero exit for scripts asking "is this
   * install fully featured?": lane deps like yt-dlp and curl are warnings by
   * default (the core player works without them) and errors under strict.
   * `info` never fails either way — a source checkout correctly reports
   * `missing-manifest` at info.
   */
  test("strict mode exits 1 on warnings that the default mode tolerates", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    const laneDepsOnly: RunDoctorOptions = {
      ...noProfileMpvHwdecRead,
      json: false,
      layout,
      now: () => FIXED_DATE,
      runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
      pathValue: "",
      platform: "linux" as const,
      fileExists: () => false,
      probeCapabilities: async () => ({
        ...emptyCapabilities(),
        ytDlp: false,
        curl: { present: false, impersonates: false, profile: null },
        issues: [
          {
            id: "yt-dlp-missing",
            severity: "degraded" as const,
            message: "yt-dlp not found — YouTube playback and downloads require yt-dlp.",
            install: YT_DLP_INSTALL,
            remediation: [],
          },
        ],
      }),
    };

    try {
      expect(await runDoctor(laneDepsOnly)).toBe(0);
      expect(await runDoctor({ ...laneDepsOnly, strict: true })).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });

  test("an injected mpv hardware mode never touches the profile config path", async () => {
    const { layout } = await makeLayout();
    const profileRoot = await mkdtemp(join(tmpdir(), "kunai-run-doctor-profile-"));
    made.push(profileRoot);
    const restoreStorage = applyStorageRootEnv(profileRoot);
    const forbiddenConfigPath = getKunaiPaths().configPath;
    const originalBunFile = Bun.file;
    let configPathReads = 0;
    Bun.file = ((...args: Parameters<typeof Bun.file>) => {
      if (String(args[0]) === forbiddenConfigPath) configPathReads += 1;
      return originalBunFile(...args);
    }) as typeof Bun.file;
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const code = await runDoctor({
        mpvHwdecMode: "off",
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
      const parsed = JSON.parse(lines[0]!) as {
        playback?: { mpvHwdec?: string; mpvHwdecEmitted?: string | null };
      };
      expect(parsed.playback).toMatchObject({ mpvHwdec: "off", mpvHwdecEmitted: "no" });
      expect(configPathReads).toBe(0);
    } finally {
      console.log = originalLog;
      Bun.file = originalBunFile;
      restoreStorage();
    }
  });

  test("strict mode accepts a VLC-only desktop when auto selected VLC", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    try {
      expect(
        await runDoctor({
          ...noProfileMpvHwdecRead,
          json: false,
          strict: true,
          layout,
          now: () => FIXED_DATE,
          runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
          pathValue: "",
          platform: "linux",
          fileExists: () => false,
          playerChoice: "auto",
          installedPlayers: { mpv: false, vlc: true },
          probeCapabilities: async (options) => {
            expect(options.playerMode).toEqual({ kind: "managed-vlc" });
            return emptyCapabilities({
              mpv: false,
              vlc: true,
              mpvRequired: false,
              vlcRequired: true,
            });
          },
        }),
      ).toBe(0);
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
          ...noProfileMpvHwdecRead,
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

  test("--player vlc is honored by the maintenance fast path instead of ignored", async () => {
    const { layout } = await makeLayout();
    const originalLog = console.log;
    console.log = () => {};
    try {
      expect(
        await runDoctor({
          ...noProfileMpvHwdecRead,
          argv: ["doctor", "--player", "vlc"],
          json: false,
          strict: true,
          layout,
          now: () => FIXED_DATE,
          runningExecutable: { path: layout.launcherPath, version: "1.2.3" },
          pathValue: "",
          platform: "linux",
          fileExists: () => false,
          probeCapabilities: async (options) => {
            expect(options.playerMode).toEqual({ kind: "managed-vlc" });
            return emptyCapabilities();
          },
        }),
      ).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("an invalid doctor --player value exits as usage rather than probing the wrong player", async () => {
    const { layout } = await makeLayout();
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(
        await runDoctor({
          ...noProfileMpvHwdecRead,
          argv: ["doctor", "--player", "potato"],
          layout,
          probeCapabilities: async () => {
            throw new Error("probe must not run");
          },
        }),
      ).toBe(2);
    } finally {
      console.error = originalError;
    }
  });

  test("a trailing doctor --player with no value exits as usage, not with the saved choice", async () => {
    const { layout } = await makeLayout();
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(
        await runDoctor({
          ...noProfileMpvHwdecRead,
          argv: ["doctor", "--strict", "--json", "--player"],
          layout,
          probeCapabilities: async () => {
            throw new Error("probe must not run");
          },
        }),
      ).toBe(2);
    } finally {
      console.error = originalError;
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
        ...noProfileMpvHwdecRead,
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
