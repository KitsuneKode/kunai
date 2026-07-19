import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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
        expect(combined).toContain(asset);
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
});

if (!pwshAvailable()) {
  describe("install.ps1 (pwsh unavailable locally)", () => {
    test("skips PowerShell installer coverage — CI Windows/Ubuntu pwsh job required", () => {
      expect(pwshAvailable()).toBe(false);
    });
  });
}
