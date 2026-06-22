import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

describe("install.sh dry-run", () => {
  test("prints the binary install plan without downloading", () => {
    const result = spawnSync("bash", [join(REPO_ROOT, "install.sh"), "--dry-run", "--yes"], {
      encoding: "utf8",
      env: {
        ...process.env,
        KUNAI_BIN_DIR: "/tmp/kunai-test-bin",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai installer");
    expect(result.stdout).toContain("Downloading kunai-");
    expect(result.stdout).toContain("versions/");
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stderr).toBe("");
  });

  test("honors pinned --version in dry-run output", () => {
    const result = spawnSync(
      "bash",
      [join(REPO_ROOT, "install.sh"), "--dry-run", "--yes", "--version", "9.8.7"],
      {
        encoding: "utf8",
        env: { ...process.env, KUNAI_BIN_DIR: "/tmp/kunai-test-bin" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v9.8.7");
  });

  test("rejects lifecycle flags — use kunai upgrade / kunai uninstall instead", () => {
    const uninstall = spawnSync("bash", [join(REPO_ROOT, "install.sh"), "--uninstall"], {
      encoding: "utf8",
    });
    expect(uninstall.status).not.toBe(0);
    expect(uninstall.stderr).toContain("Unknown option");

    const upgrade = spawnSync("bash", [join(REPO_ROOT, "install.sh"), "--upgrade"], {
      encoding: "utf8",
    });
    expect(upgrade.status).not.toBe(0);
    expect(upgrade.stderr).toContain("Unknown option");
  });
});
