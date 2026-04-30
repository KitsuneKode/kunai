// Wyzie subtitle API: the player makes a search request to sub.wyzie.io with an
// embedded API key. We capture the request URL, then fetch it ourselves so we
// control language selection instead of relying on what the player auto-picks.

import { dbg, dbgErr } from "@/logger";

export type SubtitleEntry = {
  id: string;
  url: string;
  display: string;
  language: string;
  release: string;
};

export function parseWyzieSubtitleList(payload: unknown): SubtitleEntry[] {
  const candidates =
    Array.isArray(payload) || !payload || typeof payload !== "object"
      ? payload
      : ((payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).subtitles ??
        (payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).tracks ??
        (payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).results);

  if (!Array.isArray(candidates)) return [];

  return candidates.filter(isSubtitleEntry);
}

// True when an entry's language code matches the requested code.
// Handles: exact match, locale variants (en === en-US), and full-name strings.
function langMatches(entryLang: string, preferred: string): boolean {
  const el = entryLang.toLowerCase().trim();
  const pl = preferred.toLowerCase().trim();
  if (!el || !pl) return false;
  if (el === pl || el.startsWith(pl + "-") || pl.startsWith(el + "-")) return true;

  // Map ISO 639-1 codes ↔ common English full-name representations.
  // Wyzie often returns "English" when the player auto-picks; we request "en".
  const CODE_TO_NAME: Record<string, string> = {
    en: "english",
    es: "spanish",
    fr: "french",
    de: "german",
    it: "italian",
    pt: "portuguese",
    ru: "russian",
    ja: "japanese",
    ar: "arabic",
    ko: "korean",
    zh: "chinese",
    hi: "hindi",
    nl: "dutch",
    pl: "polish",
    tr: "turkish",
    sv: "swedish",
    da: "danish",
    fi: "finnish",
    no: "norwegian",
    cs: "czech",
    hu: "hungarian",
    ro: "romanian",
    th: "thai",
    vi: "vietnamese",
    id: "indonesian",
  };

  const plFull = CODE_TO_NAME[pl];
  const elFull = CODE_TO_NAME[el];

  if (plFull && (el === plFull || el.startsWith(plFull))) return true;
  if (elFull && (pl === elFull || pl.startsWith(elFull))) return true;

  return false;
}

// Among a filtered set, prefer non-hearing-impaired entries with the most downloads.
function bestFrom(candidates: SubtitleEntry[]): SubtitleEntry | null {
  if (candidates.length === 0) return null;
  const normal = candidates.filter(
    (s) => !(s as SubtitleEntry & { isHearingImpaired?: boolean }).isHearingImpaired,
  );
  const pool = normal.length > 0 ? normal : candidates;
  return pool.reduce((best, s) => {
    const bc = (best as SubtitleEntry & { downloadCount?: number }).downloadCount ?? 0;
    const sc = (s as SubtitleEntry & { downloadCount?: number }).downloadCount ?? 0;
    return sc > bc ? s : best;
  });
}

export function selectSubtitle(list: SubtitleEntry[], preferredLang: string): SubtitleEntry | null {
  // 1. Exact-language match (with locale variant tolerance)
  const exactMatches = list.filter((s) => langMatches(s.language, preferredLang));
  if (exactMatches.length > 0) return bestFrom(exactMatches);

  // 2. English fallback when a non-English language was requested
  if (!langMatches(preferredLang, "en")) {
    const englishMatches = list.filter((s) => langMatches(s.language, "en"));
    if (englishMatches.length > 0) return bestFrom(englishMatches);
  }

  // 3. Last resort: best entry from whatever is available
  return bestFrom(list);
}

