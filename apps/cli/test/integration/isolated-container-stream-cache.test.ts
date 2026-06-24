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
    const { container, dispose } = await createIsolatedContainer("bootstrap-smoke");
    disposers.push(dispose);

    expect(container.config).toBeDefined();
    expect(typeof container.config.getRaw).toBe("function");
    expect(container.cacheStore).toBeDefined();
    expect(typeof container.cacheStore.get).toBe("function");
    expect(container.engine).toBeDefined();
    expect(container.engine.getProviderIds().length).toBeGreaterThan(0);
  });
});
