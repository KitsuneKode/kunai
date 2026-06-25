import { describe, expect, test } from "bun:test";

import {
  playbackAudioPreference,
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
});
