import { describe, expect, test } from "bun:test";

import type { ConfigStore } from "@/services/persistence/ConfigStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";

class MemoryConfigStore implements ConfigStore {
  constructor(private loaded: Partial<KitsuneConfig> = {}) {}

  async load(): Promise<Partial<KitsuneConfig>> {
    return this.loaded;
  }

  async save(config: KitsuneConfig): Promise<void> {
    this.loaded = config;
  }

  async reset(): Promise<void> {
    this.loaded = {};
  }
}

describe("ConfigServiceImpl", () => {
  test("loads the default startup mode when persisted config overrides it", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        defaultMode: "anime",
        provider: "vidking",
        animeProvider: "allanime",
      }),
    );

    expect(service.defaultMode).toBe("anime");
    expect(service.getRaw().defaultMode).toBe("anime");
  });

  test("persists default startup mode updates alongside other preferences", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);

    await service.update({ defaultMode: "anime", subLang: "fzf", footerHints: "minimal" });
    await service.save();

    expect((await store.load()).defaultMode).toBe("anime");
    expect((await store.load()).subLang).toBe("fzf");
    expect((await store.load()).footerHints).toBe("minimal");
  });
});
