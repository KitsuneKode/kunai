import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMPLETION_SHELLS, renderCompletionScript } from "@/services/completion/completion-script";

import { removeTempDir } from "../support/remove-temp-dir";

/**
 * Unit tests assert what the generated scripts *contain*. Only a real parser
 * catches a script that is syntactically broken — an unbalanced `case` arm or a
 * stray quote renders every assertion above it meaningless while still matching
 * the expected substrings.
 */
function shellAvailable(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  return result.status === 0;
}

function writeScript(contents: string, extension: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kunai-completion-"));
  const path = join(dir, `kunai.${extension}`);
  writeFileSync(path, contents, "utf8");
  return { path, cleanup: () => removeTempDir(dir) };
}

const describeBash = shellAvailable("bash", ["-c", "exit 0"]) ? describe : describe.skip;
const describeZsh = shellAvailable("zsh", ["-c", "exit 0"]) ? describe : describe.skip;
const describePwsh = shellAvailable("pwsh", ["-NoProfile", "-Command", "exit 0"])
  ? describe
  : describe.skip;

describe("completion script generation", () => {
  test("renders a script for every advertised shell", () => {
    for (const shell of COMPLETION_SHELLS) {
      expect(renderCompletionScript(shell).length).toBeGreaterThan(0);
    }
  });
});

describeBash("bash completion", () => {
  test("parses under bash -n", () => {
    const script = writeScript(renderCompletionScript("bash"), "bash");
    try {
      const result = spawnSync("bash", ["-n", script.path], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      script.cleanup();
    }
  });
});

describeZsh("zsh completion", () => {
  test("parses under zsh -n", () => {
    const script = writeScript(renderCompletionScript("zsh"), "zsh");
    try {
      const result = spawnSync("zsh", ["-n", script.path], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      script.cleanup();
    }
  });
});

describePwsh("powershell completion", () => {
  test("parses as valid PowerShell", () => {
    const script = writeScript(renderCompletionScript("powershell"), "ps1");
    try {
      // Parse without executing: a parse error populates the error variable.
      const result = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${script.path}', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_ }; exit 1 } else { exit 0 }`,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
    } finally {
      script.cleanup();
    }
  });
});
