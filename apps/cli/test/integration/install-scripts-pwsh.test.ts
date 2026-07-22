import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import {
  createInstallerSandbox,
  installCommandShim,
  withReleaseFixture,
} from "./helpers/installer-script-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const INSTALL_PS1 = join(REPO_ROOT, "install.ps1");

function pwshAvailable(): boolean {
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
    encoding: "utf8",
  });
  return result.status === 0;
}

const describePwsh = pwshAvailable() ? describe : describe.skip;

function runInstallPs1(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return spawnSync("pwsh", ["-NoProfile", "-File", INSTALL_PS1, ...args], {
    encoding: "utf8",
    env,
  });
}

/** Async so Bun.serve can answer while the installer runs (spawnSync deadlocks the fixture). */
async function runInstallPs1Async(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["pwsh", "-NoProfile", "-File", INSTALL_PS1, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { status, stdout, stderr };
}

function hostWindowsAsset(): string {
  return process.arch === "arm64" ? "kunai-windows-arm64.exe" : "kunai-windows-x64.exe";
}

describePwsh("install.ps1 dry-run", () => {
  test("prints the binary install plan without downloading", () => {
    const result = runInstallPs1(["-DryRun", "-Yes"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai installer");
    expect(result.stdout).toContain("Downloading kunai-windows-");
    expect(result.stdout).toContain("versions");
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stderr).toBe("");
  });

  test("honors pinned -Version in dry-run output", () => {
    const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v9.8.7");
  });

  test("dry-run is side-effect-free — creates no sandbox directories", () => {
    const sandbox = createInstallerSandbox("install-ps1-dry");
    try {
      const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"], sandbox.env);
      expect(result.status).toBe(0);
      expect(existsSync(sandbox.binDir)).toBe(false);
      expect(existsSync(sandbox.dataDir)).toBe(false);
      expect(existsSync(sandbox.configDir)).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects lifecycle switches — use kunai upgrade / kunai uninstall instead", () => {
    const uninstall = runInstallPs1(["-Uninstall"]);
    expect(uninstall.status).not.toBe(0);
    expect(`${uninstall.stderr}${uninstall.stdout}`).toMatch(/Uninstall|parameter/i);

    const upgrade = runInstallPs1(["-Upgrade"]);
    expect(upgrade.status).not.toBe(0);
    expect(`${upgrade.stderr}${upgrade.stdout}`).toMatch(/Upgrade|parameter/i);
  });

  test("dry-run dependency plan reaches both mpv and yt-dlp when winget is present", () => {
    const sandbox = createInstallerSandbox("install-ps1-deps");
    installCommandShim(sandbox.root, "winget");
    try {
      const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"], {
        ...sandbox.env,
        PATH: `${sandbox.root}${delimiter}${process.env.PATH ?? ""}`,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("winget install --id mpv.net -e");
      expect(result.stdout).toContain("winget install yt-dlp");
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 release asset failures", () => {
  test("pins a resolved latest binary and checksum to the immutable release URL", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-latest-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-latest-url");
    try {
      await withReleaseFixture(
        {
          "/releases/latest": {
            body: JSON.stringify({ tag_name: "v9.8.7" }),
            headers: { "content-type": "application/json" },
          },
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_RELEASES_API: `${baseUrl}/releases/latest`,
          });

          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(evidence.requests).toEqual([
            "/releases/latest",
            "/download/v9.8.7/SHA256SUMS",
            `/download/v9.8.7/${asset}`,
          ]);
          expect(evidence.requests.some((path) => path.includes("/latest/download"))).toBe(false);

          const metadata = JSON.parse(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"), "utf8"),
          ) as { sourceUrl: string };
          expect(metadata.sourceUrl).toBe(`${baseUrl}/download/v9.8.7/${asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects an empty downloaded asset", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-empty");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body: "" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"0".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `Downloaded asset ${asset} is empty`,
          );
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects a SHA256SUMS file with no matching asset entry", async () => {
    const asset = hostWindowsAsset();
    const body = "payload-bytes-for-checksum";
    const sandbox = createInstallerSandbox("install-ps1-missum");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  other-asset\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `SHA256SUMS has no entry for ${asset}`,
          );
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("404 guidance mentions npm, bun, source, and pinned version", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-404");
    try {
      await withReleaseFixture({}, async (baseUrl) => {
        const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
          ...sandbox.env,
          KUNAI_DL_BASE: baseUrl,
        });
        expect(result.status).not.toBe(0);
        const combined = `${result.stderr}${result.stdout}`;
        // Checksum is fetched first (parity with installLatest); 404 may name SHA256SUMS or asset.
        expect(combined).toMatch(new RegExp(`${asset}|SHA256SUMS`, "i"));
        expect(combined).toMatch(/-Method npm/i);
        expect(combined).toMatch(/-Method bun/i);
        expect(combined).toMatch(/-Method source/i);
        expect(combined).toMatch(/-Version/i);
        expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("accepts a matching checksum from the local fixture", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-ok");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(evidence.requests).toEqual([
            "/download/v9.8.7/SHA256SUMS",
            `/download/v9.8.7/${asset}`,
          ]);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(true);

          const manifest = JSON.parse(
            readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
          ) as Record<string, unknown>;
          expect(manifest.schemaVersion).toBe(1);
          expect(manifest.method).toBe("binary");
          expect(manifest.activeVersion).toBe("9.8.7");
          expect(manifest.preferredChannel).toBe("stable");
          expect(manifest.launcherPath).toBe(join(sandbox.binDir, "kunai.exe"));
          expect(manifest.versionedPath).toBe(
            join(sandbox.dataDir, "versions", "9.8.7", "kunai.exe"),
          );
          expect(manifest.downloadBaseUrl).toBe(baseUrl);
          expect(manifest.artifactSha256).toBe(digest);
          expect(Array.isArray(manifest.managedPaths)).toBe(true);
          expect(existsSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"))).toBe(true);
          const versionMetadata = JSON.parse(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"), "utf8"),
          ) as { sourceUrl: string };
          expect(versionMetadata.sourceUrl).toBe(`${baseUrl}/download/v9.8.7/${asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 lifecycle contract", () => {
  test.each(["../1.2.3", "1.2.3-beta", "01.2.3", "1.2"])(
    "rejects invalid version %s before creating directories",
    (version) => {
      const sandbox = createInstallerSandbox(
        `install-ps1-badver-${version.replace(/[^\w.-]/g, "_")}`,
      );
      try {
        const result = runInstallPs1(["-Yes", "-Version", version], sandbox.env);
        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toMatch(/invalid|version/i);
        expect(existsSync(sandbox.binDir)).toBe(false);
        expect(existsSync(sandbox.dataDir)).toBe(false);
        expect(existsSync(sandbox.configDir)).toBe(false);
        expect(existsSync(sandbox.cacheDir)).toBe(false);
      } finally {
        sandbox.cleanup();
      }
    },
  );

  test("retries 503 then succeeds", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-retry-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-503");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body,
            failuresBeforeSuccess: 1,
            failureStatus: 503,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not retry 404", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-404-noretry");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: "gone",
            status: 404,
          },
        },
        async (baseUrl) => {
          const started = Date.now();
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_RETRY_BASE_MS: "200",
          });
          expect(result.status).not.toBe(0);
          expect(Date.now() - started).toBeLessThan(5_000);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects oversized download via max bytes", async () => {
    const asset = hostWindowsAsset();
    const oversized = "x".repeat(4096);
    const sandbox = createInstallerSandbox("install-ps1-oversize");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: oversized,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_BYTES: "1024",
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(/size|too large|max|Download failed/i);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects stalled download and removes staging partials", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-stall");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: "abcdefghijklmnopqrstuvwxyz",
            chunkDelayMs: 800,
            chunkSize: 1,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"b".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_STALL_MS: "500",
            KUNAI_DOWNLOAD_TOTAL_SECONDS: "5",
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
          });
          expect(result.status).not.toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("preserves old launcher and manifest when a new install fails", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-preserve");
    mkdirSync(sandbox.binDir, { recursive: true });
    mkdirSync(sandbox.configDir, { recursive: true });
    mkdirSync(join(sandbox.dataDir, "versions", "1.0.0"), { recursive: true });
    const oldBinary = join(sandbox.dataDir, "versions", "1.0.0", "kunai.exe");
    const launcher = join(sandbox.binDir, "kunai.exe");
    writeFileSync(oldBinary, "MZ-old-binary");
    writeFileSync(launcher, "MZ-old-launcher");
    const oldManifest = {
      schemaVersion: 1,
      method: "binary",
      activeVersion: "1.0.0",
      preferredChannel: "stable",
      launcherPath: launcher,
      versionedPath: oldBinary,
      managedPaths: [sandbox.dataDir, sandbox.cacheDir],
      downloadBaseUrl: "https://example.test/releases",
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      artifactSha256: "c".repeat(64),
    };
    writeFileSync(
      join(sandbox.configDir, "install.json"),
      `${JSON.stringify(oldManifest, null, 2)}\n`,
    );
    const beforeManifest = readFileSync(join(sandbox.configDir, "install.json"), "utf8");
    const beforeLauncher = readFileSync(launcher);

    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body: "MZ-bad-payload" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"d".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(readFileSync(join(sandbox.configDir, "install.json"), "utf8")).toBe(
            beforeManifest,
          );
          expect(readFileSync(launcher)).toEqual(beforeLauncher);
          expect(existsSync(oldBinary)).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

const describeWindows = process.platform === "win32" && pwshAvailable() ? describe : describe.skip;

describeWindows("install.ps1 PATH diagnostics", () => {
  test("reports a stale npm shim as the PATH winner without removing it", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-stale-npm");
    const npmBinDir = join(sandbox.root, "npm");
    const npmShimPath = join(npmBinDir, "kunai.cmd");
    const nativePath = join(sandbox.binDir, "kunai.exe");
    mkdirSync(npmBinDir);
    installCommandShim(npmBinDir, "kunai");

    const env: NodeJS.ProcessEnv = { ...sandbox.env };
    const inheritedPath =
      Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "path") delete env[key];
    }
    env.Path = `${npmBinDir};${inheritedPath}`;

    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-Version", "9.8.7"], {
            ...env,
            KUNAI_DL_BASE: baseUrl,
          });

          expect(result.status).toBe(0);
          expect(existsSync(npmShimPath)).toBe(true);
          expect(result.stdout).toContain(`PATH winner: ${npmShimPath}`);
          expect(result.stdout).toContain(`Planned native path: ${nativePath}`);
          expect(result.stdout).toContain("npm uninstall -g @kitsunekode/kunai");
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 package activeVersion", () => {
  test("npm method resolves activeVersion from kunai --version, never latest", () => {
    const sandbox = createInstallerSandbox("install-ps1-npm-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      mkdirSync(shimDir, { recursive: true });
      installCommandShim(shimDir, "npm");
      installCommandShim(shimDir, "bun");
      installCommandShim(
        shimDir,
        "kunai",
        process.platform === "win32"
          ? "@echo off\r\necho kunai 4.5.6 (npm-global)\r\n"
          : '#!/bin/sh\necho "kunai 4.5.6 (npm-global)"\n',
      );

      const env: NodeJS.ProcessEnv = { ...sandbox.env };
      const inheritedPath =
        Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === "path") delete env[key];
      }
      env.Path = `${shimDir}${delimiter}${inheritedPath}`;

      const result = runInstallPs1(["-Method", "npm", "-Yes"], env);
      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; method: string };
      expect(manifest.method).toBe("npm-global");
      expect(manifest.activeVersion).toBe("4.5.6");
      expect(manifest.activeVersion).not.toBe("latest");
    } finally {
      sandbox.cleanup();
    }
  });
});

if (!pwshAvailable()) {
  describe("install.ps1 (pwsh unavailable locally)", () => {
    test("skips PowerShell installer coverage — CI Windows/Ubuntu pwsh job required", () => {
      expect(pwshAvailable()).toBe(false);
    });
  });
}
