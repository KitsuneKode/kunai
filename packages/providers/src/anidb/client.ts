import type { ProviderRuntimeContext } from "@kunai/types";

import type { AnimeEpisodeMetadata } from "../shared/anime-metadata";
import { curlCipherArgs, resolveCurlCandidate } from "../shared/curl-impersonate";
import { expandHlsMasterPlaylist } from "../shared/hls-ladder";
import { markupToPlainText } from "../shared/markup-text";
import { TTLCache } from "../shared/provider-cache";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { anidbNumericId, parseAnidbBrowseHtml, type AnidbSearchResult } from "./browse-parser";

export {
  anidbNumericId,
  chooseAnidbSearchMatch,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  type AnidbSearchResult,
  type AnidbSeasonEvidence,
} from "./browse-parser";

export const ANIDB_BASE = "https://anidb.app";
export const ANIDB_REFERER = "https://anidb.app/";
/**
 * Official AniDB HTTP API. Read-only, one request per series, cached for a
 * month: AniDB's terms are strict about repeat traffic and it answers abuse by
 * banning the client name, so nothing here may run per episode or per playback.
 */
export const ANIDB_HTTP_API = "http://api.anidb.net:9001/httpapi";
export const ANIDB_HTTP_API_CLIENT = "anidb";
export const ANIDB_HTTP_API_CLIENT_VERSION = "1";
export const ANIDB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const episodeCache = new TTLCache<string, readonly AnidbEpisodeEntry[]>(1_800_000);
const languageCache = new TTLCache<string, readonly AnidbLanguageEntry[]>(300_000);
const malCache = new TTLCache<string, number | null>(3_600_000);
const externalIdsCache = new TTLCache<
  string,
  {
    readonly malId: number | null;
    readonly anilistId: string | null;
    readonly officialAid: number | null;
    readonly posterUrl: string | null;
  }
>(3_600_000);
const officialEpisodeMetadataCache = new TTLCache<
  string,
  ReadonlyMap<number, AnimeEpisodeMetadata>
>(30 * 24 * 60 * 60 * 1000);

export type AnidbEpisodeEntry = {
  readonly id: number;
  readonly number: number;
  readonly filler?: boolean;
};

export type AnidbLanguageEntry = {
  readonly code: string;
  readonly name: string;
  readonly embedUrl: string;
};

export type AnidbStreamLink = {
  readonly url: string;
  readonly quality: string;
  readonly audioMode: "sub" | "dub";
  readonly referer: string;
  readonly protocol: "hls";
  readonly container: "m3u8";
};

/**
 * curl-impersonate resolution lives in `shared/curl-impersonate.ts` (Miruro's
 * Cloudflare pipe fallback uses the same candidates). Keep the anidb-named
 * exports as thin delegates for the existing consumers.
 */
export const anidbCipherArgs = curlCipherArgs;

export function resolveAnidbCurl(
  which: (command: string) => string | null = Bun.which,
): { readonly path: string; readonly impersonates: boolean } | null {
  return resolveCurlCandidate(which);
}

/**
 * anidb.app HTML/JSON often CF-blocks Bun fetch. Prefer curl with a browser UA
 * (ani-cli uses curl / curl-impersonate; plain curl works on this machine).
 */
