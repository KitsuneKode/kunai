export type AnimeAudioIntent = {
  readonly catalogMode: "sub" | "dub";
  readonly presentation: "sub" | "dub";
  readonly preferredAudioLanguage: string;
};

function normalizeAudioSetting(audio: string): string {
  return audio.trim().toLowerCase();
}

/**
 * Single mapping from settings/profile audio values to provider resolve intent.
 * `en` and `dub` both target the dub catalog; `original` and `ja` target sub.
 */
export function resolveAnimeAudioIntent(audio: string): AnimeAudioIntent {
  const normalized = normalizeAudioSetting(audio);
  if (normalized === "en" || normalized === "dub") {
    return {
      catalogMode: "dub",
      presentation: "dub",
      preferredAudioLanguage: normalized === "en" ? "en" : "dub",
    };
  }
  return {
    catalogMode: "sub",
    presentation: "sub",
    preferredAudioLanguage: normalized === "ja" ? "ja" : "original",
  };
}

export function isAnimeDubAudioPreference(audio: string): boolean {
  return resolveAnimeAudioIntent(audio).catalogMode === "dub";
}
