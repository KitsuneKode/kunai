import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";
import { removeTempDir } from "../support/remove-temp-dir";

// Unit tests pin that parseCliArgs throws CliUsageError; this file pins the
// contract the rest of the world actually sees: the process exit status and
// the stderr a wrapper script can act on. Exit 2 matches `kunai completion`'s
// usage-error code so callers can tell a typo'd flag from a real failure.

const repoRoot = resolve(import.meta.dir, "../../../..");

function runKunai(...argv: string[]): { status: number; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "kunai-usage-err-"));
  try {
    const result = spawnSync("bun", ["apps/cli/src/main.ts", ...argv], {
      cwd: repoRoot,
      env: { ...process.env, ...storageRootEnv(root) },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: result.status ?? -1, stderr: result.stderr ?? "" };
  } finally {
    removeTempDir(root);
  }
}

describe("CLI usage errors exit 2", () => {
  test("an unknown flag exits 2 and points at --help instead of running", () => {
    const { status, stderr } = runKunai("--definitely-not-a-flag");

    expect(status).toBe(2);
    expect(stderr).toContain("kunai:");
    expect(stderr).toContain("--help");
  });

  test("a near-miss maintenance word exits 2 with the suggested command", () => {
    const { status, stderr } = runKunai("doctro");

    expect(status).toBe(2);
    expect(stderr).toContain("doctor");
  });

  test("a malformed -i id exits 2 rather than planning a lookup", () => {
    const { status, stderr } = runKunai("-i", "anilist:abc");

    expect(status).toBe(2);
    expect(stderr).toContain("-i");
  });

  test("known short paths still exit 0", () => {
    const { status } = runKunai("--version");

    expect(status).toBe(0);
  });
});
