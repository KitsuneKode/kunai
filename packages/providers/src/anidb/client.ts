import type { ProviderRuntimeContext } from "@kunai/types";

import { expandHlsMasterPlaylist } from "../shared/hls-ladder";
import { TTLCache } from "../shared/provider-cache";

export const ANIDB_BASE = "https://anidb.app";
export const ANIDB_REFERER = "https://anidb.app/";
export const ANIDB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const episodeCache = new TTLCache<string, readonly AnidbEpisodeEntry[]>(1_800_000);
const languageCache = new TTLCache<string, readonly AnidbLanguageEntry[]>(300_000);

export type AnidbSearchResult = {
  readonly id: string;
  readonly title: string;
  readonly numericId: number;
};

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
  readonly referer: string;
  readonly protocol: "hls";
  readonly container: "m3u8";
};

/** `slug-1234` show ids used by anidb.app / ani-cli. */
export function looksLikeAnidbShowId(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i.test(value.trim());
}

export function anidbNumericId(showId: string): number | null {
  const match = /-(\d+)$/.exec(showId.trim());
  if (!match?.[1]) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * anidb.app HTML/JSON often CF-blocks Bun fetch. Prefer curl with a browser UA
 * (ani-cli uses curl / curl-impersonate; plain curl works on this machine).
 */
export async function anidbFetchText(
  url: string,
  options: { readonly signal?: AbortSignal; readonly maxTimeSec?: number } = {},
): Promise<string> {
  const curlPath = Bun.which("curl");
  if (!curlPath) {
    const response = await fetch(url, {
      headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
      signal: options.signal ?? AbortSignal.timeout(15_000),
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
    curlPath,
    "-sL",
    "-A",
    ANIDB_USER_AGENT,
    "-H",
    `Referer: ${ANIDB_REFERER}`,
    "--max-time",
    maxTime,
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
): Promise<readonly AnidbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const url = `${ANIDB_BASE}/browse?q=${encodeURIComponent(trimmed)}`;
  const page = await anidbFetchText(url, { signal });
  const results: AnidbSearchResult[] = [];
  const seen = new Set<string>();
  const pattern = /anime\/([a-z0-9-]+-\d+)"[^>]*alt="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(page)) !== null) {
    const id = match[1];
    const title = decodeHtmlEntities(match[2] ?? "").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const numericId = anidbNumericId(id);
    if (!numericId) continue;
    results.push({ id, title, numericId });
  }
  return results;
}

export async function fetchAnidbMalId(
  showId: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    const page = await anidbFetchText(`${ANIDB_BASE}/anime/${encodeURIComponent(showId)}`, {
      signal,
    });
    const mal = /https:\/\/myanimelist\.net\/anime\/(\d+)/.exec(page)?.[1];
    const parsed = mal ? Number(mal) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchAnidbEpisodes(
  showId: string,
  signal?: AbortSignal,
): Promise<readonly AnidbEpisodeEntry[]> {
  const numericId = anidbNumericId(showId);
  if (!numericId) return [];
  const cached = episodeCache.get(showId);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/anime/${numericId}/episodes`;
  const text = await anidbFetchText(url, { signal });
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
): Promise<readonly AnidbLanguageEntry[]> {
  const cacheKey = String(episodeId);
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/episode/${episodeId}/languages`;
  const text = await anidbFetchText(url, { signal });
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
): Promise<string | null> {
  const page = await anidbFetchText(embedUrl, { signal });
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
  const episodes = await fetchAnidbEpisodes(options.showId, options.signal);
  const episode = episodes.find((entry) => entry.number === options.episodeNumber);
  if (!episode) return [];

  const languages = await fetchAnidbLanguages(episode.id, options.signal);
  const preferredCode = options.audioMode === "dub" ? "eng" : "jpn";
  const fallbackCode = options.audioMode === "dub" ? "jpn" : "eng";
  const language =
    languages.find((entry) => entry.code === preferredCode) ??
    languages.find((entry) => entry.code === fallbackCode) ??
    languages[0];
  if (!language) return [];

  const masterUrl = await fetchAnidbMasterUrl(language.embedUrl, options.signal);
  if (!masterUrl) return [];

  const fetchPort =
    options.context?.fetch?.fetch?.bind(options.context.fetch) ??
    ((url: string, init?: RequestInit) =>
      fetch(url, {
        ...init,
        headers: {
          "User-Agent": ANIDB_USER_AGENT,
          Referer: ANIDB_REFERER,
          ...(init?.headers as Record<string, string> | undefined),
        },
      }));

  const variants = await expandHlsMasterPlaylist({
    fetch: fetchPort,
    masterUrl,
    headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
    signal: options.signal,
  });

  return variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel,
    referer: ANIDB_REFERER,
    protocol: "hls" as const,
    container: "m3u8" as const,
  }));
}

export function clearAnidbCachesForTest(): void {
  episodeCache.clear();
  languageCache.clear();
}
