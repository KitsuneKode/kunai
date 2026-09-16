/**
 * Pure HiAnime search / episode / server markup parsing.
 *
 * Shapes mirror ani-cli's `hianime_search` / `hianime_episodes` sed pipelines,
 * hardened for attribute order and entity-encoded titles. No network here.
 */

import { decodeMarkupEntities, markupToPlainText } from "../shared/markup-text";

export const HIANIME_BASE = "https://hianime.at";
export const HIANIME_REFERER = "https://hianime.at/";
export const HIANIME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface HianimeSearchResult {
  readonly id: string;
  readonly title: string;
}

export interface HianimeEpisodeEntry {
  /** Provider episode id for the servers API (`data-id`). Opaque, never trimmed. */
  readonly episodeId: string;
  /** 1-based display number (`data-number`), or document position when non-numeric. */
  readonly number: number;
  readonly title?: string;
}

export type HianimeAudioMode = "sub" | "dub";

export interface HianimeServerEntry {
  readonly audioMode: HianimeAudioMode;
  readonly serverName: string;
  readonly embedUrl: string;
}

/** `slug-1234` show ids. The suffix must be positive (episodes API takes it raw). */
export function looksLikeHianimeShowId(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i.test(value.trim()) && hianimeNumericId(value) !== null;
}

export function hianimeNumericId(showId: string): number | null {
  const match = /-(\d+)$/.exec(showId.trim());
  if (!match?.[1]) return null;
  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function lastPathSegment(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}

/**
 * Search page → show slugs. Cuts the `main-sidebar` (it repeats result markup)
 * and reads one `(slug, title)` per `film-detail` block, like ani-cli.
 */
export function parseHianimeSearchHtml(html: string): readonly HianimeSearchResult[] {
  const main = html.split('id="main-sidebar"')[0] ?? html;
  const results: HianimeSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of main.split('<div class="film-detail">').slice(1)) {
    const anchor = /<h3 class="film-name">\s*<a href="([^"]*)"\s*title="([^"]*)"/.exec(block);
    if (!anchor) continue;
    const id = lastPathSegment(decodeMarkupEntities(anchor[1] ?? "").trim());
    const title = decodeMarkupEntities(anchor[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!looksLikeHianimeShowId(id) || !title || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, title });
  }
  return results;
}

/** Pick the result a query actually asked for instead of trusting document order. */
export function chooseHianimeSearchMatch(
  query: string,
  results: readonly HianimeSearchResult[],
): HianimeSearchResult | null {
  const fallback = results[0] ?? null;
  const normalizedQuery = normalizeTitle(query);
  if (results.length === 0 || !normalizedQuery) return fallback;
  const exact = results.find((result) => normalizeTitle(result.title) === normalizedQuery);
  if (exact) return exact;
  const prefixed = results.find((result) => {
    const normalizedTitle = normalizeTitle(result.title);
    return (
      normalizedTitle.startsWith(`${normalizedQuery} `) ||
      normalizedQuery.startsWith(`${normalizedTitle} `)
    );
  });
  return prefixed ?? fallback;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const value = pattern.exec(tag)?.[1];
  return value?.trim() ? value : undefined;
}

function extractEpisodeTitle(block: string): string | undefined {
  const jname = /data-jname\s*=\s*["']([^"']*)["']/i.exec(block)?.[1];
  if (jname?.trim()) return decodeMarkupEntities(jname).replace(/\s+/g, " ").trim();
  const named = /<div\b[^>]*class="[^"]*ep-name[^"]*"[^>]*title\s*=\s*["']([^"']*)["']/i.exec(
    block,
  )?.[1];
  if (named?.trim()) return decodeMarkupEntities(named).replace(/\s+/g, " ").trim();
  const text = markupToPlainText(block);
  return text || undefined;
}

/**
 * Episodes API `{html}` → entries. The href slug must match the requested show
 * (ani-cli guards this too): ids from a same-shaped foreign catalog are skipped.
 */
export function parseHianimeEpisodesHtml(
  html: string,
  slug: string,
): readonly HianimeEpisodeEntry[] {
  const entries: HianimeEpisodeEntry[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let position = 0;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (!/\bep-item\b/.test(attrs)) continue;
    const rawNumber = extractAttribute(attrs, "data-number");
    const episodeId = extractAttribute(attrs, "data-id");
    const href = extractAttribute(attrs, "href");
    if (!episodeId || !/^[0-9]+$/.test(episodeId)) continue;
    if (href && slug) {
      const hrefSlug = lastPathSegment(href.split("?ep=")[0] ?? "");
      if (hrefSlug && hrefSlug !== slug) continue;
    }
    position += 1;
    const parsed = rawNumber !== undefined ? Number.parseInt(rawNumber, 10) : Number.NaN;
    const number = Number.isInteger(parsed) && parsed > 0 ? parsed : position;
    const title = extractEpisodeTitle(body);
    entries.push({ episodeId, number, ...(title ? { title } : {}) });
  }
  return entries;
}

/**
 * Servers API `{html}` → per-mode server entries. `data-hash` is a base64 embed
 * URL; undecodable or non-HTTP hashes are dropped (that server is unusable).
 */
export function parseHianimeServersHtml(html: string): readonly HianimeServerEntry[] {
  const entries: HianimeServerEntry[] = [];
  const divPattern = /<div\b([^>]*\bserver-item\b[^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = divPattern.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const rawType = extractAttribute(attrs, "data-type")?.toLowerCase();
    if (rawType !== "sub" && rawType !== "dub") continue;
    const serverName = extractAttribute(attrs, "data-server-name");
    const hash = extractAttribute(attrs, "data-hash");
    if (!serverName || !hash) continue;
    let embedUrl: string | null = null;
    try {
      const decoded = Buffer.from(hash, "base64").toString("utf8").trim();
      embedUrl = /^https?:\/\//i.test(decoded) ? decoded : null;
    } catch {
      embedUrl = null;
    }
    if (!embedUrl) continue;
    entries.push({ audioMode: rawType, serverName, embedUrl });
  }
  return entries;
}
