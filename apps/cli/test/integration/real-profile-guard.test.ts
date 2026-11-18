import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";

/**
 * The profile guard lives in the test preload, so the only way to prove it is wired is to run a real
 * `bun test` process and look at its exit status. The child's "real" profile is a throwaway
 * directory (every storage variable points there), so nothing of the developer's is involved.
 */
const CLI_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE = resolve(import.meta.dir, "fixtures/profile-guard-touches-profile.test.ts");

describe("real profile guard", () => {
  let fakeProfile: string;

  beforeEach(() => {
    fakeProfile = mkdtempSync(join(tmpdir(), "kunai-guard-profile-"));
  });
  afterEach(() => {
    rmSync(fakeProfile, { recursive: true, force: true });
  });

  function runFixture(mode: "leak" | "clean", skipGuard = false) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...storageRootEnv(fakeProfile),
      KUNAI_PROFILE_GUARD_FIXTURE: mode,
    };
    // A developer who exports the skip switch must not make the "guard fires" case pass vacuously.
    delete env.KUNAI_TEST_SKIP_PROFILE_GUARD;
    if (skipGuard) env.KUNAI_TEST_SKIP_PROFILE_GUARD = "1";

    const result = spawnSync(process.execPath, ["test", FIXTURE], {
      cwd: CLI_ROOT,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  test("a run that does not touch the profile passes", () => {
    const { status, output } = runFixture("clean");
    expect(output).toContain("1 pass");
    expect(status).toBe(0);
  });

  test("a run that writes the profile fails, and names the file", () => {
    const { status, output } = runFixture("leak");
    expect(output).toContain("changed your real Kunai profile");
    expect(output).toContain("leaked.json");
    expect(status).not.toBe(0);
  });

  test("the skip switch silences it", () => {
    const { status, output } = runFixture("leak", true);
    expect(output).not.toContain("changed your real Kunai profile");
    expect(status).toBe(0);
  });
});
