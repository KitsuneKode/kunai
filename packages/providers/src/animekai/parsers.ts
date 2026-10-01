/**
 * Pure AnimeKai markup/JSON parsing.
 *
 * Shapes mirror ani-cli `next` branch (v5.2.0) `animekai_search` /
 * `animekai_episodes` sed pipelines, hardened for attribute order and
 * entity-encoded titles. No network here.
 */

import { decodeMarkupEntities, markupToPlainText } from "../shared/markup-text";
import { parseMegaplayEmbedDataId, parseMegaplaySourcesJson } from "../shared/megaplay-embed";
import { filterResultsByQueryWords, longestWordFallbackQuery } from "../shared/search-fallback";

export const ANIMEKAI_BASE = "https://animekai.be";
export const ANIMEKAI_REFERER = "https://animekai.be/";
export const ANIMEKAI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type AnimekaiAudioMode = "sub" | "dub";

export interface AnimekaiSearchResult {
  /** Watch-page slug (`/watch/<slug>`). */
  readonly id: string;
  readonly title: string;
  /** `data-jp` — the Japanese/romaji name, where AniList's title usually lives. */
  readonly nativeTitle?: string;
  /** Reported episode counts per audio mode, when the card exposes them. */
  readonly subCount?: number;
  readonly dubCount?: number;
  readonly format?: string;
}

export interface AnimekaiEpisodeEntry {
  /** 1-based episode number from the `num` attribute. */
  readonly number: number;
  /** `data-sub="1"` / `data-dub="1"` — per-episode audio availability. */
  readonly sub: boolean;
  readonly dub: boolean;
  /** `langs` attribute: subtitle track count advertised on the anchor. */
  readonly langs?: number;
  /** Episode title text inside the anchor, when present. */
  readonly title?: string;
}

export interface AnimekaiServerEntry {
  readonly audioMode: AnimekaiAudioMode;
  readonly serverName: string;
  readonly embedUrl: string;
}

/** Lowercase kebab slugs — `/watch/<slug>` ids. */
export function looksLikeAnimekaiShowId(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value.trim());
}

function lastPathSegment(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}

function extractAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const value = pattern.exec(tag)?.[1];
  return value?.trim() ? value : undefined;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Browse page → results. One `.aitem` block per hit; the title anchor carries
 * slug, title, and `data-jp` (the name AniList's romaji title usually equals).
 * The card's `.info` spans advertise per-mode episode counts.
 */
export function parseAnimekaiSearchHtml(html: string): readonly AnimekaiSearchResult[] {
  const results: AnimekaiSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<div class="aitem">/i).slice(1)) {
    const anchorTag = /<a\b[^>]*class="title"[^>]*>/i.exec(block)?.[0];
    if (!anchorTag) continue;
    const href = extractAttribute(anchorTag, "href");
    const titleAttr = extractAttribute(anchorTag, "title");
    const jpAttr = extractAttribute(anchorTag, "data-jp");
    if (!href || !titleAttr) continue;
    const slug = lastPathSegment(decodeMarkupEntities(href).trim());
    const title = markupToPlainText(titleAttr);
    if (!looksLikeAnimekaiShowId(slug) || !title || seen.has(slug)) continue;
    seen.add(slug);

    const subCount = /<span class="sub">[^0-9]*(\d+)/i.exec(block)?.[1];
    const dubCount = /<span class="dub">[^0-9]*(\d+)/i.exec(block)?.[1];
    const format = /<b>([A-Za-z]+)<\/b>/i.exec(block)?.[1];
    results.push({
      id: slug,
      title,
      ...(jpAttr?.trim() && { nativeTitle: markupToPlainText(jpAttr) }),
      ...(subCount && { subCount: Number.parseInt(subCount, 10) }),
      ...(dubCount && { dubCount: Number.parseInt(dubCount, 10) }),
      ...(format && { format }),
    });
  }
  return results;
}

/**
 * Pick the result a query actually asked for. Unlike hianime's matcher this
 * also scores `data-jp`: AniList hands Kunai romaji titles ("Sousou no
 * Frieren"), which is what `data-jp` carries, while `title` is the English
 * display name — matching only the display name misses every romaji query.
 */
export function chooseAnimekaiSearchMatch(
  query: string,
  results: readonly AnimekaiSearchResult[],
): AnimekaiSearchResult | null {
  const fallback = results[0] ?? null;
  const normalizedQuery = normalizeTitle(query);
  if (results.length === 0 || !normalizedQuery) return fallback;

  const names = (result: AnimekaiSearchResult) =>
    [result.title, result.nativeTitle].filter((name): name is string => Boolean(name));

  for (const result of results) {
    if (names(result).some((name) => normalizeTitle(name) === normalizedQuery)) return result;
  }
  for (const result of results) {
    if (
      names(result).some((name) => {
        const normalized = normalizeTitle(name);
        return (
          normalized.startsWith(`${normalizedQuery} `) ||
          normalizedQuery.startsWith(`${normalized} `)
        );
      })
    ) {
      return result;
    }
  }
  return fallback;
}