export async function anidbFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
  } = {},
): Promise<string> {
  if (options.context?.fetch) {
    try {
      const response = await options.context.fetch.fetch(url, {
        headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
        signal: createTimeoutSignal(options.signal, 15_000),
      });
      if (response.ok) {
        const text = await response.text();
        if (!/just a moment/i.test(text)) {
          return text;
        }
      }
    } catch {
      // Fallback to local curl/impersonate
    }
  }

  const curl = resolveAnidbCurl();
  if (!curl) {
    const response = await fetch(url, {
      headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
      signal: createTimeoutSignal(options.signal, 15_000),
    });
    if (!response.ok) {
      throw new Error(`anidb fetch HTTP ${response.status}`);
    }
    const text = await response.text();
    if (/just a moment/i.test(text)) {
      throw new Error("anidb blocked by Cloudflare (install curl)");
    }
    return text;
  }

  const maxTime = String(options.maxTimeSec ?? 12);
  const args = [
    curl.path,
    "-sL",
    "-A",
    ANIDB_USER_AGENT,
    "-H",
    `Referer: ${ANIDB_REFERER}`,
    "--max-time",
    maxTime,
    ...anidbCipherArgs(curl.impersonates),
    url,
  ];
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `curl exit ${exitCode}`);
  }
  if (/just a moment/i.test(stdout)) {
    throw new Error("anidb blocked by Cloudflare (try curl-impersonate)");
  }
  return stdout;
}

export async function searchAnidb(
  query: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const page = await anidbFetchText(`${ANIDB_BASE}/browse?q=${encodeURIComponent(trimmed)}`, {
    signal,
    context,
  });
  return parseAnidbBrowseHtml(page);
}

