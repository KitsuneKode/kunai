import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

/**
 * Driven by test/integration/real-profile-guard.test.ts in a child process whose "real" profile is
 * a throwaway directory. On its own it does nothing, so a bare `bun test` stays quiet.
 */
test("optionally writes into the profile it was started with", () => {
  const mode = process.env.KUNAI_PROFILE_GUARD_FIXTURE;
  if (mode === undefined) return;

  if (mode === "leak") {
    const { configDir } = getKunaiPaths();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "leaked.json"), "[]");
  }
  expect(["leak", "clean"]).toContain(mode);
});
