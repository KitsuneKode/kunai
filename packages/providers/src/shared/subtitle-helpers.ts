const ISO_639_1_MAP: Record<string, string> = {
  eng: "en",
  english: "en",
  ara: "ar",
  arabic: "ar",
  spa: "es",
  spanish: "es",
  fre: "fr",
  fra: "fr",
  french: "fr",
  ger: "de",
  deu: "de",
  german: "de",
  jpn: "ja",
  japanese: "ja",
  ita: "it",
  italian: "it",
  por: "pt",
  ptb: "pt",
  portuguese: "pt",
  "brazilian portuguese": "pt",
  brazilian: "pt",
  rus: "ru",
  russian: "ru",
  kor: "ko",
  korean: "ko",
  zho: "zh",
  chi: "zh",
  chinese: "zh",
  nld: "nl",
  dut: "nl",
  dutch: "nl",
  pol: "pl",
  polish: "pl",
  tur: "tr",
  turkish: "tr",
  swe: "sv",
  swedish: "sv",
  dan: "da",
  danish: "da",
  fin: "fi",
  finnish: "fi",
  nor: "no",
  norwegian: "no",
  ces: "cs",
  cze: "cs",
  czech: "cs",
  hun: "hu",
  hungarian: "hu",
  ron: "ro",
  rum: "ro",
  romanian: "ro",
  tha: "th",
  thai: "th",
  vie: "vi",
  vietnamese: "vi",
  ind: "id",
  indonesian: "id",
  heb: "he",
  hebrew: "he",
  hin: "hi",
  hindi: "hi",
  ukr: "uk",
  ukrainian: "uk",
  ell: "el",
  gre: "el",
  greek: "el",
  bul: "bg",
  bulgarian: "bg",
  cat: "ca",
  catalan: "ca",
  slk: "sk",
  slovak: "sk",
  slv: "sl",
  slovenian: "sl",
  hrv: "hr",
  croatian: "hr",
  srp: "sr",
  serbian: "sr",
  msa: "ms",
  malay: "ms",
  tgl: "tl",
  fil: "tl",
  filipino: "tl",
  tagalog: "tl",
  ben: "bn",
  bengali: "bn",
  tam: "ta",
  tamil: "ta",
  tel: "te",
  telugu: "te",
  mar: "mr",
  marathi: "mr",
  guj: "gu",
  gujarati: "gu",
  pan: "pa",
  punjabi: "pa",
  urd: "ur",
  urdu: "ur",
  fas: "fa",
  persian: "fa",
};

const ISO_2_LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ja: "Japanese",
  ar: "Arabic",
  ko: "Korean",
  zh: "Chinese",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  cs: "Czech",
  hu: "Hungarian",
  ro: "Romanian",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  he: "Hebrew",
  hi: "Hindi",
  uk: "Ukrainian",
  el: "Greek",
  bg: "Bulgarian",
  ca: "Catalan",
  sk: "Slovak",
  sl: "Slovenian",
  hr: "Croatian",
  sr: "Serbian",
  ms: "Malay",
  tl: "Filipino",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  pa: "Punjabi",
  ur: "Urdu",
  fa: "Persian",
};

export function normalizeSubtitleLanguage(value: string | undefined): string | undefined {
  let raw = value?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  // Strip parenthetical and bracket segments: "English (SDH)" -> "English"
  raw = stripEnclosedSegments(raw);

  // Handle locale suffixes: "es-mx" -> "es", "pt-br" -> "pt"
  raw = stripLocaleSuffix(raw);

  // Handle "brazilian portuguese" -> "portuguese"
  // Normalize whitespace
  const normalized = raw.replace(/\s+/g, " ").trim();

  // Direct map lookup
  if (ISO_639_1_MAP[normalized]) {
    return ISO_639_1_MAP[normalized];
  }

  // Prefix match: "english (cc)" -> "english" -> "en"
  for (const [prefix, code] of Object.entries(ISO_639_1_MAP)) {
    if (normalized.startsWith(prefix + " ") || normalized === prefix) {
      return code;
    }
  }

  // If the value is already a 2-letter ISO code, keep it
  if (/^[a-z]{2}$/.test(normalized)) {
    return normalized;
  }

  return normalized;
}

export function subtitleLanguageDisplayName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const normalized = code.toLowerCase().trim();
  return ISO_2_LANGUAGE_NAME[normalized] ?? normalized;
}

export function looksLikeHiSubtitle(
  label: string | undefined,
  release?: string,
  language?: string,
): boolean {
  const raw = [label, release, language]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return (
    raw.includes("sdh") ||
    /\bhi\b/.test(raw) ||
    raw.includes("hearing impaired") ||
    raw.includes("hearing-impaired") ||
    /\bcc\b/.test(raw) ||
    raw.includes("closed caption") ||
    raw.includes("closed-caption")
  );
}

function stripEnclosedSegments(value: string): string {
  // Remove (...), [...], {...} segments iteratively
  let result = value;
  for (let i = 0; i < 32; i++) {
    const next = stripFirstEnclosedSegment(result);
    if (next === result) break;
    result = next;
  }
  return result;
}

function stripFirstEnclosedSegment(value: string): string {
  // Try parentheses first
  const parenOpen = value.indexOf("(");
  if (parenOpen >= 0) {
    const parenClose = value.indexOf(")", parenOpen + 1);
    if (parenClose >= 0) {
      return `${value.slice(0, parenOpen)} ${value.slice(parenClose + 1)}`;
    }
  }
  // Try brackets
  const bracketOpen = value.indexOf("[");
  if (bracketOpen >= 0) {
    const bracketClose = value.indexOf("]", bracketOpen + 1);
    if (bracketClose >= 0) {
      return `${value.slice(0, bracketOpen)} ${value.slice(bracketClose + 1)}`;
    }
  }
  return value;
}

function stripLocaleSuffix(value: string): string {
  // "es-mx" -> "es", "pt-br" -> "pt", "zh-cn" -> "zh"
  const match = value.match(/^([a-z]{2,3})-[a-z]{2,4}$/);
  return match?.[1] ?? value;
}
