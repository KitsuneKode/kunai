import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/**
 * Driven by test/integration/real-profile-guard.test.ts in a child process
 * whose "real" profile is a throwaway directory. On its own it does nothing,
 * so a bare `bun test` stays quiet.
 *
 * `paths` is resolved at module scope deliberately: proving the storage
 * preload ran before test modules loaded is part of what "sandbox" verifies —
 * a preload that forgot would capture the inherited profile instead.
 */
// oxlint-disable-next-line anti-slop/no-module-load-env-read -- deliberate: the module-load read is the probe this fixture exists to make
const paths = getKunaiPaths();

test("optionally writes into the profile it was started with", () => {
  const mode = process.env.KUNAI_PROFILE_GUARD_FIXTURE;
  if (mode === undefined) return;

  if (mode === "sandbox") {
    const home = process.env.HOME;
    if (home === undefined) throw new Error("the storage preload must install HOME");
    expect(paths.configPath).toBe(join(home, "profile", "config", "config.json"));
    expect(process.env.KUNAI_CONFIG_DIR).toBe(join(home, "profile"));
    for (const key of [
      "USERPROFILE",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "APPDATA",
      "LOCALAPPDATA",
    ]) {
      expect(process.env[key]).toBe(home);
    }
    const leaked = join(paths.configDir, "leaked.json");
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(leaked, "[]");
    console.log(`SANDBOX=${paths.configDir}`);
    expect(existsSync(leaked)).toBe(true);
  }

  if (mode === "leak") {
    const target = process.env.KUNAI_PROFILE_GUARD_FIXTURE_TARGET;
    if (!target) {
      throw new Error("leak mode requires KUNAI_PROFILE_GUARD_FIXTURE_TARGET");
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "[]");
  }
  expect(["leak", "sandbox", "clean"]).toContain(mode);
});