export async function fetchSubtitlesFromWyzie(
  searchUrl: string,
  preferredLang: string,
  requestHeaders?: Record<string, string>,
): Promise<{ list: SubtitleEntry[]; selected: string | null; failed: boolean }> {
  const headers = buildWyzieHeaders(requestHeaders);
  dbg("subtitle", "fetch wyzie subtitles", {
    preferredLang,
    url: redactWyzieKey(searchUrl),
    headerKeys: Object.keys(headers),
  });

  for (const timeoutMs of [8_000, 12_000]) {
    try {
      const res = await fetch(searchUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers,
      });
      dbg("subtitle", "wyzie response", {
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        timeoutMs,
      });

      if (!res.ok) {
        continue;
      }

      const list = parseWyzieSubtitleList(await res.json());
      if (list.length === 0) {
        dbg("subtitle", "wyzie empty result", {
          preferredLang,
          url: redactWyzieKey(searchUrl),
          timeoutMs,
        });
        return { list: [], selected: null, failed: false };
      }

      const pick = selectSubtitle(list, preferredLang);

      dbg("subtitle", "wyzie selected subtitle", {
        preferredLang,
        selectedLanguage: pick?.language ?? null,
        selectedDisplay: pick?.display ?? null,
        total: list.length,
        timeoutMs,
      });

      return { list, selected: pick?.url ?? null, failed: false };
    } catch (error) {
      dbgErr("subtitle", "wyzie fetch attempt failed", { error, timeoutMs });
      if (timeoutMs === 12_000) {
        return { list: [], selected: null, failed: true };
      }
    }
  }

  return { list: [], selected: null, failed: true };
}

function buildWyzieHeaders(requestHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  };

  for (const key of ["user-agent", "referer", "origin", "accept", "accept-language"]) {
    const value = requestHeaders?.[key];
    if (value) headers[key] = value;
  }

  return headers;
}

function redactWyzieKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("key")) parsed.searchParams.set("key", "<redacted>");
    return parsed.toString();
  } catch {
    return url.replace(/key=[^&]+/, "key=<redacted>");
  }
}

function isSubtitleEntry(value: unknown): value is SubtitleEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SubtitleEntry>;
  return (
    typeof entry.url === "string" &&
    entry.url.length > 0 &&
    typeof entry.language === "string" &&
    entry.language.length > 0
  );
}

// =============================================================================
// ACTIVE WYZIE RESOLUTION
//
// Bypasses the passive browser-sniffing approach entirely. The Wyzie API key
// embedded in Vidking's player is static and reusable. We call the search
// endpoint directly with the TMDB ID + episode info so we never need to wait
// for the embed to click the CC button.
//
// Ref: .docs/subtitle-resolver-analysis.md
// =============================================================================

const WYZIE_KEY = "wyzie-4e88cddcd20e4d3e9a390625e66a290c";
const WYZIE_SEARCH = "https://sub.wyzie.io/search";

export async function resolveSubtitlesByTmdbId(opts: {
  tmdbId: string;
  type: "movie" | "series";
  season?: number;
  episode?: number;
  preferredLang: string;
}): Promise<{ list: SubtitleEntry[]; selected: string | null; failed: boolean }> {
  const { tmdbId, type, season, episode, preferredLang } = opts;

  try {
    const params = new URLSearchParams({ id: tmdbId, key: WYZIE_KEY });
    if (type === "series" && season != null) params.set("season", String(season));
    if (type === "series" && episode != null) params.set("episode", String(episode));

    const url = `${WYZIE_SEARCH}?${params.toString()}`;
    dbg("subtitle", "active wyzie fetch", {
      tmdbId,
      type,
      season,
      episode,
      preferredLang,
      url: redactWyzieKey(url),
    });

    return await fetchSubtitlesFromWyzie(url, preferredLang, {
      referer: "https://www.vidking.net/",
      origin: "https://www.vidking.net",
      "accept-language": "en-US,en;q=0.9",
    });
  } catch (error) {
    dbgErr("subtitle", "active wyzie fetch failed", error);
    return { list: [], selected: null, failed: true };
  }
}
