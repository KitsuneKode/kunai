export type MediaPreferenceKind = "audio" | "subtitle";

export type MediaPreference = {
  readonly kind: MediaPreferenceKind;
  readonly value: string;
};

export function isSubtitlePreferenceDisabled(value: string): boolean {
  return value === "none";
}

export function describeMediaPreference(preference: MediaPreference): string {
  if (preference.kind === "subtitle") return describeSubtitlePreference(preference.value);
  if (preference.value === "original") return "Original audio";
  if (preference.value === "dub") return "Dub audio";
  return `Audio ${preference.value}`;
}

export function describeSubtitlePreference(value: string): string {
  if (isSubtitlePreferenceDisabled(value)) return "Subtitles off";
  if (value === "interactive" || value === "fzf") return "Pick subtitles each time";
  return `Subtitle ${value}`;
}

export function describeSubtitleFallback(input: {
  readonly requested: string;
  readonly availableLanguages: readonly string[];
}): string {
  if (isSubtitlePreferenceDisabled(input.requested)) return "Subtitles disabled by preference";
  if (input.availableLanguages.includes(input.requested)) {
    return `Using preferred subtitles (${input.requested})`;
  }
  if (input.availableLanguages.includes("en"))
    return "Preferred subtitles unavailable; using English";
  if (input.availableLanguages.length > 0) {
    return `Preferred subtitles unavailable; using ${input.availableLanguages[0]}`;
  }
  return "No soft subtitles available";
}
