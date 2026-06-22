import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const CLI_ROOT = join(REPO_ROOT, "apps/cli");
const RUN_LOCAL = join(CLI_ROOT, "test/docker/native-installer/run-local.sh");
const GLIBC_BIN = join(CLI_ROOT, "dist/bin/kunai-linux-x64");

function dockerAvailable(): boolean {
  const result = spawnSync("docker", ["info"], { encoding: "utf8" });
  return result.status === 0;
}

const RUN_INSTALLER_DOCKER = process.env.KUNAI_INSTALLER_DOCKER === "1";
const describeDocker = RUN_INSTALLER_DOCKER && dockerAvailable() ? describe : describe.skip;

describeDocker("native installer docker smoke", () => {
  test("install.sh, upgrade, and uninstall work in isolated containers", () => {
    const skipBuild = existsSync(GLIBC_BIN) ? ["--skip-build", "--skip-image-build"] : [];
    const result = spawnSync("bash", [RUN_LOCAL, ...skipBuild], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 600_000,
      env: {
        ...process.env,
        KUNAI_CONFIG_DIR: undefined,
        KUNAI_BIN_DIR: undefined,
      },
    });

    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Native installer smoke (glibc) passed");
    expect(result.stdout).toContain("Native installer smoke (musl) passed");
  }, 600_000);
});