export async function fetchAnidbMalId(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<number | undefined> {
  // `null` is "this page has no MAL link", which is a real answer worth caching.
  // A cache miss is `undefined`, so the two must not share a representation or
  // every negative result re-scrapes AniDB on the resolve path.
  const cached = malCache.get(showId);
  if (cached !== undefined) return cached ?? undefined;

  const ids = await fetchAnidbExternalIds(showId, signal, context);
  if (!ids) return undefined;
  const result = ids?.malId ?? null;
  malCache.set(showId, result);
  return result ?? undefined;
}

export type AnidbExternalIds = {
  readonly malId?: number;
  readonly anilistId?: string;
  readonly officialAid?: number;
  readonly posterUrl?: string;
};

export async function fetchAnidbExternalIds(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<AnidbExternalIds | undefined> {
  const cached = externalIdsCache.get(showId);
  if (cached) {
    return {
      malId: cached.malId ?? undefined,
      anilistId: cached.anilistId ?? undefined,
      officialAid: cached.officialAid ?? undefined,
      posterUrl: cached.posterUrl ?? undefined,
    };
  }

  try {
    const page = await anidbFetchText(`${ANIDB_BASE}/anime/${encodeURIComponent(showId)}`, {
      signal,
      context,
    });
    const mal = /https:\/\/myanimelist\.net\/anime\/(\d+)/.exec(page)?.[1];
    const parsedMal = mal ? Number(mal) : NaN;
    const malId = Number.isFinite(parsedMal) && parsedMal > 0 ? parsedMal : null;
    const anilistId = /https:\/\/anilist\.co\/anime\/(\d+)/.exec(page)?.[1] ?? null;
    const official = /https:\/\/anidb\.net\/anime\/(\d+)/.exec(page)?.[1];
    const parsedOfficial = official ? Number(official) : NaN;
    const officialAid =
      Number.isFinite(parsedOfficial) && parsedOfficial > 0 ? parsedOfficial : null;
    const posterUrl = readMetaContent(page, "og:image") ?? null;
    externalIdsCache.set(showId, { malId, anilistId, officialAid, posterUrl });
    return {
      malId: malId ?? undefined,
      anilistId: anilistId ?? undefined,
      officialAid: officialAid ?? undefined,
      posterUrl: posterUrl ?? undefined,
    };
  } catch {
    // A transport failure says nothing about the show. Do not cache it or let a
    // Cloudflare block suppress metadata and auto-skip for the full TTL.
    return undefined;
  }
}

export async function fetchAnidbOfficialEpisodeMetadata(
  officialAid: number,
  signal?: AbortSignal,
): Promise<ReadonlyMap<number, AnimeEpisodeMetadata>> {
  const cacheKey = String(officialAid);
  const cached = officialEpisodeMetadataCache.get(cacheKey);
  if (cached) return new Map(cached);

  try {
    const response = await fetch(
      `${ANIDB_HTTP_API}?request=anime&client=${ANIDB_HTTP_API_CLIENT}&clientver=${ANIDB_HTTP_API_CLIENT_VERSION}&protover=1&aid=${officialAid}`,
      {
        headers: { Accept: "text/xml", "User-Agent": ANIDB_USER_AGENT },
        signal: createTimeoutSignal(signal, 15_000),
      },
    );
    if (!response.ok) return new Map();
    const xml = await response.text();
    // AniDB answers rate limits, bans, and bad client credentials with HTTP 200
    // and an <error> body. Caching what that parses to (nothing) would suppress
    // every episode title for this show for the full TTL, long after the block
    // lifted — so an empty read stays uncached and simply retries next time.
    if (/<error\b/i.test(xml)) return new Map();
    const metadata = parseAnidbOfficialEpisodeMetadata(xml);
    if (metadata.size === 0) return new Map();
    officialEpisodeMetadataCache.set(cacheKey, metadata);
    return new Map(metadata);
  } catch {
    return new Map();
  }
}

export function parseAnidbOfficialEpisodeMetadata(xml: string): Map<number, AnimeEpisodeMetadata> {
  const metadata = new Map<number, AnimeEpisodeMetadata>();
  const episodePattern = /<episode\b[^>]*>([\s\S]*?)<\/episode>/gi;
  let match: RegExpExecArray | null;
  while ((match = episodePattern.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const epno = readXmlElement(block, "epno");
    if (readXmlAttribute(epno.attributes, "type") !== "1") continue;
    const number = Number(epno.value);
    if (!Number.isInteger(number) || number < 1) continue;

    const title = readPreferredAnidbEpisodeTitle(block);
    const synopsis = readXmlElement(block, "summary").value;
    const airDate = readXmlElement(block, "airdate").value;
    metadata.set(number, {
      number,
      title: title || undefined,
      synopsis: synopsis || undefined,
      airDate: airDate || undefined,
      source: "anidb",
    });
  }
  return metadata;
}

function readPreferredAnidbEpisodeTitle(block: string): string {
  const titles = [...block.matchAll(/<title\b([^>]*)>([\s\S]*?)<\/title>/gi)].map((match) => ({
    language: readXmlAttribute(match[1] ?? "", "xml:lang"),
    value: normalizeXmlText(match[2] ?? ""),
  }));
  return (
    titles.find((title) => title.language === "en")?.value ??
    titles.find((title) => title.language === "x-jat")?.value ??
    titles[0]?.value ??
    ""
  );
}

function readXmlElement(
  block: string,
  name: string,
): { readonly attributes: string; readonly value: string } {
  const match = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return {
    attributes: match?.[1] ?? "",
    value: normalizeXmlText(match?.[2] ?? ""),
  };
}

function readXmlAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedName}\\s*=\\s*["']([^"']*)["']`, "i").exec(attributes)?.[1];
}

function normalizeXmlText(value: string): string {
  // Official summaries carry markup and numeric entities, and land straight in
  // terminal output. `markupToPlainText` is the same hardened path the browse
  // scraper uses: script spans first, then tags, entities decoded once, and no
  // decoded control character — `&#27;` must never become a live ESC byte.
  return markupToPlainText(value);
}

function readMetaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = new RegExp(
    `<meta\\b[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta\\b[^>]*content=["']([^"']+)["'][^>]*property=["']${escaped}["']`,
    "i",
  );
  return propertyFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1];
}

