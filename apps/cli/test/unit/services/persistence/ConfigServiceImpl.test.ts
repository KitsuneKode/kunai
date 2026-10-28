import { describe, expect, test } from "bun:test";

import {
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import { resolveSessionConfigOverrides } from "@/app/session/session-overrides";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type ConfigStore } from "@/services/persistence/ConfigStore";

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

    await service.update({ defaultMode: "anime", footerHints: "minimal" });
    await service.save();

    expect((await store.load()).defaultMode).toBe("anime");
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

  test("normalizes the disabled-providers list on load and update", async () => {
    const store = new MemoryConfigStore({
      // SAFETY: deliberately poisoned JSON shape — validates the non-string guard.
      disabledProviders: [" videasy ", "videasy", "", 42 as never],
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.disabledProviders).toEqual(["videasy"]);
    expect(service.getRaw().disabledProviders).toEqual(["videasy"]);

    await service.update({ disabledProviders: [" miruro ", "anidb", "miruro"] });
    await service.save();

    expect((await store.load()).disabledProviders).toEqual(["miruro"]);
  });

  test("a null sync sub-object on disk cannot collapse the live config shape", async () => {
    // SAFETY: models a hand-edited config.json — `{"sync":{"anilist":null}}` is
    // valid JSON but violates the declared KitsuneConfig shape.
    const store = new MemoryConfigStore({
      sync: { anilist: null, tmdb: { enabled: true } } as never,
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.sync.anilist).toEqual(DEFAULT_CONFIG.sync.anilist);
    expect(service.sync.tmdb.enabled).toBe(true);
    expect(service.sync.anilist.enabled).toBe(DEFAULT_CONFIG.sync.anilist.enabled);
  });

  test("a null sync section on disk falls back to the default sync config", async () => {
    // SAFETY: deliberately poisoned JSON shape — validates the non-object guard.
    const store = new MemoryConfigStore({ sync: null as never });
    const service = await ConfigServiceImpl.load(store);

    expect(service.sync).toEqual(DEFAULT_CONFIG.sync);
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
    expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
    const persisted = await store.load();
    expect(persisted.animeProvider).toBe("hianime");
    expect(persisted.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
    expect(persisted.providerDefaultsRevision).toBe(DEFAULT_CONFIG.providerDefaultsRevision);
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
      expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
      expect((await store.load()).providerDefaultsRevision).toBe(
        DEFAULT_CONFIG.providerDefaultsRevision,
      );
    }
  });

  test("maps a revision-1 AniDB re-pick to the live anime default", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "anidb",
      animeProviderPriority: ["anidb"],
      providerDefaultsRevision: 1,
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("hianime");
    expect(service.animeProviderPriority).toEqual([]);
  });

  test("a revision-1 list the user reordered is left alone", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "miruro",
      animeProviderPriority: ["miruro", "allanime", "anidb"],
      providerDefaultsRevision: 1,
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProviderPriority).toEqual(["miruro", "allanime"]);
  });

  test("moves an AniDB default that predates the priority list", async () => {
    const store = new MemoryConfigStore({ animeProvider: "anidb" });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("hianime");
    expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
  });

  test("leaves a customised anime lane alone when it does not reference retired ids", async () => {
    const loaded = { animeProvider: "allanime", animeProviderPriority: ["allanime", "miruro"] };
    const store = new MemoryConfigStore(loaded);
    const before = await store.load();
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe(loaded.animeProvider);
    expect(service.animeProviderPriority).toEqual(loaded.animeProviderPriority);
    expect(await store.load()).toBe(before);
  });

  test("strips retired ids from a customised anime lane without changing the lead", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "allanime",
      animeProviderPriority: ["allanime", "anidb"],
    });
    const service = await ConfigServiceImpl.load(store);

    expect(service.animeProvider).toBe("allanime");
    expect(service.animeProviderPriority).toEqual(["allanime"]);
  });

  test("cannot persist AniDB as the anime lane selection after retirement", async () => {
    const store = new MemoryConfigStore({
      animeProvider: "anidb",
      animeProviderPriority: ["anidb"],
    });
    const service = await ConfigServiceImpl.load(store);
    expect(service.animeProvider).toBe("hianime");

    await service.update({ animeProvider: "anidb", animeProviderPriority: ["anidb"] });
    await service.save();

    const reloaded = await ConfigServiceImpl.load(store);
    expect(reloaded.animeProvider).toBe("hianime");
    expect(reloaded.animeProviderPriority).toEqual([]);
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
      expect(service.animeProviderPriority).toEqual(["allanime", "miruro"]);
      expect(service.getRaw().providerDefaultsRevision).toBe(
        DEFAULT_CONFIG.providerDefaultsRevision,
      );
    });

    test("maps a reordered list that still names anidb as the lane pick", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["allanime", "miruro"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual(["allanime", "miruro"]);
    });

    test("heals a stamped config that still names the retired adapter", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
        providerDefaultsRevision: DEFAULT_CONFIG.providerDefaultsRevision,
      });
      await ConfigServiceImpl.load(store);

      const persisted = await store.load();
      expect(persisted.animeProvider).toBe("hianime");
      expect(persisted.animeProviderPriority).toEqual([]);
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

    test("maps a stamped AniDB re-pick at revision 1 to the live default", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb"],
        providerDefaultsRevision: 1,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual([]);
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

    test("moves a revision-3 VidLink series pair to the current defaults", async () => {
      // Revision 3 shipped VidLink at the lead with Movy unlisted, so it
      // floated behind a dead Videasy. The exact shipped pair is the honest
      // "never touched the lane" signal — a custom list stays put.
      const store = new MemoryConfigStore({
        provider: "vidlink",
        providerPriority: ["rivestream", "vidrock", "videasy"],
        providerDefaultsRevision: 3,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe(DEFAULT_CONFIG.provider);
      expect(service.providerPriority).toEqual([...DEFAULT_CONFIG.providerPriority]);
      const persisted = await store.load();
      expect(persisted.providerDefaultsRevision).toBe(DEFAULT_CONFIG.providerDefaultsRevision);
    });

    test("leaves a revision-3 series list the user reordered alone", async () => {
      const store = new MemoryConfigStore({
        provider: "vidlink",
        providerPriority: ["vidrock", "rivestream", "videasy"],
        providerDefaultsRevision: 3,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.provider).toBe("vidlink");
      expect(service.providerPriority).toEqual(["vidrock", "rivestream", "videasy"]);
    });

    test("moves a revision-3 HiAnime anime pair to the current defaults", async () => {
      // Revision 3's tail put a dead anidb.app ahead of AllAnime; revision 4
      // swaps the tail. The shipped pair migrates; anything else stays put.
      const store = new MemoryConfigStore({
        animeProvider: "hianime",
        animeProviderPriority: ["miruro", "kickassanime", "animegg", "anidb", "allanime"],
        providerDefaultsRevision: 3,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
    });

    test("moves a revision-4 HiAnime anime pair to the current defaults", async () => {
      // Revision 4 led the rest with Miruro; revision 5 demotes the dead pair
      // (Miruro's pipe removed, AniDB repurposed) behind AllAnime.
      const store = new MemoryConfigStore({
        animeProvider: "hianime",
        animeProviderPriority: ["miruro", "kickassanime", "animegg", "allanime", "anidb"],
        providerDefaultsRevision: 4,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual([...DEFAULT_CONFIG.animeProviderPriority]);
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
  test("explicit settings reset clears transient launch choices too", async () => {
    const store = new MemoryConfigStore(structuredClone(DEFAULT_CONFIG));
    const service = await ConfigServiceImpl.load(store);
    service.applySessionOverrides(
      resolveSessionConfigOverrides(
        { zen: true, minimal: true, offline: true, quality: "480p", subtitle: "none" },
        service,
      ),
    );
    await service.reset();
    expect(service.offlineMode).toBe(DEFAULT_CONFIG.offlineMode);
    expect(service.youtubeLanguageProfile).toEqual(DEFAULT_CONFIG.youtubeLanguageProfile);
    expect(service.movieLanguageProfile).toEqual(DEFAULT_CONFIG.movieLanguageProfile);
    expect(service.zenMode).toBe(DEFAULT_CONFIG.zenMode);
  });
  test("launch preferences reach every playback reader without becoming persisted defaults", async () => {
    const store = new MemoryConfigStore(structuredClone(DEFAULT_CONFIG));
    const service = await ConfigServiceImpl.load(store);
    const before = service.getRaw();
    service.applySessionOverrides(
      resolveSessionConfigOverrides(
        { zen: false, minimal: false, offline: true, quality: "480p", subtitle: "none" },
        service,
      ),
    );
    for (const mode of ["anime", "series", "youtube"] as const) {
      const context = { mode, title: { type: "movie" as const }, config: service };
      expect(playbackQualityPreference(context)).toBe("480p");
      expect(playbackSubtitlePreference(context)).toBe("none");
    }
    expect(service.seriesLanguageProfile.quality).toBe("480p");
    expect(service.offlineMode).toBe(true);
    await service.save();
    const persisted = await store.load();
    expect(persisted.youtubeLanguageProfile).toEqual(before.youtubeLanguageProfile);
    expect(persisted.movieLanguageProfile).toEqual(before.movieLanguageProfile);
    expect(persisted.animeLanguageProfile).toEqual(before.animeLanguageProfile);
    expect(persisted.seriesLanguageProfile).toEqual(before.seriesLanguageProfile);
    expect(persisted.offlineMode).toBe(before.offlineMode);
    await service.update({
      youtubeLanguageProfile: { ...before.youtubeLanguageProfile, quality: "720p" },
      offlineMode: false,
    });
    expect(service.youtubeLanguageProfile.quality).toBe("720p");
    expect(service.offlineMode).toBe(false);
    expect(service.movieLanguageProfile.quality).toBe("480p");
  });

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
});

describe("ConfigServiceImpl untrusted-shape hardening", () => {
  test("wrong-typed provider and priority fields degrade to defaults, not a crash", async () => {
    // config.json is user-editable — a number where a provider id belongs must
    // not crash startup on .trim().
    const service = await ConfigServiceImpl.load(
      // SAFETY: every field is deliberately wrong-typed — the test proves load()
      // degrades each to defaults instead of throwing on poisoned config.json.
      new MemoryConfigStore({
        provider: 42,
        animeProvider: { id: "allanime" },
        youtubeProvider: ["youtube"],
        providerPriority: "vidking,vidlink",
        animeProviderPriority: [42, " allanime ", null],
      } as never),
    );

    expect(service.getRaw().provider).toBe(DEFAULT_CONFIG.provider);
    expect(service.getRaw().animeProvider).toBe(DEFAULT_CONFIG.animeProvider);
    expect(service.getRaw().youtubeProvider).toBe(DEFAULT_CONFIG.youtubeProvider);
    expect(service.getRaw().animeProviderPriority).toEqual(["allanime"]);
  });

  test("wrong-typed language profiles and lists fall back without throwing", async () => {
    const service = await ConfigServiceImpl.load(
      // SAFETY: same wrong-typed fixture pattern as the test above.
      new MemoryConfigStore({
        animeLanguageProfile: "sub",
        seriesLanguageProfile: [1, 2],
        protectedDownloadJobIds: { a: true },
        favoriteSources: "vidlink",
        sync: null,
        titleProviderPreferences: [["tmdb:1", "vidking"]],
      } as never),
    );

    expect(service.getRaw().animeLanguageProfile).toEqual({
      audio: "original",
      subtitle: "none",
      quality: "best",
    });
    expect(service.getRaw().protectedDownloadJobIds).toEqual([]);
    expect(service.getRaw().favoriteSources).toEqual([]);
    expect(service.getRaw().sync).toEqual(DEFAULT_CONFIG.sync);
    expect(service.getRaw().titleProviderPreferences).toEqual({});
  });

  test("an unreadable series priority cannot pin the dead videasy default", async () => {
    // `provider: "videasy"` + a malformed priority used to shield the dead
    // provider pick from migration — the user stayed on an upstream-dead
    // provider forever.
    const service = await ConfigServiceImpl.load(
      new MemoryConfigStore({
        provider: "videasy",
        // SAFETY: a string where an array belongs — proves the unreadable
        // priority cannot shield the dead videasy default from migration.
        providerPriority: "vidlink" as never,
      }),
    );

    expect(service.getRaw().provider).toBe(DEFAULT_CONFIG.provider);
  });

  describe("retired production provider: anidb", () => {
    test("maps an explicit anime selection and strips the id from custom priority", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "anidb",
        animeProviderPriority: ["kickassanime", "anidb", "miruro"],
        providerDefaultsRevision: DEFAULT_CONFIG.providerDefaultsRevision,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual(["kickassanime", "miruro"]);
    });

    test("removes a retired disable entry without disabling hianime", async () => {
      const store = new MemoryConfigStore({
        disabledProviders: ["anidb"],
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.disabledProviders).toEqual([]);
      expect(service.animeProvider).toBe("hianime");
    });

    test("drops title pins that still point at anidb", async () => {
      const store = new MemoryConfigStore({
        titleProviderPreferences: { "anilist:21": "anidb", "anilist:5114": "allanime" },
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.titleProviderPreferences).toEqual({ "anilist:5114": "allanime" });
    });

    test("migrates a revision-5 inherited default that still listed anidb at the tail", async () => {
      const store = new MemoryConfigStore({
        animeProvider: "hianime",
        animeProviderPriority: ["kickassanime", "animegg", "allanime", "miruro", "anidb"],
        providerDefaultsRevision: 5,
      });
      const service = await ConfigServiceImpl.load(store);

      expect(service.animeProviderPriority).toEqual([
        "kickassanime",
        "animegg",
        "allanime",
        "miruro",
      ]);
      expect((await store.load()).providerDefaultsRevision).toBe(6);
    });

    test("normalizes anidb away on update as well as load", async () => {
      const service = await ConfigServiceImpl.load(new MemoryConfigStore({}));
      await service.update({
        animeProvider: "anidb",
        animeProviderPriority: ["anidb", "allanime"],
      });

      expect(service.animeProvider).toBe("hianime");
      expect(service.animeProviderPriority).toEqual(["allanime"]);
    });
  });
});
