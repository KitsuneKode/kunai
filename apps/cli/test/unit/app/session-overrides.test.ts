import { describe, expect, test } from "bun:test";

import {
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import { resolveSessionConfigOverrides } from "@/app/session/session-overrides";

const BASE_LANE = { audio: "original", subtitle: "en", quality: "best" };

const baseConfig = {
  zenMode: false,
  minimalMode: false,
  animeLanguageProfile: { ...BASE_LANE },
  seriesLanguageProfile: { ...BASE_LANE },
  movieLanguageProfile: { ...BASE_LANE },
  youtubeLanguageProfile: { ...BASE_LANE },
};

describe("resolveSessionConfigOverrides", () => {
  const off = { ...baseConfig };

  test("YouTube consumes explicit launch quality and subtitle choices through its effective profile", () => {
    const config = {
      ...baseConfig,
      youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
    };
    const overrides = resolveSessionConfigOverrides(
      { zen: false, minimal: false, quality: "480p", subtitle: "none" },
      config,
    );
    const context = {
      mode: "youtube" as const,
      title: { type: "movie" as const },
      config: { ...config, ...overrides },
    };
    expect(playbackQualityPreference(context)).toBe("480p");
    expect(playbackSubtitlePreference(context)).toBe("none");
    expect(config.youtubeLanguageProfile.quality).toBe("1080p");
  });

  test("-m/--minimal flips minimalMode so the flag matches its name", () => {
    expect(resolveSessionConfigOverrides({ zen: false, minimal: true }, off)).toEqual({
      minimalMode: true,
    });
  });

  test("--zen (implies minimal) flips both zen and minimal layout fields", () => {
    expect(resolveSessionConfigOverrides({ zen: true, minimal: true }, off)).toEqual({
      zenMode: true,
      minimalMode: true,
    });
  });

  test("omits already-enabled fields so no no-op update is issued", () => {
    expect(
      resolveSessionConfigOverrides(
        { zen: true, minimal: true },
        { ...baseConfig, zenMode: true, minimalMode: true },
      ),
    ).toEqual({});
  });

  test("returns nothing for a default launch", () => {
    expect(resolveSessionConfigOverrides({ zen: false, minimal: false }, off)).toEqual({});
  });

  test("--offline flips offlineMode so startup and connectivity enforce local-only work", () => {
    expect(
      resolveSessionConfigOverrides(
        { zen: false, minimal: false, offline: true },
        { ...baseConfig, offlineMode: false },
      ),
    ).toEqual({ offlineMode: true });
  });

  test("--quality rides every provider lane profile for the session", () => {
    expect(
      resolveSessionConfigOverrides({ zen: false, minimal: false, quality: "720p" }, off),
    ).toEqual({
      animeLanguageProfile: { ...BASE_LANE, quality: "720p" },
      seriesLanguageProfile: { ...BASE_LANE, quality: "720p" },
      movieLanguageProfile: { ...BASE_LANE, quality: "720p" },
      youtubeLanguageProfile: { ...BASE_LANE, quality: "720p" },
    });
  });

  test("--audio and --sub merge with the lane's existing fields, not replace them", () => {
    expect(
      resolveSessionConfigOverrides(
        { zen: false, minimal: false, audio: "dub", subtitle: "none" },
        {
          ...baseConfig,
          animeLanguageProfile: { audio: "ja", subtitle: "en", quality: "1080p" },
        },
      ),
    ).toEqual({
      animeLanguageProfile: { audio: "dub", subtitle: "none", quality: "1080p" },
      seriesLanguageProfile: { ...BASE_LANE, subtitle: "none", audio: "dub" },
      movieLanguageProfile: { ...BASE_LANE, subtitle: "none", audio: "dub" },
      youtubeLanguageProfile: { ...BASE_LANE, subtitle: "none", audio: "dub" },
    });
  });

  test("a lane already matching every requested field emits no update for it", () => {
    expect(
      resolveSessionConfigOverrides(
        { zen: false, minimal: false, quality: "best" },
        {
          ...baseConfig,
          seriesLanguageProfile: { ...BASE_LANE, quality: "480p" },
        },
      ),
    ).toEqual({
      seriesLanguageProfile: { ...BASE_LANE, quality: "best" },
    });
  });
});
