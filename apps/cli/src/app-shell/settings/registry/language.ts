import type { SettingRowDef, SettingsRegistryContext } from "../types";
import {
  ANIME_TITLE_SETTINGS_OPTIONS,
  AUDIO_SETTINGS_OPTIONS,
  SUBTITLE_SETTINGS_OPTIONS,
} from "./shared";

export function languageSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:language",
      label: "Language",
      detail: "Preferred audio/subtitle tracks when a provider exposes choices",
    },
    {
      kind: "enum",
      id: "animeAudio",
      label: "Anime audio",
      detail: "Preferred anime audio track language",
      options: AUDIO_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.animeLanguageProfile.audio,
      write: (config, value) => ({
        ...config,
        animeLanguageProfile: { ...config.animeLanguageProfile, audio: value },
      }),
    },
    {
      kind: "enum",
      id: "animeSubtitle",
      label: "Anime subtitles",
      detail: "Preferred anime subtitle behavior",
      options: SUBTITLE_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.animeLanguageProfile.subtitle,
      write: (config, value) => ({
        ...config,
        animeLanguageProfile: { ...config.animeLanguageProfile, subtitle: value },
      }),
    },
    {
      kind: "enum",
      id: "seriesAudio",
      label: "Series audio",
      detail: "Preferred series audio track language",
      options: AUDIO_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.seriesLanguageProfile.audio,
      write: (config, value) => ({
        ...config,
        seriesLanguageProfile: { ...config.seriesLanguageProfile, audio: value },
      }),
    },
    {
      kind: "enum",
      id: "seriesSubtitle",
      label: "Series subtitles",
      detail: "Preferred series subtitle behavior",
      options: SUBTITLE_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.seriesLanguageProfile.subtitle,
      write: (config, value) => ({
        ...config,
        seriesLanguageProfile: { ...config.seriesLanguageProfile, subtitle: value },
      }),
    },
    {
      kind: "enum",
      id: "movieAudio",
      label: "Movie audio",
      detail: "Preferred movie audio track language",
      options: AUDIO_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.movieLanguageProfile.audio,
      write: (config, value) => ({
        ...config,
        movieLanguageProfile: { ...config.movieLanguageProfile, audio: value },
      }),
    },
    {
      kind: "enum",
      id: "movieSubtitle",
      label: "Movie subtitles",
      detail: "Preferred movie subtitle behavior",
      options: SUBTITLE_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.movieLanguageProfile.subtitle,
      write: (config, value) => ({
        ...config,
        movieLanguageProfile: { ...config.movieLanguageProfile, subtitle: value },
      }),
    },
    {
      kind: "enum",
      id: "youtubeAudio",
      label: "YouTube audio",
      detail: "Preferred YouTube audio track language",
      options: AUDIO_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.youtubeLanguageProfile.audio,
      write: (config, value) => ({
        ...config,
        youtubeLanguageProfile: { ...config.youtubeLanguageProfile, audio: value },
      }),
    },
    {
      kind: "enum",
      id: "youtubeSubtitle",
      label: "YouTube subtitles",
      detail: "Preferred YouTube subtitle behavior",
      options: SUBTITLE_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.youtubeLanguageProfile.subtitle,
      write: (config, value) => ({
        ...config,
        youtubeLanguageProfile: { ...config.youtubeLanguageProfile, subtitle: value },
      }),
    },
    {
      kind: "enum",
      id: "animeTitlePreference",
      label: "Anime title names",
      detail: "Choose English, Romaji, native, or provider titles in anime search",
      options: ANIME_TITLE_SETTINGS_OPTIONS,
      presentation: "submenu",
      read: (config) => config.animeTitlePreference,
      write: (config, value) => ({
        ...config,
        animeTitlePreference: value as typeof config.animeTitlePreference,
      }),
    },
  ];
}
