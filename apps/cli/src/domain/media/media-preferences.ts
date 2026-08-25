/**
 * The catalog of audio/subtitle choices Kunai offers, and which one it
 * recommends.
 *
 * One list, two surfaces. Setup and `/settings` each used to carry their own:
 * setup offered en/none/interactive/ja/es/fr while settings offered
 * en/interactive/none/ar/fr/de/es/ja, with different ordering and different
 * labels for the same value ("Ask me each time" vs "Pick interactively"). A user
 * who set a language in setup could not find the same wording again in settings.
 *
 * This lives in `domain/` because it is pure vocabulary with no I/O, which is
 * also what lets both app-shell consumers import it without either one owning
 * the other. The shape is structurally compatible with the settings registry's
 * `EnumOption`.
 */
export type MediaPreferenceOption = {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
};

export const AUDIO_PREFERENCE_OPTIONS: readonly MediaPreferenceOption[] = [
  {
    value: "original",
    label: "Original",
    detail: "Use the language the title was made in",
  },
  { value: "en", label: "English", detail: "Prefer English audio when available" },
  { value: "ja", label: "Japanese", detail: "Prefer Japanese audio when available" },
  { value: "dub", label: "Any dub", detail: "Prefer any dubbed track over the original" },
];

export const SUBTITLE_PREFERENCE_OPTIONS: readonly MediaPreferenceOption[] = [
  { value: "en", label: "English", detail: "English subtitles by default" },
  { value: "interactive", label: "Pick each time", detail: "Choose subtitles per episode" },
  { value: "none", label: "None", detail: "No subtitles unless you turn them on" },
  { value: "ar", label: "Arabic", detail: "Arabic subtitles" },
  { value: "de", label: "German", detail: "German subtitles" },
  { value: "es", label: "Spanish", detail: "Spanish subtitles" },
  { value: "fr", label: "French", detail: "French subtitles" },
  { value: "ja", label: "Japanese", detail: "Japanese subtitles" },
];

/**
 * What setup pre-selects, and what skipping a step writes.
 *
 * `original` rather than a named language on purpose: it already resolves to
 * Japanese for anime and to the native track for everything else, so one value
 * is right across all three lanes without asking which lane the user cares
 * about.
 */
export const RECOMMENDED_AUDIO_PREFERENCE = "original";
export const RECOMMENDED_SUBTITLE_PREFERENCE = "en";

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
