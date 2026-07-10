import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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

describePwsh("install.ps1 dry-run", () => {
  test("prints the binary install plan without downloading", () => {
    // Clear Windows-only env vars so Linux CI pwsh exercises the fallback paths.
    const result = runInstallPs1(["-DryRun", "-Yes"], {
      ...process.env,
      LOCALAPPDATA: "",
      APPDATA: "",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai installer");
    expect(result.stdout).toContain("Downloading kunai-windows-");
    expect(result.stdout).toContain("versions");
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("vdry-run");
    expect(result.stderr).toBe("");
  });

  test("honors pinned -Version in dry-run output", () => {
    const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"], {
      ...process.env,
      LOCALAPPDATA: "",
      APPDATA: "",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v9.8.7");
    expect(result.stdout).toContain("[dry-run]");
  });

  test("rejects lifecycle switches — use kunai upgrade / kunai uninstall instead", () => {
    const uninstall = runInstallPs1(["-Uninstall"]);
    expect(uninstall.status).not.toBe(0);
    expect(`${uninstall.stderr}${uninstall.stdout}`).toMatch(/Uninstall|parameter/i);

    const upgrade = runInstallPs1(["-Upgrade"]);
    expect(upgrade.status).not.toBe(0);
    expect(`${upgrade.stderr}${upgrade.stdout}`).toMatch(/Upgrade|parameter/i);
  });
});
