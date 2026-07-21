import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyReleaseArtifactDirectory } from "../../../../scripts/verify-release-artifact-directory";

const CLI_ROOT = join(import.meta.dirname, "../..");
const BIN_DIR = join(CLI_ROOT, "dist/bin");
const GLIBC_BIN = join(BIN_DIR, "kunai-linux-x64");
const REQUIRE_BINARY = process.env.KUNAI_BINARY_SMOKE === "1";

function runBinary(args: readonly string[]) {
  return spawnSync(GLIBC_BIN, [...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
    },
  });
}

function packageVersion(): string {
  return (JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as { version: string })
    .version;
}

const describeBinary = REQUIRE_BINARY ? describe : describe.skip;

describeBinary("compiled linux binary smoke", () => {
  test("kunai-linux-x64 exists after build:binaries", () => {
    expect(existsSync(GLIBC_BIN)).toBe(true);
  });

  test("prints kunai version (not bun runtime version)", () => {
    const result = runBinary(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^kunai \d+\.\d+\.\d+/);
    expect(result.stdout.trim()).not.toBe("1.3.14");
  });

  test("shows kunai help", () => {
    const result = runBinary(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai");
    expect(result.stdout).not.toContain("Bun is a fast JavaScript runtime");
  });

  test("dist/bin satisfies the exact nine-file release asset contract", async () => {
    await verifyReleaseArtifactDirectory({
      directory: BIN_DIR,
      expectedVersion: packageVersion(),
    });
  });
});
