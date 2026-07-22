import { describe, expect, test } from "bun:test";

import { animeEpisodeCatalogCacheKey } from "@/app/playback/playback-episode-picker";
import {
  playbackAudioPreference,
  playbackEpisodeCatalogLanguages,
  playbackLanguageProfile,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const profiles: Pick<
  KitsuneConfig,
  | "animeLanguageProfile"
  | "seriesLanguageProfile"
  | "movieLanguageProfile"
  | "youtubeLanguageProfile"
> = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "best" },
  movieLanguageProfile: { audio: "en", subtitle: "en", quality: "4k" },
  youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "720p" },
};

describe("playback-profile-context", () => {
  test("selects anime profile in anime mode", () => {
    const input = { mode: "anime" as const, title: { type: "series" as const }, config: profiles };
    expect(playbackLanguageProfile(input)).toEqual(profiles.animeLanguageProfile);
    expect(playbackAudioPreference(input)).toBe("original");
    expect(playbackSubtitlePreference(input)).toBe("en");
    expect(playbackQualityPreference(input)).toBe("1080p");
  });

  test("selects movie profile for movies", () => {
    const input = { mode: "series" as const, title: { type: "movie" as const }, config: profiles };
    expect(playbackLanguageProfile(input)).toEqual(profiles.movieLanguageProfile);
    expect(playbackAudioPreference(input)).toBe("en");
  });

  test("selects series profile for non-anime series", () => {
    const input = { mode: "series" as const, title: { type: "series" as const }, config: profiles };
    expect(playbackLanguageProfile(input)).toEqual(profiles.seriesLanguageProfile);
  });

  test("selects youtube profile in youtube mode", () => {
    const input = { mode: "youtube" as const, title: { type: "movie" as const }, config: profiles };
    expect(playbackLanguageProfile(input)).toEqual(profiles.youtubeLanguageProfile);
  });

  // The episode catalog used to be listed with no language context at all, so
  // AllAnime fell back to its sub catalog and dub users browsed a list that
  // disagreed with what actually played.
  test("episode-catalog languages mirror the resolved playback profile", () => {
    const dubProfiles = {
      ...profiles,
      animeLanguageProfile: { audio: "en", subtitle: "none", quality: "1080p" },
    };
    expect(
      playbackEpisodeCatalogLanguages({
        mode: "anime",
        title: { type: "series" },
        config: dubProfiles,
      }),
    ).toEqual({ audioPreference: "en", subtitlePreference: "none" });

    expect(
      playbackEpisodeCatalogLanguages({
        mode: "anime",
        title: { type: "series" },
        config: profiles,
      }),
    ).toEqual({ audioPreference: "original", subtitlePreference: "en" });
  });
});

describe("animeEpisodeCatalogCacheKey", () => {
  // Audio selects the catalog, so two audio preferences must not collide:
  // otherwise switching dub->sub mid-session replays the previous list.
  test("discriminates by audio preference", () => {
    const sub = animeEpisodeCatalogCacheKey({
      providerId: "allanime",
      titleId: "anilist:1",
      audioPreference: "original",
    });
    const dub = animeEpisodeCatalogCacheKey({
      providerId: "allanime",
      titleId: "anilist:1",
      audioPreference: "en",
    });
    expect(sub).not.toBe(dub);
    expect(sub).toBe("allanime:anilist:1:original");
  });

  test("separates providers and titles", () => {
    const base = { titleId: "anilist:1", audioPreference: "en" };
    expect(animeEpisodeCatalogCacheKey({ ...base, providerId: "allanime" })).not.toBe(
      animeEpisodeCatalogCacheKey({ ...base, providerId: "miruro" }),
    );
    expect(
      animeEpisodeCatalogCacheKey({ providerId: "allanime", titleId: "a", audioPreference: "en" }),
    ).not.toBe(
      animeEpisodeCatalogCacheKey({ providerId: "allanime", titleId: "b", audioPreference: "en" }),
    );
  });

  test("returns undefined without a provider, and falls back to the provider alone", () => {
    expect(
      animeEpisodeCatalogCacheKey({
        providerId: undefined,
        titleId: "anilist:1",
        audioPreference: "en",
      }),
    ).toBeUndefined();
    expect(
      animeEpisodeCatalogCacheKey({
        providerId: "allanime",
        titleId: undefined,
        audioPreference: "en",
      }),
    ).toBe("allanime");
  });
});
