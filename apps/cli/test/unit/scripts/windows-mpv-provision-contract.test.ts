import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../../../..");
const SCRIPT_PATH = join(REPO_ROOT, ".github/scripts/provision-windows-mpv.ps1");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/ci.yml");

describe("Windows mpv CI provisioning contract", () => {
  const script = readFileSync(SCRIPT_PATH, "utf8");
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  test("uses the checked-in provisioner instead of a mutable package-manager feed", () => {
    const provisionerReferences = workflow.match(/.github\/scripts\/provision-windows-mpv\.ps1/g);
    expect(provisionerReferences).toHaveLength(2);
    expect(workflow).not.toMatch(/choco(?:latey)?\s+install\s+mpv/i);
    expect(workflow).not.toMatch(/scoop\s+install\s+mpv/i);
  });

  test("pins the official archive and verifies its SHA-256 before extraction", () => {
    expect(script).toContain(
      "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip",
    );
    expect(script).toContain("4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff");
    expect(script).toContain("Get-FileHash");
    expect(script.indexOf("Get-FileHash")).toBeLessThan(script.indexOf("Expand-Archive"));
  });

  test("retries bounded downloads and makes the verified executable available", () => {
    expect(script).toMatch(/\[ValidateRange\(1, 10\)\]\s*\[int\]\$MaxAttempts = 3/);
    expect(script).toContain("Invoke-WebRequest");
    expect(script).toContain("$env:GITHUB_PATH");
    expect(script).toContain("Start-Process");
    expect(script).toContain(".ExitCode");
    expect(script).toContain('ArgumentList "--version"');
    expect(script).not.toContain("$LASTEXITCODE");
  });
});
