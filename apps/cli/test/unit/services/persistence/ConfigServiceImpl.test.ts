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

  test("defaults startup priority to balanced and persists fast", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);

    expect(service.startupPriority).toBe("balanced");

    await service.update({ startupPriority: "fast" });
    await service.save();

    expect((await store.load()).startupPriority).toBe("fast");
  });

  test("normalizes provider priority lists on load and update", async () => {
    const store = new MemoryConfigStore({
      providerPriority: [" vidking ", "rivestream", "vidking", ""],
      animeProviderPriority: [" miruro ", "allanime", "miruro"],
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.providerPriority).toEqual(["videasy", "rivestream"]);
    expect(service.animeProviderPriority).toEqual(["miruro", "allanime"]);

    await service.update({
      providerPriority: ["vidlink", " vidking ", "vidlink"],
      animeProviderPriority: ["allanime", " miruro "],
    });
    await service.save();

    expect((await store.load()).providerPriority).toEqual(["vidlink", "videasy"]);
    expect((await store.load()).animeProviderPriority).toEqual(["allanime", "miruro"]);
  });

  test("normalizes invalid stored startup priority to balanced", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        startupPriority: "turbo" as never,
      }),
    );

    expect(service.startupPriority).toBe("balanced");
    expect(service.getRaw().startupPriority).toBe("balanced");
  });

  test("caps persisted same-url mpv reconnect attempts to avoid dead-stream loops", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        mpvInProcessStreamReconnectMaxAttempts: 3,
      }),
    );

    expect(service.mpvInProcessStreamReconnectMaxAttempts).toBe(1);
    expect(service.getRaw().mpvInProcessStreamReconnectMaxAttempts).toBe(1);
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
    expect(service.recoveryMode).toBe("guided");
    expect(service.artworkPreviewsEnabled).toBe(true);
    expect(service.offlineArtworkCacheEnabled).toBe(true);
    expect(service.offlineFreeSpaceReserveBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(service.offlineUnknownEpisodeEstimateBytes).toBe(768 * 1024 * 1024);
    expect(service.offlineDefaultRunwayTarget).toBe(2);
    expect(service.powerSaverMode).toBe(false);
    expect(service.powerSaverAllowManualArtwork).toBe(true);
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
      recoveryMode: "fallback-first",
      artworkPreviewsEnabled: false,
      offlineArtworkCacheEnabled: false,
      offlineFreeSpaceReserveBytes: 100,
      offlineUnknownEpisodeEstimateBytes: 200,
      offlineDefaultRunwayTarget: 5,
      powerSaverMode: true,
      powerSaverAllowManualArtwork: false,
      autoCleanupGraceDays: 3,
      protectedDownloadJobIds: ["job-a", "job-a", " job-b "],
      updateChecksEnabled: false,
      updateSnoozedUntil: 123,
    });
    await service.save();

    expect((await store.load()).downloadsEnabled).toBe(true);
    expect((await store.load()).downloadPath).toBe("~/Videos/Kunai");
    expect((await store.load()).downloadOnboardingDismissed).toBe(true);
    expect((await store.load()).autoDownload).toBe("off");
    expect((await store.load()).autoDownloadNextCount).toBe(3);
    expect((await store.load()).autoCleanupWatched).toBe(true);
    expect((await store.load()).recoveryMode).toBe("fallback-first");
    expect((await store.load()).artworkPreviewsEnabled).toBe(false);
    expect((await store.load()).offlineArtworkCacheEnabled).toBe(false);
    expect((await store.load()).offlineFreeSpaceReserveBytes).toBe(100);
    expect((await store.load()).offlineUnknownEpisodeEstimateBytes).toBe(200);
    expect((await store.load()).offlineDefaultRunwayTarget).toBe(5);
    expect((await store.load()).powerSaverMode).toBe(true);
    expect((await store.load()).powerSaverAllowManualArtwork).toBe(false);
    expect((await store.load()).autoCleanupGraceDays).toBe(3);
    expect((await store.load()).protectedDownloadJobIds).toEqual(["job-a", "job-b"]);
    expect((await store.load()).updateChecksEnabled).toBe(false);
    expect((await store.load()).updateSnoozedUntil).toBe(123);
  });

  test("normalizes unknown recovery modes to guided", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        recoveryMode: "surprise-me" as never,
      }),
    );

    expect(service.recoveryMode).toBe("guided");
  });

  test("clamps auto-download next count on load and update", async () => {
    const store = new MemoryConfigStore({ autoDownloadNextCount: 99 });
    const service = await ConfigServiceImpl.load(store);

    expect(service.autoDownloadNextCount).toBe(24);

    await service.update({ autoDownloadNextCount: 0 });
    await service.save();

    expect((await store.load()).autoDownloadNextCount).toBe(1);
  });

  test("disables legacy streaming auto-download authority on load and update", async () => {
    const store = new MemoryConfigStore({ autoDownload: "season" });
    const service = await ConfigServiceImpl.load(store);

    expect(service.autoDownload).toBe("off");

    await service.update({ autoDownload: "next" });
    await service.save();

    expect((await store.load()).autoDownload).toBe("off");
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

  test("normalizes media quality preferences on load and update", async () => {
    const store = new MemoryConfigStore({
      animeLanguageProfile: { audio: "original", subtitle: "en", quality: " 1080P " },
      seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "" },
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeLanguageProfile.quality).toBe("1080p");
    expect(service.seriesLanguageProfile.quality).toBe("best");

    await service.update({
      movieLanguageProfile: { audio: "original", subtitle: "en", quality: "720P" },
    });
    await service.save();

    expect((await store.load()).movieLanguageProfile?.quality).toBe("720p");
  });

  test("migrates legacy videasy app id to cineplay when no session token is paired", async () => {
    const store = new MemoryConfigStore({
      videasyAppId: "vidking",
      videasySessionToken: "",
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.videasyAppId).toBe("bc-frontend");
    expect(service.getRaw().videasyAppId).toBe("bc-frontend");
    expect((await store.load()).videasyAppId).toBe("bc-frontend");
  });

  test("keeps videasy app id vidking when a session token is paired", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        videasyAppId: "vidking",
        videasySessionToken: "paired-session",
      }),
    );

    expect(service.videasyAppId).toBe("vidking");
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