export async function fetchAnidbEpisodes(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbEpisodeEntry[]> {
  const numericId = anidbNumericId(showId);
  if (!numericId) return [];
  const cached = episodeCache.get(showId);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/anime/${numericId}/episodes`;
  const text = await anidbFetchText(url, { signal, context });
  let parsed: { episodes?: readonly Record<string, unknown>[] };
  try {
    parsed = JSON.parse(text) as { episodes?: readonly Record<string, unknown>[] };
  } catch {
    return [];
  }
  const episodes = (parsed.episodes ?? [])
    .flatMap((entry) => {
      const id = typeof entry.id === "number" ? entry.id : Number(entry.id);
      const number = typeof entry.number === "number" ? entry.number : Number(entry.number);
      if (!Number.isFinite(id) || !Number.isFinite(number) || number <= 0) return [];
      const mapped: AnidbEpisodeEntry = {
        id,
        number,
        ...(entry.filler === true ? { filler: true } : {}),
      };
      return [mapped];
    })
    .sort((left, right) => left.number - right.number);

  episodeCache.set(showId, episodes);
  return episodes;
}

export async function fetchAnidbLanguages(
  episodeId: number,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbLanguageEntry[]> {
  const cacheKey = String(episodeId);
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/episode/${episodeId}/languages`;
  const text = await anidbFetchText(url, { signal, context });
  let parsed: { languages?: readonly Record<string, unknown>[] };
  try {
    parsed = JSON.parse(text) as { languages?: readonly Record<string, unknown>[] };
  } catch {
    return [];
  }
  const languages = (parsed.languages ?? [])
    .map((entry) => {
      const code = typeof entry.code === "string" ? entry.code : "";
      const name = typeof entry.name === "string" ? entry.name : code;
      const embedRaw =
        typeof entry.embed_url === "string"
          ? entry.embed_url
          : typeof entry.embedUrl === "string"
            ? entry.embedUrl
            : "";
      const embedUrl = embedRaw.replace(/\\\//g, "/").trim();
      if (!code || !embedUrl) return null;
      return { code, name, embedUrl } satisfies AnidbLanguageEntry;
    })
    .filter((entry): entry is AnidbLanguageEntry => entry !== null);

  languageCache.set(cacheKey, languages);
  return languages;
}

export async function fetchAnidbMasterUrl(
  embedUrl: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<string | null> {
  const page = await anidbFetchText(embedUrl, { signal, context });
  const match = /file:\s*'([^']+)'/.exec(page);
  return match?.[1]?.trim() || null;
}

export async function resolveAnidbEpisodeStreams(options: {
  readonly context?: ProviderRuntimeContext;
  readonly showId: string;
  readonly episodeNumber: number;
  readonly audioMode: "sub" | "dub";
  readonly signal?: AbortSignal;
}): Promise<readonly AnidbStreamLink[]> {
  const episodes = await fetchAnidbEpisodes(options.showId, options.signal, options.context);
  const episode = episodes.find((entry) => entry.number === options.episodeNumber);
  if (!episode) return [];

  const languages = await fetchAnidbLanguages(episode.id, options.signal, options.context);
  const preferredCode = options.audioMode === "dub" ? "eng" : "jpn";
  // Do not silently play the other language and label it as the requested mode.
  // The caller can then fall back to another provider or let the user switch.
  const language = languages.find((entry) => entry.code === preferredCode);
  if (!language) return [];

  const masterUrl = await fetchAnidbMasterUrl(language.embedUrl, options.signal, options.context);
  if (!masterUrl) return [];

  // Same transport as metadata: try the relay fetch port, then curl. Using
  // context.fetch alone 404s on an unregistered /rpc/anidb and expandHls
  // silently collapses to one "auto" row.
  const variants = await expandHlsMasterPlaylist({
    fetch: async (url: string, init?: RequestInit) => {
      const text = await anidbFetchText(url, {
        signal: (init?.signal instanceof AbortSignal ? init.signal : undefined) ?? options.signal,
        context: options.context,
      });
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    },
    masterUrl,
    headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
    signal: options.signal,
  });

  return variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel,
    audioMode: options.audioMode,
    referer: ANIDB_REFERER,
    protocol: "hls" as const,
    container: "m3u8" as const,
  }));
}

export function clearAnidbCachesForTest(): void {
  episodeCache.clear();
  languageCache.clear();
  malCache.clear();
  externalIdsCache.clear();
  officialEpisodeMetadataCache.clear();
}
