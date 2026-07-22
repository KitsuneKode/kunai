import { mediaLanguageProfileFor } from "@/domain/media/content-kind";
import type { ShellMode, TitleInfo } from "@/domain/types";
import type { KitsuneConfig, MediaLanguageProfile } from "@/services/persistence/ConfigService";

export type PlaybackProfileContextInput = {
  readonly mode: ShellMode;
  readonly title: Pick<TitleInfo, "type"> | null;
  readonly config: Pick<
    KitsuneConfig,
    | "animeLanguageProfile"
    | "seriesLanguageProfile"
    | "movieLanguageProfile"
    | "youtubeLanguageProfile"
  >;
};

/** Resolve audio/subtitle/quality profile for the active title and shell mode. */
export function playbackLanguageProfile(input: PlaybackProfileContextInput): MediaLanguageProfile {
  return mediaLanguageProfileFor({
    mode: input.mode,
    currentTitle: input.title,
    animeLanguageProfile: input.config.animeLanguageProfile,
    seriesLanguageProfile: input.config.seriesLanguageProfile,
    movieLanguageProfile: input.config.movieLanguageProfile,
    youtubeLanguageProfile: input.config.youtubeLanguageProfile,
  });
}

export function playbackAudioPreference(input: PlaybackProfileContextInput): string {
  return playbackLanguageProfile(input).audio;
}

export function playbackSubtitlePreference(input: PlaybackProfileContextInput): string {
  return playbackLanguageProfile(input).subtitle;
}

export function playbackQualityPreference(input: PlaybackProfileContextInput): string | undefined {
  return playbackLanguageProfile(input).quality;
}

/**
 * Language context for listing a provider's episode catalog. Providers that key
 * their catalog by audio (AllAnime serves separate dub/sub episode lists) need
 * the same preferences `resolve` receives, or the browsed list disagrees with
 * what actually plays.
 */
export type EpisodeCatalogLanguagePreferences = {
  readonly audioPreference: string;
  readonly subtitlePreference: string;
};

export function playbackEpisodeCatalogLanguages(
  input: PlaybackProfileContextInput,
): EpisodeCatalogLanguagePreferences {
  const profile = playbackLanguageProfile(input);
  return { audioPreference: profile.audio, subtitlePreference: profile.subtitle };
}
