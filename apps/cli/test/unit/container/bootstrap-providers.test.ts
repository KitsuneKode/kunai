import { describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import { DEFAULT_CONFIG } from "@kunai/config";

describe("production provider defaults", () => {
  test("every configured lane default is a registered production module", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const ids = modules.map((module) => module.providerId);

    expect(DEFAULT_CONFIG.provider).toBe("videasy");
    expect(DEFAULT_CONFIG.animeProvider).toBe("anidb");
    expect(ids).toContain(DEFAULT_CONFIG.provider);
    expect(ids).toContain(DEFAULT_CONFIG.animeProvider);
    expect(ids).toContain(DEFAULT_CONFIG.youtubeProvider);
  });
});
