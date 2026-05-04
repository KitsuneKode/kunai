// Wyzie subtitle API: the player makes a search request to sub.wyzie.io with an
// embedded API key. We capture the request URL, then fetch it ourselves so we
// control language selection instead of relying on what the player auto-picks.

import { dbg, dbgErr } from "@/logger";

export type SubtitleEntry = {
  id?: string;
  url: string;
  display?: string;
  language?: string;
  release?: string;
  sourceKind?: "embedded" | "external";
  sourceName?: string;
  isHearingImpaired?: boolean;
  downloadCount?: number;
};

export function parseWyzieSubtitleList(payload: unknown): SubtitleEntry[] {
  const candidates =
    Array.isArray(payload) || !payload || typeof payload !== "object"
      ? payload
      : ((payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).subtitles ??
        (payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).tracks ??
        (payload as { subtitles?: unknown; tracks?: unknown; results?: unknown }).results);

  if (!Array.isArray(candidates)) return [];

  return candidates
    .map(normalizeWyzieSubtitleEntry)
    .filter((entry): entry is SubtitleEntry => entry !== null);
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

function subtitleHints(entry: SubtitleEntry): string[] {
  const values = [entry.language, entry.display, entry.release, entry.url, entry.sourceName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase().trim());
  return Array.from(new Set(values));
}

export type SubtitleSourcePreference = "source-first" | "external-first" | "any";
export type SubtitleAccessibilityPreference = "avoid-sdh" | "prefer-sdh" | "any";

export type SubtitleSelectionOptions = {
  preferredLang: string;
  sourcePreference?: SubtitleSourcePreference;
  accessibilityPreference?: SubtitleAccessibilityPreference;
  fallbackLang?: string;
};

export type RankedSubtitleEntry = {
  entry: SubtitleEntry;
  score: number;
  reasons: string[];
};

export function rankSubtitleCandidates(
  list: readonly SubtitleEntry[],
  options: SubtitleSelectionOptions,
): RankedSubtitleEntry[] {
  const preferredLang = options.preferredLang;
  const sourcePreference = options.sourcePreference ?? "source-first";
  const accessibilityPreference = options.accessibilityPreference ?? "avoid-sdh";
  const fallbackLang = options.fallbackLang ?? "en";

  return dedupeSubtitleEntries(list)
    .map((entry) =>
      scoreSubtitleEntry(entry, {
        preferredLang,
        sourcePreference,
        accessibilityPreference,
        fallbackLang,
      }),
    )
    .sort((left, right) => {
      const delta = right.score - left.score;
      if (delta !== 0) return delta;
      return compareSubtitleEntries(left.entry, right.entry) * -1;
    });
}

export function selectSubtitle(
  list: SubtitleEntry[],
  preferredLang: string,
  options: Partial<Omit<SubtitleSelectionOptions, "preferredLang">> = {},
): SubtitleEntry | null {
  const ranked = rankSubtitleCandidates(list, { ...options, preferredLang });
  return ranked[0]?.entry ?? null;
}

export function mergeSubtitleTracks<T extends { url: string }>(
  primary: readonly T[] | undefined,
  secondary: readonly T[] | undefined,
): T[] {
  const merged = new Map<string, T>();
  const order: string[] = [];

  const absorb = (track: T, preferExisting: boolean) => {
    const key = track.url.trim();
    if (!key) return;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, track);
      order.push(key);
      return;
    }

    merged.set(key, mergeTrackObjects(existing, track, preferExisting));
  };

  for (const track of primary ?? []) absorb(track, true);
  for (const track of secondary ?? []) absorb(track, false);

  return order.map((key) => merged.get(key)).filter((track): track is T => track !== undefined);
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

      const ranked = rankSubtitleCandidates(list, { preferredLang });
      const pick = ranked[0]?.entry ?? null;

      dbg("subtitle", "wyzie selected subtitle", {
        preferredLang,
        selectedLanguage: pick?.language ?? null,
        selectedDisplay: pick?.display ?? null,
        selectedScore: ranked[0]?.score ?? null,
        selectedReasons: ranked[0]?.reasons ?? [],
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

function normalizeWyzieSubtitleEntry(value: unknown): SubtitleEntry | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const url = firstString(raw.url, raw.src, raw.file, raw.href);
  const language = firstString(raw.language, raw.lang, raw.isoCode, raw.locale);

  if (!url || !language) return null;

  const display = firstString(raw.display, raw.label, raw.name, raw.language, raw.lang) ?? language;
  const release = firstString(raw.release, raw.version, raw.filename) ?? "";
  const id = firstString(raw.id, raw.slug, raw.url) ?? url;
  const sourceName = firstString(raw.source, raw.sourceName, raw.provider, raw.origin);
  const downloadCount = asNumber(raw.downloadCount, raw.downloads, raw.count);

  return {
    id,
    url,
    display,
    language,
    release,
    sourceKind: "external",
    sourceName: sourceName?.toLowerCase(),
    isHearingImpaired: detectHearingImpaired(display, release),
    downloadCount,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function asNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function detectHearingImpaired(...values: Array<string | undefined>): boolean {
  const raw = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return raw.includes("sdh") || /\bhi\b/.test(raw) || raw.includes("hearing");
}

function sourcePriority(entry: SubtitleEntry): number {
  const sourceName = entry.sourceName?.toLowerCase();
  if (sourceName === "provider" || sourceName === "vidking" || sourceName === "allanime") {
    return 4;
  }
  switch (entry.sourceKind) {
    case "embedded":
      return 3;
    case undefined:
      return 2;
    case "external":
      return 1;
    default:
      return 0;
  }
}

function dedupeSubtitleEntries(list: readonly SubtitleEntry[]): SubtitleEntry[] {
  const merged = new Map<string, SubtitleEntry>();
  const order: string[] = [];
  for (const entry of list) {
    const key = normalizeSubtitleUrl(entry.url);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      order.push(key);
      continue;
    }
    merged.set(
      key,
      mergeTrackObjects(existing, entry, compareSubtitleEntries(existing, entry) >= 0),
    );
  }
  return order.map((key) => merged.get(key)).filter((entry): entry is SubtitleEntry => !!entry);
}

function normalizeSubtitleUrl(url: string): string {
  return url.trim();
}

function scoreSubtitleEntry(
  entry: SubtitleEntry,
  options: Required<SubtitleSelectionOptions>,
): RankedSubtitleEntry {
  let score = 0;
  const reasons: string[] = [];
  const hints = subtitleHints(entry);

  if (hints.some((hint) => langMatches(hint, options.preferredLang))) {
    score += 1_000;
    reasons.push("preferred-language");
  } else if (
    options.fallbackLang &&
    !langMatches(options.preferredLang, options.fallbackLang) &&
    hints.some((hint) => langMatches(hint, options.fallbackLang))
  ) {
    score += 650;
    reasons.push("fallback-language");
  } else {
    score += 100;
    reasons.push("any-language");
  }

  const source = sourcePriority(entry);
  const sourceScore =
    options.sourcePreference === "source-first"
      ? source * 90
      : options.sourcePreference === "external-first"
        ? (4 - source) * 90
        : source * 20;
  score += sourceScore;
  if (source >= 3) reasons.push("source-subtitle");
  else if (entry.sourceKind === "external") reasons.push("external-subtitle");

  if (entry.isHearingImpaired) {
    if (options.accessibilityPreference === "prefer-sdh") {
      score += 80;
      reasons.push("accessibility-preferred");
    } else if (options.accessibilityPreference === "avoid-sdh") {
      score -= 80;
      reasons.push("accessibility-avoided");
    }
  } else if (options.accessibilityPreference === "avoid-sdh") {
    score += 40;
    reasons.push("non-sdh");
  }

  if (entry.release && /s\d{1,2}e\d{1,3}|\b\d{3,4}p\b|webrip|web-dl|bluray/i.test(entry.release)) {
    score += 35;
    reasons.push("sync-evidence");
  }

  if (/\.(vtt|srt|ass)(?:$|[?#])/i.test(entry.url)) {
    score += 20;
    reasons.push("known-format");
  }

  score += Math.min(entry.downloadCount ?? 0, 10_000) / 1_000;

  return { entry, score, reasons };
}

function compareSubtitleEntries(left: SubtitleEntry, right: SubtitleEntry): number {
  const sourceDelta = sourcePriority(left) - sourcePriority(right);
  if (sourceDelta !== 0) return sourceDelta;

  const hiDelta =
    Number(Boolean(right.isHearingImpaired)) - Number(Boolean(left.isHearingImpaired));
  if (hiDelta !== 0) return hiDelta;

  const downloadDelta = (left.downloadCount ?? 0) - (right.downloadCount ?? 0);
  if (downloadDelta !== 0) return downloadDelta;

  return 0;
}

function mergeTrackObjects<T extends { url: string }>(
  existing: T,
  incoming: T,
  preferExisting: boolean,
): T {
  const winner = preferExisting ? existing : incoming;
  const loser = preferExisting ? incoming : existing;

  const result: Record<string, unknown> = { ...winner };
  for (const [key, value] of Object.entries(loser)) {
    if (result[key] === undefined || result[key] === "") {
      result[key] = value;
    }
  }

  return result as T;
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
    if (type === "series" && season !== undefined) params.set("season", String(season));
    if (type === "series" && episode !== undefined) params.set("episode", String(episode));
    if (preferredLang && preferredLang !== "none" && preferredLang !== "fzf") {
      params.set("language", preferredLang);
    }

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