/**
 * The site matches the query as one literal phrase, so "cyberpunk edgerunners"
 * misses "Cyberpunk: Edgerunners". ani-cli's fix: retry with the longest word,
 * then keep only results containing every other word. Returns the candidate
 * fallback query (longest word) or null when the query is a single word.
 * Shared with the other literal-phrase catalogs via `shared/search-fallback`.
 */
export function animekaiLongestWordFallback(query: string): string | null {
  return longestWordFallbackQuery(query);
}

/** Keep results whose title or `data-jp` contains every word of the query. */
export function animekaiFilterResultsByQueryWords(
  results: readonly AnimekaiSearchResult[],
  query: string,
): readonly AnimekaiSearchResult[] {
  return filterResultsByQueryWords(results, query, (row) => [row.title, row.nativeTitle]);
}

/**
 * Watch page → episodes. Each anchor is attribute-order-free parsed:
 * `href="…/watch/<slug>/ep-N"`, `num`, `data-sub`, `data-dub`, `langs`.
 * Anchors for a different show's slug are skipped — the page embeds related
 * entries. Episodes are de-duplicated by number.
 */
export function parseAnimekaiEpisodesHtml(
  html: string,
  slug: string,
): readonly AnimekaiEpisodeEntry[] {
  const entries: AnimekaiEpisodeEntry[] = [];
  const seen = new Set<number>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const href = extractAttribute(attrs, "href");
    if (!href) continue;
    const epMatch = /\/watch\/([^/"']+)\/ep-(\d+)/i.exec(decodeMarkupEntities(href));
    if (!epMatch) continue;
    if (slug && epMatch[1] && epMatch[1] !== slug) continue;
    const rawNumber = extractAttribute(attrs, "num");
    const parsed = rawNumber !== undefined ? Number.parseInt(rawNumber, 10) : Number.NaN;
    const number = Number.isInteger(parsed) && parsed > 0 ? parsed : Number(epMatch[2]);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    const langs = extractAttribute(attrs, "langs");
    const title = markupToPlainText(body)
      .replace(/^\d+\s*/, "")
      .trim();
    entries.push({
      number,
      sub: extractAttribute(attrs, "data-sub") === "1",
      dub: extractAttribute(attrs, "data-dub") === "1",
      ...(langs && { langs: Number.parseInt(langs, 10) }),
      ...(title && { title }),
    });
  }
  return entries.sort((a, b) => a.number - b.number);
}

/**
 * `/watch/<slug>/ep/<n>/sources` JSON → per-mode server entries. Each entry's
 * `source_url` is an embed URL (currently megaplay.buzz); the embed carries the
 * MAL id in its path. Undecodable/non-HTTP URLs are dropped — that server is
 * unusable, not the whole mode.
 */
export function parseAnimekaiServersJson(json: unknown): readonly AnimekaiServerEntry[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const sources = (json as { sources?: unknown }).sources;
  if (!sources || typeof sources !== "object") return [];
  const entries: AnimekaiServerEntry[] = [];
  for (const mode of ["sub", "dub"] as const) {
    const list = (sources as Record<string, unknown>)[mode];
    if (!Array.isArray(list)) continue;
    for (const [index, item] of list.entries()) {
      if (!item || typeof item !== "object") continue;
      const sourceUrl = (item as { source_url?: unknown }).source_url;
      const serverName = (item as { server_name?: unknown }).server_name;
      if (typeof sourceUrl !== "string" || !/^https?:\/\//i.test(sourceUrl)) continue;
      entries.push({
        audioMode: mode,
        serverName:
          typeof serverName === "string" && serverName.trim()
            ? serverName.trim()
            : `Server ${index + 1}`,
        embedUrl: sourceUrl,
      });
    }
  }
  return entries;
}

/** `data-id` on the embed page is the player id the sources endpoint wants. */
export const parseAnimekaiEmbedDataId = parseMegaplayEmbedDataId;

/** MAL id rides in the embed path (`/stream/mal/<id>/…`) for skip metadata. */
export function animekaiMalIdFromEmbedUrl(url: string): string | undefined {
  return /\/mal\/(\d+)\//i.exec(url)?.[1];
}

export interface AnimekaiSourcesPayload {
  readonly enc: string;
  readonly tracks: readonly {
    readonly file: string;
    readonly label?: string;
    readonly kind?: string;
    readonly isDefault?: boolean;
  }[];
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
}

/** `getSources` JSON: `enc` blob, subtitle `tracks`, and `intro`/`outro`. */
export const parseAnimekaiSourcesJson: (json: unknown) => AnimekaiSourcesPayload | null =
  parseMegaplaySourcesJson;
