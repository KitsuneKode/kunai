import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { getKunaiPaths } from "@kunai/storage";

// test/preload.ts gives every `bun test` process its own throwaway storage roots. Without it, any
// test that mounts a shell or boots a service without isolating itself writes the developer's real
// config, data and cache (BrowseShell saves the query it submits to search history, for one).
test("a test process never resolves the developer's real storage roots", () => {
  const paths = getKunaiPaths();
  for (const root of [paths.configDir, paths.dataDir, paths.cacheDir]) {
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(root).toContain("kunai-test-profile-");
  }
});
