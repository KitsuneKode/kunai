import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";

// The PATH shell shim is POSIX-only. Windows uses the portable policy tests;
// native Windows launcher qualification remains a separate gate.
const playerTest = process.platform === "win32" ? test.skip : test;

async function run(scenario: string) {
  const root = mkdtempSync(join(tmpdir(), "kunai-local-preflight-"));
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "fixtures/local-player-preflight.ts"), scenario],
      {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, ...storageRootEnv(root) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const record = stdout.split("\n").find((line) => line.startsWith("RESULT "));
    if (!record) throw new Error("missing launcher result: " + stderr);
    return JSON.parse(record.slice(7));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
}

playerTest(
  "one-shot verified local target reaches IPC progress and EOF without HTTP preflight",
  async () => {
    const report = await run("local");
    expect(report.network).toBe(0);
    expect(report.result).toMatchObject({ endReason: "eof", playerExitCode: 0 });
    expect(report.result.lastNonZeroPositionSeconds).toBeGreaterThan(0);
  },
);

playerTest("untrusted file path remains rejected before launching a player", async () => {
  const report = await run("untrusted-file");
  expect(report.error).toBe("MpvLaunchError");
  expect(report.network).toBe(0);
});

for (const scenario of ["remote", "remote-local-kind"]) {
  playerTest(`${scenario}: definite HTTP failure still stops playback`, async () => {
    const report = await run(scenario);
    expect(report.network).toBeGreaterThan(0);
    expect(report.result.endReason).toBe("error");
    expect(report.result.watchedSeconds).toBe(0);
  });
}
