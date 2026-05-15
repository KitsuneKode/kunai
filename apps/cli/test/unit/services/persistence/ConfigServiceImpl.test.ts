import { describe, expect, test } from "bun:test";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "@/services/persistence/ConfigStore";

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

    await service.update({ defaultMode: "anime", subLang: "interactive", footerHints: "minimal" });
    await service.save();

    expect((await store.load()).defaultMode).toBe("anime");
    expect((await store.load()).subLang).toBe("en");
    expect((await store.load()).footerHints).toBe("minimal");
  });

  test("defaults presence integrations off and persists explicit privacy choices", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);

    expect(service.presenceProvider).toBe("off");
    expect(service.presencePrivacy).toBe("full");

    await service.update({ presenceProvider: "discord", presencePrivacy: "private" });
    await service.save();

    expect((await store.load()).presenceProvider).toBe("discord");
    expect((await store.load()).presencePrivacy).toBe("private");
  });

  test("defaults downloads off and persists the offline path gate", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);

    expect(service.downloadsEnabled).toBe(false);
    expect(service.downloadPath).toBe("");
    expect(service.downloadOnboardingDismissed).toBe(false);
    expect(service.autoDownload).toBe("off");
    expect(service.autoDownloadNextCount).toBe(1);
    expect(service.autoCleanupWatched).toBe(false);
    expect(service.autoCleanupGraceDays).toBe(7);
    expect(service.protectedDownloadJobIds).toEqual([]);
    expect(service.updateChecksEnabled).toBe(true);
    expect(service.updateCheckIntervalDays).toBe(7);
    expect(service.updateSnoozedUntil).toBe(0);

    await service.update({
      downloadsEnabled: true,
      downloadPath: "~/Videos/Kunai",
      downloadOnboardingDismissed: true,
      autoDownload: "next",
      autoDownloadNextCount: 3,
      autoCleanupWatched: true,
      autoCleanupGraceDays: 3,
      protectedDownloadJobIds: ["job-a", "job-a", " job-b "],
      updateChecksEnabled: false,
      updateSnoozedUntil: 123,
    });
    await service.save();

    expect((await store.load()).downloadsEnabled).toBe(true);
    expect((await store.load()).downloadPath).toBe("~/Videos/Kunai");
    expect((await store.load()).downloadOnboardingDismissed).toBe(true);
    expect((await store.load()).autoDownload).toBe("next");
    expect((await store.load()).autoDownloadNextCount).toBe(3);
    expect((await store.load()).autoCleanupWatched).toBe(true);
    expect((await store.load()).autoCleanupGraceDays).toBe(3);
    expect((await store.load()).protectedDownloadJobIds).toEqual(["job-a", "job-b"]);
    expect((await store.load()).updateChecksEnabled).toBe(false);
    expect((await store.load()).updateSnoozedUntil).toBe(123);
  });

  test("clamps auto-download next count on load and update", async () => {
    const store = new MemoryConfigStore({ autoDownloadNextCount: 99 });
    const service = await ConfigServiceImpl.load(store);

    expect(service.autoDownloadNextCount).toBe(24);

    await service.update({ autoDownloadNextCount: 0 });
    await service.save();

    expect((await store.load()).autoDownloadNextCount).toBe(1);
  });

  test("normalizes legacy subtitle defaults back to english on load", async () => {
    const noneService = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        subLang: "none",
      }),
    );
    const fzfService = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        subLang: "fzf",
      }),
    );

    expect(noneService.subLang).toBe("en");
    expect(fzfService.subLang).toBe("en");
  });

  test("migrates legacy profile subtitle preference fzf to interactive", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        animeLanguageProfile: { audio: "original", subtitle: "fzf" },
      }),
    );

    expect(service.animeLanguageProfile.subtitle).toBe("interactive");
  });

  test("round-trips legacy profile subtitle preference as interactive on save", async () => {
    const store = new MemoryConfigStore({
      animeLanguageProfile: { audio: "original", subtitle: "fzf" },
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeLanguageProfile.subtitle).toBe("interactive");

    await service.save();
    const persisted = await store.load();
    expect(persisted.animeLanguageProfile?.subtitle).toBe("interactive");
  });
});
