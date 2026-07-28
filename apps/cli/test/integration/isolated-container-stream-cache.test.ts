import { afterEach, describe, expect, test } from "bun:test";

import { createIsolatedContainer } from "./helpers/isolated-container";

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
});

describe("isolated container integration", () => {
  test("bootstraps real config and cache store on an isolated profile", async () => {
    const { container, profile, dispose } = await createIsolatedContainer("bootstrap-smoke");
    disposers.push(dispose);

    expect(container.config).toBeDefined();
    expect(typeof container.config.getRaw).toBe("function");
    expect(container.cacheStore).toBeDefined();
    expect(typeof container.cacheStore.get).toBe("function");
    expect(container.engine).toBeDefined();
    expect(container.engine.getProviderIds().length).toBeGreaterThan(0);

    // Isolation must land under the temp root on every platform — darwin uses
    // $HOME/Library/... so XDG-only profiles used to miss and touch the real
    // user Library tree while this smoke still passed.
    expect(profile.paths.configDir.startsWith(profile.rootDir)).toBe(true);
    expect(profile.paths.dataDir.startsWith(profile.rootDir)).toBe(true);
    expect(profile.paths.cacheDir.startsWith(profile.rootDir)).toBe(true);
    expect(profile.paths.dataDbPath.startsWith(profile.rootDir)).toBe(true);
    expect(profile.paths.configPath.startsWith(profile.rootDir)).toBe(true);
  });
});
