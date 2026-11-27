import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

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

  function runFixture(
    mode: "leak" | "sandbox" | "clean",
    skipGuard = false,
    extraArgs: string[] = [],
    leakTarget?: string,
  ) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...storageRootEnv(fakeProfile),
      KUNAI_PROFILE_GUARD_FIXTURE: mode,
    };
    // A developer who exports the skip switch must not make the "guard fires" case pass vacuously.
    delete env.KUNAI_TEST_SKIP_PROFILE_GUARD;
    if (skipGuard) env.KUNAI_TEST_SKIP_PROFILE_GUARD = "1";
    if (leakTarget === undefined) delete env.KUNAI_PROFILE_GUARD_FIXTURE_TARGET;
    else env.KUNAI_PROFILE_GUARD_FIXTURE_TARGET = leakTarget;

    const result = spawnSync(process.execPath, ["test", ...extraArgs, FIXTURE], {
      cwd: CLI_ROOT,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  test("a run that does not touch the profile passes, and the guard creates nothing", () => {
    const { status, output } = runFixture("clean");
    expect(output).toContain("1 pass");
    expect(status).toBe(0);
    // The guard only stats. An absent profile must stay absent.
    const paths = getKunaiPaths({ env: storageRootEnv(fakeProfile) });
    for (const dir of [paths.configDir, paths.dataDir, paths.cacheDir]) {
      expect(existsSync(dir)).toBe(false);
    }
  });

  test("the preload moves storage to its own throwaway profile before test code runs", () => {
    const { status, output } = runFixture("sandbox");
    expect(output).toContain("1 pass");
    expect(status).toBe(0);
    // The fixture reported the config dir it was handed at module scope: a
    // fresh absolute sibling in the OS tmp, never the inherited fakeProfile.
    const sandbox = /^SANDBOX=(.+)$/m.exec(output)?.[1]?.trim();
    if (sandbox === undefined) throw new Error("the fixture did not report its sandbox");
    expect(isAbsolute(sandbox)).toBe(true);
    expect(sandbox).toContain("kunai-test-profile-");
    expect(sandbox.startsWith(fakeProfile)).toBe(false);
    // The child's sandbox is gone once the child exits.
    expect(existsSync(sandbox)).toBe(false);
    // Nothing in the run created the inherited profile it could have leaked into.
    const paths = getKunaiPaths({ env: storageRootEnv(fakeProfile) });
    for (const dir of [paths.configDir, paths.dataDir, paths.cacheDir]) {
      expect(existsSync(dir)).toBe(false);
    }
  });

  test("a populated profile that nothing touches passes", () => {
    const paths = getKunaiPaths({ env: storageRootEnv(fakeProfile) });
    for (const file of [
      paths.configPath,
      paths.mpvBridgePath,
      paths.dataDbPath,
      paths.cacheDbPath,
    ]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "x");
    }
    const { status, output } = runFixture("clean");
    expect(output).not.toContain("changed your real Kunai profile");
    expect(status).toBe(0);
  });

  test("a run that writes the profile fails, and names the file", () => {
    const { status, output } = runFixture(
      "leak",
      false,
      [],
      join(fakeProfile, "profile", "config", "leaked.json"),
    );
    expect(output).toContain("changed your real Kunai profile");
    expect(output).toContain("leaked.json");
    expect(status).not.toBe(0);
  });

  test("a write through the platform default layout fails while an override is inherited", () => {
    // The guard watches the default layout as well as the override profile:
    // the inherited env resolves its platform-default config under the fake
    // storage roots once KUNAI_CONFIG_DIR is dropped.
    const defaultEnv = storageRootEnv(fakeProfile);
    delete defaultEnv.KUNAI_CONFIG_DIR;
    const target = join(getKunaiPaths({ env: defaultEnv }).configDir, "leaked.json");
    const { status, output } = runFixture("leak", false, [], target);
    expect(output).toContain("changed your real Kunai profile");
    expect(output).toContain("leaked.json");
    expect(status).not.toBe(0);
  });

  test("a parallel run that writes the profile fails too", () => {
    const { status, output } = runFixture(
      "leak",
      false,
      ["--parallel=2"],
      join(fakeProfile, "profile", "config", "leaked.json"),
    );
    expect(output).toContain("changed your real Kunai profile");
    expect(output).toContain("leaked.json");
    expect(status).not.toBe(0);
  });

  test("the skip switch silences it", () => {
    const { status, output } = runFixture(
      "leak",
      true,
      [],
      join(fakeProfile, "profile", "config", "leaked.json"),
    );
    expect(output).not.toContain("changed your real Kunai profile");
    expect(status).toBe(0);
  });
});
