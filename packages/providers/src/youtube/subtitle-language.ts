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

/** Map user subtitle prefs to mpv slang + yt-dlp sub-langs. */
export function toYoutubeSubtitlePreferenceTokens(
  preference: string | undefined,
): YoutubeSubtitlePreferenceTokens {
  const plan = buildYoutubeSubtitlePreferencePlan(preference);
  return { mpvSlang: plan.mpvSlang, ytdlpSubLangs: plan.ytdlpSubLangs };
}
