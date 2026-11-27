import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "win32")("record batch status after the child renames it", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-batch-status-"));
  try {
    const probe = join(root, "rename probe.js");
    writeFileSync(
      probe,
      [
        'import { renameSync, writeSync } from "node:fs";',
        "const batch = process.env.KUNAI_BATCH_PROBE;",
        'renameSync(batch, batch + ".renamed");',
        'writeSync(1, "child ran\\n");',
        "process.exit(37);",
      ].join("\n"),
    );
    const pwsh = Bun.which("pwsh");
    if (!pwsh) throw new Error("Expected pwsh on the Windows parity runner");
    for (const scopes of [0, 1, 2]) {
      for (const [label, exit] of [
        ["literal", "exit /b 37"],
        ["delayed", "exit /b !ERRORLEVEL!"],
        ["call", "call exit /b %%ERRORLEVEL%%"],
        ["implicit", "exit /b"],
        ["detached", "exit /b !ERRORLEVEL!"],
      ]) {
        if (scopes === 0 && (label === "delayed" || label === "detached")) continue;
        const batch = join(root, `${scopes} scopes ${label}.cmd`);
        const scopeSetup = Array<string>(scopes).fill(
          label === "delayed" || label === "detached"
            ? "setlocal EnableExtensions EnableDelayedExpansion"
            : "setlocal EnableExtensions DisableDelayedExpansion",
        );
        const command = `"%KUNAI_BATCH_BUN%" run "%KUNAI_BATCH_SCRIPT%"`;
        const payload =
          label === "detached" ? `(goto) 2>nul & ${command} & ${exit}` : `${command} & ${exit}`;
        writeFileSync(batch, ["@echo off", ...scopeSetup, payload, ""].join("\r\n"));
        const result = Bun.spawnSync(
          [pwsh, "-NoProfile", "-Command", "& $env:KUNAI_BATCH_PROBE; exit $LASTEXITCODE"],
          {
            env: {
              ...process.env,
              KUNAI_BATCH_PROBE: batch,
              KUNAI_BATCH_BUN: process.execPath,
              KUNAI_BATCH_SCRIPT: probe,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        console.log(
          `cmd rename observation ${JSON.stringify({
            scopes,
            label,
            status: result.exitCode,
            stderr: result.stderr.toString(),
          })}`,
        );
        expect(result.stdout.toString().trim()).toBe("child ran");
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
