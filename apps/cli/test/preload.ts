import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyStorageRootEnv } from "./helpers/storage-env";

/** Block xdg-open / browser spawns during `bun test` unless a test opts out explicitly. */
process.env.KUNAI_DISABLE_EXTERNAL_URL ??= "1";

/**
 * Every `bun test` process gets its own throwaway storage roots, so a test that does not isolate
 * itself still cannot reach the developer's real config, data or cache. Tests that need a specific
 * root keep calling `applyStorageRootEnv`; it restores to this sandbox, not to the real profile.
 *
 * Before this, BrowseShell's own test saved "Bojack Horseman" into the real search history on every
 * run, and only in multi-file runs: a lone file exits before the async write lands.
 */
const sandbox = mkdtempSync(join(tmpdir(), "kunai-test-profile-"));
applyStorageRootEnv(sandbox);
process.on("exit", () => {
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup of a temp directory; a leftover one is harmless.
  }
});
