import { languageDisplayName, normalizeSubtitleLanguage } from "../shared/subtitle-helpers";

/** ISO 639-1 → common YouTube / yt-dlp 639-2 aliases. */
const ISO_639_2_ALIASES: Readonly<Record<string, string>> = {
  en: "eng",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  ru: "rus",
  ja: "jpn",
  ko: "kor",
  zh: "zho",
  ar: "ara",
  hi: "hin",
  nl: "nld",
  pl: "pol",
  tr: "tur",
  sv: "swe",
  da: "dan",
  fi: "fin",
  no: "nor",
  cs: "ces",
  hu: "hun",
  ro: "ron",
  th: "tha",
  vi: "vie",
  id: "ind",
  he: "heb",
  uk: "ukr",
  el: "ell",
};

export type YoutubeSubtitlePreferencePlan = {
  readonly mpvSlang: string | null;
  /** yt-dlp sub-langs: `all` embeds every track; null skips subtitle extraction. */
  readonly ytdlpSubLangs: string | null;
  readonly preferLanguage: string | null;
  readonly statusHint: string | null;
};

export type YoutubeSubtitlePreferenceTokens = {
  readonly mpvSlang: string | null;
  readonly ytdlpSubLangs: string | null;
};

function buildMpvSlangVariants(iso1: string): string {
  const iso3 = ISO_639_2_ALIASES[iso1];
  const variants = iso3 ? [iso1, iso3, `${iso1}.*`, `${iso3}.*`] : [iso1, `${iso1}.*`];
  return [...new Set(variants)].join(",");
}

/**
 * Prefer config subtitle language in mpv while attaching every YouTube subtitle track
 * (same fallback posture as other providers: select best, keep the rest available).
 */
export function buildYoutubeSubtitlePreferencePlan(
  preference: string | undefined,
): YoutubeSubtitlePreferencePlan {
  const raw = preference?.trim().toLowerCase();
  if (!raw) {
    return {
      mpvSlang: null,
      ytdlpSubLangs: "all",
      preferLanguage: null,
      statusHint: "YouTube subtitles · all tracks attached",
    };
  }
  if (raw === "none") {
    return {
      mpvSlang: "no",
      ytdlpSubLangs: null,
      preferLanguage: null,
      statusHint: null,
    };
  }
  if (raw === "interactive" || raw === "fzf") {
    return {
      mpvSlang: null,
      ytdlpSubLangs: "all",
      preferLanguage: null,
      statusHint: "YouTube subtitles · all tracks attached",
    };
  }
  if (raw === "original") {
    return {
      mpvSlang: "orig",
      ytdlpSubLangs: "all",
      preferLanguage: "original",
      statusHint: "YouTube subtitles · prefer original · all tracks attached",
    };
  }

  const iso1 = normalizeSubtitleLanguage(preference) ?? raw;
  const display = languageDisplayName(iso1) ?? iso1.toUpperCase();
  return {
    mpvSlang: buildMpvSlangVariants(iso1),
    ytdlpSubLangs: "all",
    preferLanguage: iso1,
    statusHint: `YouTube subtitles · prefer ${display} · all tracks attached`,
  };
}

/**
 * Hard ceiling on attached subtitle tracks.
 *
 * A backstop, not the primary filter: if YouTube adds a new caption family the
 * language rules below do not anticipate, the picker still stays usable.
 */
const MAX_ATTACHED_SUBTITLE_TRACKS = 25;

/** Does a yt-dlp caption language tag answer to the configured language? */
function matchesPreferredLanguage(language: string, preferred: string): boolean {
  // yt-dlp tags look like `en`, `en-US`, `en-orig`, `eng`, `zh-Hans`.
  const base = language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (!base) return false;
  const normalized = normalizeSubtitleLanguage(base) ?? base;
  return normalized === preferred || base === preferred || ISO_639_2_ALIASES[preferred] === base;
}

/** Is this the video's own caption track rather than a machine translation of it? */
function isOriginalLanguageTrack(language: string): boolean {
  return language.trim().toLowerCase().endsWith("-orig");
}

/**
 * Bound the attached subtitle inventory to tracks a person might actually pick.
 *
 * YouTube auto-translates captions into ~160 languages and yt-dlp faithfully reports
 * every one, so attaching them all buried the two or three useful tracks in a list
 * nobody can scroll (157 machine translations on a typical video). Manual tracks are
 * human-authored and few, so they are always kept; machine translations are kept only
 * for the configured language, plus the video's own original-language track.
 */
export function boundYoutubeSubtitleTracks<
  T extends { readonly language: string; readonly source: "manual" | "auto" },
>(tracks: readonly T[], preference: string | undefined): readonly T[] {
  const plan = buildYoutubeSubtitlePreferencePlan(preference);
  if (plan.mpvSlang === "no") return [];

  // `original` carries no language of its own; English is the floor when nothing
  // is configured, so a default install still gets captions rather than none.
  const preferred =
    plan.preferLanguage && plan.preferLanguage !== "original" ? plan.preferLanguage : "en";

  const kept = tracks.filter(
    (track) =>
      track.source === "manual" ||
      isOriginalLanguageTrack(track.language) ||
      matchesPreferredLanguage(track.language, preferred),
  );
  return kept.slice(0, MAX_ATTACHED_SUBTITLE_TRACKS);
}

/** Map user subtitle prefs to mpv slang + yt-dlp sub-langs. */
export function toYoutubeSubtitlePreferenceTokens(
  preference: string | undefined,
): YoutubeSubtitlePreferenceTokens {
  const plan = buildYoutubeSubtitlePreferencePlan(preference);
  return { mpvSlang: plan.mpvSlang, ytdlpSubLangs: plan.ytdlpSubLangs };
}
