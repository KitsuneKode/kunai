import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type ConfigStore } from "@/services/persistence/ConfigStore";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";
import { isJsonNumber, isJsonObject, isJsonString } from "@kunai/types";

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
  test("migrates a pre-opt-in analytics preference to unset and clears its legacy id", async () => {
    const store = new MemoryConfigStore({ analytics: "enabled", installId: "legacy-install-id" });
    const service = await ConfigServiceImpl.load(store);

    expect(service.analytics).toBe("unset");
    expect(service.installId).toBe("");
    expect(service.analyticsNoticeShown).toBe(false);
    expect((await store.load()).installId).toBe("");
  });

  test("repairs and persists an orphan install id for every non-enabled preference", async () => {
    for (const analytics of ["disabled", "unset"] as const) {
      const store = new MemoryConfigStore({
        analytics,
        analyticsNoticeShown: false,
        installId: `${analytics}-orphan-id`,
      });

      const service = await ConfigServiceImpl.load(store);

      expect(service.analytics).toBe(analytics);
      expect(service.installId).toBe("");
      expect((await store.load()).installId).toBe("");
    }
  });

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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
    expect(service.autoCleanupWatched).toBe(false);
    expect(service.recoveryMode).toBe("guided");
    expect(service.artworkPreviewsEnabled).toBe(true);
    expect(service.offlineArtworkCacheEnabled).toBe(true);
    expect(service.offlineFreeSpaceReserveBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(service.offlineUnknownEpisodeEstimateBytes).toBe(768 * 1024 * 1024);
    expect(service.offlineDefaultRunwayTarget).toBe(2);
    expect(service.powerSaverMode).toBe(false);
    expect(service.autoCleanupGraceDays).toBe(7);
    expect(service.protectedDownloadJobIds).toEqual([]);
    expect(service.updateChecksEnabled).toBe(true);
    expect(service.updateCheckIntervalDays).toBe(7);
    expect(service.updateSnoozedUntil).toBe(0);

    await service.update({
      downloadsEnabled: true,
      downloadPath: "~/Videos/Kunai",
      downloadOnboardingDismissed: true,
      autoCleanupWatched: true,
      recoveryMode: "fallback-first",
      artworkPreviewsEnabled: false,
      offlineArtworkCacheEnabled: false,
      offlineFreeSpaceReserveBytes: 100,
      offlineUnknownEpisodeEstimateBytes: 200,
      offlineDefaultRunwayTarget: 5,
      powerSaverMode: true,
      autoCleanupGraceDays: 3,
      protectedDownloadJobIds: ["job-a", "job-a", " job-b "],
      updateChecksEnabled: false,
      updateSnoozedUntil: 123,
    });
    await service.save();

    expect((await store.load()).downloadsEnabled).toBe(true);
    expect((await store.load()).downloadPath).toBe("~/Videos/Kunai");
    expect((await store.load()).downloadOnboardingDismissed).toBe(true);
    expect((await store.load()).autoCleanupWatched).toBe(true);
    expect((await store.load()).recoveryMode).toBe("fallback-first");
    expect((await store.load()).artworkPreviewsEnabled).toBe(false);
    expect((await store.load()).offlineArtworkCacheEnabled).toBe(false);
    expect((await store.load()).offlineFreeSpaceReserveBytes).toBe(100);
    expect((await store.load()).offlineUnknownEpisodeEstimateBytes).toBe(200);
    expect((await store.load()).offlineDefaultRunwayTarget).toBe(5);
    expect((await store.load()).powerSaverMode).toBe(true);
    expect((await store.load()).autoCleanupGraceDays).toBe(3);
    expect((await store.load()).protectedDownloadJobIds).toEqual(["job-a", "job-b"]);
    expect((await store.load()).updateChecksEnabled).toBe(false);
    expect((await store.load()).updateSnoozedUntil).toBe(123);
  });

  test("normalizes unknown recovery modes to guided", async () => {
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        recoveryMode: "surprise-me" as never,
      }),
    );

    expect(service.recoveryMode).toBe("guided");
  });

  test("legacy config files with retired keys still load and get scrubbed on save", async () => {
    // autoDownload / autoDownloadNextCount / powerSaverAllowManualArtwork were
    // removed from KitsuneConfig after never gaining a runtime reader. A file
    // written by an older build must still parse, must not surface them on the
    // typed config, and must not carry them into the next persisted shape.
    const store = new MemoryConfigStore({
      autoDownload: "season",
      autoDownloadNextCount: 9,
      powerSaverAllowManualArtwork: false,
      subLang: "jpn",
    } as Partial<KitsuneConfig>);
    const service = await ConfigServiceImpl.load(store);

    expect(service.subLang).toBe("jpn");
    expect("autoDownload" in service.getRaw()).toBe(false);
    expect("autoDownloadNextCount" in service.getRaw()).toBe(false);
    expect("powerSaverAllowManualArtwork" in service.getRaw()).toBe(false);

    // load() resaves immediately when retired keys were dropped, so the file
    // is already scrubbed — no update/save cycle needed. The `in` check reads
    // the raw object shape, which is the point: these keys aren't in
    // `KitsuneConfig`, so a typed accessor could never see them.
    const persisted = await store.load();
    expect("autoDownload" in persisted).toBe(false);
    expect("autoDownloadNextCount" in persisted).toBe(false);
    expect("powerSaverAllowManualArtwork" in persisted).toBe(false);
    expect(persisted.subLang).toBe("jpn");
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

  test("moves an inherited AniDB anime default to HiAnime, keeping the rest behind it", async () => {
    // ConfigStore saves the whole merged config, so this pair sits on disk for
    // every user who saved any setting while AniDB was the shipped default.
    const store = new MemoryConfigStore({
      animeProvider: "anidb",
      animeProviderPriority: ["anidb"],
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("hianime");
    expect(service.animeProviderPriority).toEqual([
      "miruro",
      "kickassanime",
      "animegg",
      "anidb",
      "allanime",
    ]);
    const persisted = await store.load();
    expect(persisted.animeProvider).toBe("hianime");
    expect(persisted.animeProviderPriority).toEqual([
      "miruro",
      "kickassanime",
      "animegg",
      "anidb",
      "allanime",
    ]);
    expect(persisted.providerDefaultsRevision).toBe(3);
  });

  test("moves inherited Miruro defaults from revisions 1 and 2 to HiAnime", async () => {
    // Revision 1's list grew twice across stacked changes, and revision 2 added
    // the independent backends; a build released between any of them left one
    // of these on disk.
    for (const [revision, inherited] of [
      [1, ["miruro", "anidb", "allanime"]],
      [1, ["miruro", "animegg", "anidb", "allanime"]],
      [2, ["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
    ] as const) {
      const store = new MemoryConfigStore({
        animeProvider: "miruro",
        animeProviderPriority: inherited,
        providerDefaultsRevision: revision,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual([
        "miruro",
        "kickassanime",
        "animegg",
        "anidb",
        "allanime",
      ]);
      expect((await store.load()).providerDefaultsRevision).toBe(3);
    }
  });

  test("a revision-1 user who went back to AniDB keeps it", async () => {
    // The revision-0 pair is inherited only at revision 0; at revision 1 it is
    // a choice made after the first migration.
    const store = new MemoryConfigStore({
      animeProvider: "anidb",
      animeProviderPriority: ["anidb"],
      providerDefaultsRevision: 1,
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("anidb");
    expect(service.animeProviderPriority).toEqual(["anidb"]);
  });

  test("a revision-1 list the user reordered is left alone", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "miruro",
      animeProviderPriority: ["miruro", "allanime", "anidb"],
      providerDefaultsRevision: 1,
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProviderPriority).toEqual(["miruro", "allanime", "anidb"]);
  });

  test("moves an AniDB default that predates the priority list", async () => {
    const store = new MemoryConfigStore({ animeProvider: "anidb" });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("hianime");
    expect(service.animeProviderPriority).toEqual([
      "miruro",
      "kickassanime",
      "animegg",
      "anidb",
      "allanime",
    ]);
  });

  test("leaves an anime lane the user customised alone, and does not write", async () => {
    for (const loaded of [
      { animeProvider: "allanime", animeProviderPriority: ["allanime", "anidb"] },
      // AniDB first is still a choice once the priority list was edited — the
      // pair must be one no shipped default ever wrote, or it migrates.
      { animeProvider: "anidb", animeProviderPriority: ["anidb", "miruro", "allanime"] },
    ]) {
      const store = new MemoryConfigStore(loaded);
      const before = await store.load();
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe(loaded.animeProvider);
      expect(service.animeProviderPriority).toEqual(loaded.animeProviderPriority);
      expect(await store.load()).toBe(before);
    }
  });

  test("a user can choose AniDB again after the migration without it being undone", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "anidb",
      animeProviderPriority: ["anidb"],
    });
    const service = await ConfigServiceImpl.load(store);
    expect(service.animeProvider).toBe("hianime");

    await service.update({ animeProvider: "anidb", animeProviderPriority: ["anidb"] });
    await service.save();

    const reloaded = await ConfigServiceImpl.load(store);
    expect(reloaded.animeProvider).toBe("anidb");
    expect(reloaded.animeProviderPriority).toEqual(["anidb"]);
  });

  test("a fresh install starts on HiAnime without writing a config file", async () => {
    const store = new MemoryConfigStore({});
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("hianime");
    expect(await store.load()).toEqual({});
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

  describe("provider defaults revision", () => {
    // save() persists the whole merged config, so the shipped anime default sits
    // on disk looking like a user choice. The revision stamp lets load() move
    // only configs still carrying a previously shipped pair to the current
    // defaults — exactly once.

    test("moves an un-stamped config on a shipped anidb pair to the current defaults", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe(DEFAULT_CONFIG.animeProvider);
      expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
      const persisted = await store.load();
      expect(persisted.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
      expect(persisted.providerDefaultsRevision).toBe(DEFAULT_CONFIG.providerDefaultsRevision);
    });

    test("migrates every pair shape anidb-era defaults shipped", async () => {
      for (const priority of [undefined, ["anidb"], ["anidb", "allanime"]]) {
        const store = new MemoryConfigStore({
          animeProvider: "anidb",
          ...(priority && { animeProviderPriority: priority }),
        });
        const service = await ConfigServiceImpl.load(store);

        expect(service.animeProvider).toBe(DEFAULT_CONFIG.animeProvider);
        expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
      }
    });

    test("leaves a deliberate anime provider pick alone but stamps the revision", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "allanime",
        animeProviderPriority: ["allanime", "miruro", "anidb"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("allanime");
      expect(service.animeProviderPriority).toEqual(["allanime", "miruro", "anidb"]);
      expect(service.getRaw().providerDefaultsRevision).toBe(
        DEFAULT_CONFIG.providerDefaultsRevision,
      );
    });

    test("leaves a reordered list headed by anidb alone", async () => {
      // A reorder write puts the pick first and the rest of the full list after
      // it — distinguishable from every pair a default ever wrote.
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["allanime", "miruro"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("anidb");
      expect(service.animeProviderPriority).toEqual(["allanime", "miruro"]);
    });

    test("does not re-migrate a stamped config whose user re-picked the old default", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
        providerDefaultsRevision: DEFAULT_CONFIG.providerDefaultsRevision,
      });
      await ConfigServiceImpl.load(store);

      // The stamp means load() treats the pair as a user choice: no migration
      // write fired — the store still holds exactly what it was given.
      const persisted = await store.load();
      expect(persisted.animeProvider).toBe("anidb");
      expect(persisted.animeProviderPriority).toEqual(["anidb"]);
    });

    test("moves every revision-1/2 miruro default pair to the current defaults", async () => {
      for (const [revision, inherited] of [
        [1, ["miruro", "anidb", "allanime"]],
        [1, ["miruro", "animegg", "anidb", "allanime"]],
        [2, ["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
      ] as const) {
        const store = new MemoryConfigStore({
          animeProvider: "miruro",
          animeProviderPriority: [...inherited],
          providerDefaultsRevision: revision,
        });
        const service = await ConfigServiceImpl.load(store);

        expect(service.animeProvider).toBe(DEFAULT_CONFIG.animeProvider);
        expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
        expect((await store.load()).providerDefaultsRevision).toBe(
          DEFAULT_CONFIG.providerDefaultsRevision,
        );
      }
    });

    test("a stamped user who re-picked AniDB at revision 1 keeps it", async () => {
      // The revision-0 pair is inherited only at revision 0; at revision 1 it is
      // a choice made after the first migration.
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
        providerDefaultsRevision: 1,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("anidb");
      expect(service.animeProviderPriority).toEqual(["anidb"]);
    });

    test("moves an un-stamped config on the shipped videasy pair to the current defaults", async () => {
      const store = new MemoryConfigStore({
        provider: "videasy",
        providerPriority: ["rivestream", "vidlink"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe(DEFAULT_CONFIG.provider);
      expect(service.providerPriority).toEqual([...DEFAULT_CONFIG.providerPriority]);
      const persisted = await store.load();
      expect(persisted.provider).toBe(DEFAULT_CONFIG.provider);
      expect(persisted.providerPriority).toEqual([...DEFAULT_CONFIG.providerPriority]);
      expect(persisted.providerDefaultsRevision).toBe(DEFAULT_CONFIG.providerDefaultsRevision);
    });

    test("migrates every pair shape videasy-era defaults shipped", async () => {
      for (const priority of [undefined, ["rivestream", "vidlink"]]) {
        const store = new MemoryConfigStore({
          provider: "videasy",
          ...(priority && { providerPriority: priority }),
        });
        const service = await ConfigServiceImpl.load(store);

        expect(service.provider).toBe(DEFAULT_CONFIG.provider);
        expect(service.providerPriority).toEqual([...DEFAULT_CONFIG.providerPriority]);
      }
    });

    test("migrates a vidking-era provider id as an inherited videasy default", async () => {
      const store = new MemoryConfigStore({
        provider: "vidking",
        providerPriority: ["rivestream", "vidlink"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe(DEFAULT_CONFIG.provider);
      expect(service.providerPriority).toEqual([...DEFAULT_CONFIG.providerPriority]);
    });

    test("leaves a deliberate series provider pick alone but stamps the revision", async () => {
      const store = new MemoryConfigStore({
        provider: "rivestream",
        providerPriority: ["vidlink", "videasy"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe("rivestream");
      expect(service.providerPriority).toEqual(["vidlink", "videasy"]);
      expect(service.getRaw().providerDefaultsRevision).toBe(
        DEFAULT_CONFIG.providerDefaultsRevision,
      );
    });

    test("leaves a reordered series list headed by videasy alone", async () => {
      const store = new MemoryConfigStore({
        provider: "videasy",
        providerPriority: ["vidlink", "rivestream"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe("videasy");
      expect(service.providerPriority).toEqual(["vidlink", "rivestream"]);
    });

    test("does not re-migrate a stamped config whose user re-picked videasy", async () => {
      const store = new MemoryConfigStore({
        provider: "videasy",
        providerPriority: ["rivestream", "vidlink"],
        providerDefaultsRevision: DEFAULT_CONFIG.providerDefaultsRevision,
      });
      await ConfigServiceImpl.load(store);

      const persisted = await store.load();
      expect(persisted.provider).toBe("videasy");
      expect(persisted.providerPriority).toEqual(["rivestream", "vidlink"]);
    });

    test("the lanes migrate independently — one deliberate pick does not shield the other lane", async () => {
      const store = new MemoryConfigStore({
        // Inherited series pair + a deliberate anime pick: only series moves.
        provider: "videasy",
        providerPriority: ["rivestream", "vidlink"],
        animeProvider: "allanime",
        animeProviderPriority: ["allanime", "miruro"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe(DEFAULT_CONFIG.provider);
      expect(service.animeProvider).toBe("allanime");

      const second = new MemoryConfigStore({
        // Deliberate series pick + inherited anime pair: only anime moves.
        provider: "rivestream",
        providerPriority: ["rivestream", "vidlink"],
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
      });
      const secondService = await ConfigServiceImpl.load(second);

      expect(secondService.provider).toBe("rivestream");
      expect(secondService.animeProvider).toBe(DEFAULT_CONFIG.animeProvider);
    });
  });
});

describe("youtubeMetadata normalization", () => {
  // The normalizer rebuilds this object from an allow-list, so a key it does not
  // name is not merely ignored — load() drops it and the next save() writes the
  // stripped object back over config.json, destroying what the user typed.
  test("keeps every credential field across a load/save round trip", async () => {
    const store = new MemoryConfigStore({
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      youtubeMetadata: {
        instanceUrl: "https://inv.example",
        cookiesFromBrowser: "firefox",
        extractorArgs: "youtube:player_client=visionos",
        poToken: "visionos.gvs+SECRET",
        sponsorblockRemove: "sponsor",
      },
    });

    const service = await ConfigServiceImpl.load(store);
    expect(service.youtubeMetadata.poToken).toBe("visionos.gvs+SECRET");

    await service.save();
    expect((await store.load()).youtubeMetadata?.poToken).toBe("visionos.gvs+SECRET");
  });

  test("a non-string persisted value is dropped instead of throwing during load", async () => {
    // The schema validates providerRelay only and preserves everything else, so a
    // hand-edited config.json can put a number where a string belongs. `.trim()` on
    // that used to throw inside load(), taking down startup.
    const store = new MemoryConfigStore({
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      youtubeMetadata: { poToken: 42, extractorArgs: { nested: true } } as never,
    });
    const service = await ConfigServiceImpl.load(store);
    expect(service.youtubeMetadata.poToken).toBeUndefined();
    expect(service.youtubeMetadata.extractorArgs).toBeUndefined();
  });

  test("drops a blank PO token rather than persisting an empty string", async () => {
    const store = new MemoryConfigStore({ youtubeMetadata: { poToken: "   " } });
    const service = await ConfigServiceImpl.load(store);
    expect(service.youtubeMetadata.poToken).toBeUndefined();
  });
});

describe("session overrides", () => {
  test("a session override never reaches the persisted config file", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);
    expect(service.zenMode).toBe(false);

    // What `--zen` does at startup (main.ts).
    service.applySessionOverrides({ zenMode: true, minimalMode: true });

    // The session sees it...
    expect(service.zenMode).toBe(true);
    expect(service.minimalMode).toBe(true);
    expect(service.getRaw().zenMode).toBe(true);

    // ...but any save during the session must not bake it in. UpdateService and
    // UsageAnalyticsService both call save() unconditionally on startup, so this is
    // the routine path, not an edge case.
    await service.save();

    const persisted = await store.load();
    expect(persisted.zenMode).toBeFalsy();
    expect(persisted.minimalMode).toBeFalsy();
  });

  test("an explicit user change during the session wins over the flag", async () => {
    const store = new MemoryConfigStore();
    const service = await ConfigServiceImpl.load(store);

    service.applySessionOverrides({ zenMode: true });
    expect(service.zenMode).toBe(true);

    // Turning it off in /settings must actually turn it off, not be masked by
    // the launch flag, and must persist.
    await service.update({ zenMode: false });
    await service.save();

    expect(service.zenMode).toBe(false);
    expect((await store.load()).zenMode).toBe(false);
  });

  for (const key of ["zenMode", "minimalMode", "offlineMode"] as const) {
    test(`${key} override is visible to readers but never persisted`, async () => {
      const store = new MemoryConfigStore();
      const service = await ConfigServiceImpl.load(store);
      expect(service[key]).toBe(false);

      service.applySessionOverrides({ [key]: true });

      // Getter and raw view agree — this is what main.ts's offline/analytics
      // gates read, so the flag has to be indistinguishable from the setting.
      expect(service[key]).toBe(true);
      expect(service.getRaw()[key]).toBe(true);

      await service.save();
      await service.flushPending();

      const persisted = await store.load();
      expect(persisted[key]).toBeFalsy();
    });
  }
});

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("concurrent config saves merge onto disk", () => {
  /**
   * A store both "processes" share. Unlike MemoryConfigStore it clones on both
   * sides so a write one instance made cannot alias the object another holds.
   */
  class SharedConfigStore implements ConfigStore {
    private disk: Partial<KitsuneConfig>;
    onSave?: () => Promise<void>;

    constructor(initial: Partial<KitsuneConfig> = {}) {
      this.disk = structuredClone(initial);
    }

    async load(): Promise<Partial<KitsuneConfig>> {
      return structuredClone(this.disk);
    }

    async save(config: KitsuneConfig): Promise<void> {
      await this.onSave?.();
      this.disk = structuredClone(config);
    }

    async reset(): Promise<void> {
      this.disk = {};
    }
  }

  test("a stale process cannot resurrect keys another process changed", async () => {
    const installId = "11111111-1111-4111-8111-111111111111";
    const store = new SharedConfigStore({
      analytics: "enabled",
      installId,
      analyticsNoticeShown: true,
    });
    const a = await ConfigServiceImpl.load(store);
    const b = await ConfigServiceImpl.load(store);

    await b.update({ analytics: "disabled", installId: "" });
    await b.save();
    await b.flushPending();

    // A's write touches an unrelated bookkeeping key; before the merge it
    // rewrote its whole stale snapshot and re-enabled analytics.
    await a.update({ lastUpdateCheckAt: 1 });
    await a.save();
    await a.flushPending();

    const disk = await store.load();
    expect(disk.analytics).toBe("disabled");
    expect(disk.installId).toBe("");
    expect(disk.lastUpdateCheckAt).toBe(1);
    // The merge also lands in memory — readers see the other process's choice.
    expect(a.getRaw().analytics).toBe("disabled");
    expect(a.getRaw().installId).toBe("");
  });

  test("a key changed during an in-flight write stays dirty and lands on the next save", async () => {
    // Non-empty disk so the write takes the merge path, not the full-write path.
    const store = new SharedConfigStore({ analyticsNoticeShown: true });
    const service = await ConfigServiceImpl.load(store);
    await service.update({ subLang: "en" });

    const gate = Promise.withResolvers<void>();
    store.onSave = () => gate.promise;
    const pending = service.save();
    const flush = service.flushPending();

    // Dirtied while the write above waits on the store: it must keep its
    // memory value and reach disk on the following save.
    await service.update({ footerHints: "minimal" });
    gate.resolve();
    await pending;
    await flush;

    expect((await store.load()).footerHints).toBe(DEFAULT_CONFIG.footerHints);
    expect(service.footerHints).toBe("minimal");

    await service.save();
    await service.flushPending();
    expect((await store.load()).footerHints).toBe("minimal");
  });

  test("a missing or unreadable file falls back to writing the full memory config", async () => {
    const store = new SharedConfigStore();
    const service = await ConfigServiceImpl.load(store);
    await service.update({ subLang: "fr", footerHints: "minimal" });
    await service.save();
    await service.flushPending();

    const disk = await store.load();
    expect(disk.subLang).toBe("fr");
    expect(disk.footerHints).toBe("minimal");
    expect(disk.provider).toBe(DEFAULT_CONFIG.provider);
  });

  test("repeats the analytics clobber end to end through a real FileStorage file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-config-merge-"));
    tempDirs.push(dir);
    const installId = "11111111-1111-4111-8111-111111111111";
    const storageA = new FileStorage({ config: join(dir, "config.json") });
    const storageB = new FileStorage({ config: join(dir, "config.json") });
    await storageA.write("config", {
      analytics: "enabled",
      installId,
      analyticsNoticeShown: true,
    });

    const a = await ConfigServiceImpl.load(new ConfigStoreImpl(storageA));
    const b = await ConfigServiceImpl.load(new ConfigStoreImpl(storageB));

    await b.update({ analytics: "disabled", installId: "" });
    await b.save();
    await b.flushPending();

    await a.update({ lastUpdateCheckAt: 1 });
    await a.save();
    await a.flushPending();

    const raw = await storageA.read<Partial<KitsuneConfig>>("config");
    expect(raw?.analytics).toBe("disabled");
    expect(raw?.installId).toBe("");
    expect(raw?.lastUpdateCheckAt).toBe(1);
    expect(a.getRaw().analytics).toBe("disabled");
  });
});

type ConfigValueClass = "string" | "number" | "boolean" | "array" | "object" | "null";

function valueClass(value: KitsuneConfig[keyof KitsuneConfig] | undefined): ConfigValueClass {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (isJsonString(value)) return "string";
  if (isJsonNumber(value)) return "number";
  if (value === true || value === false) return "boolean";
  return isJsonObject(value) ? "object" : "null";
}

describe("malformed config values never crash load", () => {
  const fuzzValues: readonly unknown[] = [null, 42, "str", { a: 1 }, ["x"], [1], true];
  const getters = Object.values(
    Object.getOwnPropertyDescriptors(ConfigServiceImpl.prototype),
  ).flatMap((descriptor) => (descriptor.get === undefined ? [] : [descriptor.get]));

  // SAFETY: DEFAULT_CONFIG declares every KitsuneConfig field, so its keys are
  // exactly `keyof KitsuneConfig`.
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof KitsuneConfig)[]) {
    for (const value of fuzzValues) {
      test(`${key} = ${JSON.stringify(value)} loads, reads, and keeps the default's shape`, async () => {
        const store = new MemoryConfigStore({ [key]: value });
        const service = await ConfigServiceImpl.load(store);
        for (const getter of getters) {
          expect(() => getter.call(service)).not.toThrow();
        }
        const expected = valueClass(DEFAULT_CONFIG[key]);
        const actual = valueClass(service.getRaw()[key]);
        const accepted =
          expected === "null" ? actual === "null" || actual === "string" : actual === expected;
        expect(accepted).toBe(true);
      });
    }
  }
});
