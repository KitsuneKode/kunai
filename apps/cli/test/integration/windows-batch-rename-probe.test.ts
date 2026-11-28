import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test.skipIf(process.platform !== "win32")(
  "measure detached batch status with no local scopes",
  () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-batch (probe)!-"));
    try {
      const launcher = join(root, "bin", "kunai.cmd");
      const caller = join(root, "caller.cmd");
      const executable = join(root, "data", "versions", "9.8.7", "kunai.exe");
      const script = join(root, "probe.js");
      mkdirSync(dirname(launcher), { recursive: true });
      mkdirSync(dirname(executable), { recursive: true });
      copyFileSync(process.execPath, executable);
      writeFileSync(
        script,
        [
          'import { renameSync, writeSync } from "node:fs";',
          "const batch = process.env.KUNAI_BATCH_LAUNCHER;",
          'renameSync(batch, batch + ".renamed");',
          'writeSync(1, JSON.stringify(process.argv.slice(2)) + "\\n");',
          "process.exit(Number(process.env.KUNAI_BATCH_STATUS));",
        ].join("\n"),
      );
      writeFileSync(
        caller,
        [
          "@echo off",
          'call "%KUNAI_BATCH_LAUNCHER%" %*',
          "echo caller status: %ERRORLEVEL%",
          "if defined KUNAI_CONFIG_DIR exit /b 91",
          "exit /b %ERRORLEVEL%",
          "",
        ].join("\r\n"),
      );
      const pwsh = Bun.which("pwsh");
      if (!pwsh) throw new Error("Expected pwsh on the Windows parity runner");
      const mismatches: string[] = [];
      for (const fromBatch of [false, true]) {
        for (const status of [0, 37, "missing"]) {
          if (status === "missing") rmSync(executable);
          else if (fromBatch && status === 0) copyFileSync(process.execPath, executable);
          writeFileSync(
            launcher,
            '@(goto) 2>nul & "%~dp0..\\data\\versions\\9.8.7\\kunai.exe" %*\r\n',
          );
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            KUNAI_BATCH_LAUNCHER: launcher,
            KUNAI_BATCH_SCRIPT: script,
            KUNAI_BATCH_ENTRY: fromBatch ? caller : launcher,
            KUNAI_BATCH_STATUS: String(status),
          };
          delete env.KUNAI_CONFIG_DIR;
          const result = Bun.spawnSync(
            [
              pwsh,
              "-NoProfile",
              "-Command",
              "& $env:KUNAI_BATCH_ENTRY run $env:KUNAI_BATCH_SCRIPT 'plain(parentheses)' 'quoted & argument' 'literal!KUNAI_CONFIG_DIR!'; exit $LASTEXITCODE",
            ],
            { env, stdout: "pipe", stderr: "pipe" },
          );
          const observation = JSON.stringify({
            fromBatch,
            expected: status,
            observed: result.exitCode,
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
          });
          console.log(`detached observation ${observation}`);
          if (status === "missing" ? result.exitCode === 0 : result.exitCode !== status) {
            mismatches.push(observation);
          }
          rmSync(`${launcher}.renamed`, { force: true });
        }
      }
      expect(mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
