/**
 * AnimeGG page parsers.
 *
 * The site is server-rendered with no JavaScript step, no crypto and no signed
 * catalog API: search, episode list, episode page and embed are four plain HTML
 * documents. These functions are the whole extraction, kept pure so the contract
 * is pinned by fixtures rather than by a live site.
 *
 * Shapes observed 2026-09-11 (see `.docs/provider-dossiers/animegg.md`).
 */
import { decodeMarkupEntities, stripTags } from "../shared/markup-text";

export const ANIMEGG_BASE_URL = "https://www.animegg.org";

export type AnimeggSearchResult = {
  readonly slug: string;
  readonly title: string;
  readonly posterUrl?: string;
  readonly episodeCount?: number;
  readonly altNames: readonly string[];
  readonly status?: string;
};

/** One `#videos` tab on an episode page: a mirror in one audio version. */
export type AnimeggEpisodeTab = {
  readonly embedId: string;
  readonly mirror: string;
  readonly version: "subbed" | "dubbed";
};

export type AnimeggEmbedSource = {
  readonly file: string;
  readonly label: string;
};

function clean(value: string | undefined): string {
  return decodeMarkupEntities(stripTags(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `/search/?q=` results. Each hit is an `<a href="/series/…" class="mse">` that
 * wraps its own poster, title and info block, so the anchor is the record
 * boundary.
 */
const NEXT_SEARCH_ANCHOR = /<a\s+href="\/series\//i;

export function parseAnimeggSearchResults(html: string): AnimeggSearchResult[] {
  const results: AnimeggSearchResult[] = [];
  const seen = new Set<string>();
  const anchor = /<a\s+href="\/series\/([^"#?]+)"[^>]*class="mse"[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const slug = match[1]?.trim();
    if (!slug || seen.has(slug)) continue;
    // Bound the record at the next result anchor, not at a fixed width: a hit
    // with no <h2> would otherwise borrow the following hit's title and pair it
    // with this slug.
    const next = anchor.lastIndex;
    const following = NEXT_SEARCH_ANCHOR.exec(html.slice(next));
    const block = html.slice(next, following ? next + following.index : undefined);

    const title = clean(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1]);
    if (!title) continue;
    seen.add(slug);

    const posterUrl = /<img[^>]+src="([^"]+)"/i.exec(block)?.[1]?.trim();
    const episodes = Number.parseInt(clean(/Episodes\s*:\s*([^<]*)/i.exec(block)?.[1]), 10);
    const altRaw = clean(/Alt Titles\s*:\s*([^<]*)/i.exec(block)?.[1]);
    const status = clean(/Status\s*:\s*([^<]*)/i.exec(block)?.[1]) || undefined;

    results.push({
      slug,
      title,
      ...(posterUrl ? { posterUrl } : {}),
      ...(Number.isFinite(episodes) && episodes > 0 ? { episodeCount: episodes } : {}),
      // The site separates alt titles with either "," or ";" — Frieren's
      // English name sits after a semicolon, and splitting on commas alone
      // left it glued to the Japanese one where no title match could reach it.
      altNames: altRaw
        .split(/[,;]/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && name !== title)
        .slice(0, 6),
      ...(status ? { status } : {}),
    });
  }
  return results;
}

/**
 * Episode numbers from a `/series/<slug>` page, ascending and de-duplicated.
 *
 * The slug is matched rather than trusted from the link text because a series
 * page also links related series' episodes, and those must not be listed as this
 * show's.
 */
export function parseAnimeggEpisodeNumbers(html: string, slug: string): number[] {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`href="/${escaped}-episode-(\\d{1,5})"`, "gi");
  const numbers = new Set<number>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const episode = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(episode) && episode > 0) numbers.add(episode);
  }
  return [...numbers].sort((left, right) => left - right);
}

/**
 * The `#videos` tab list on an episode page. Each tab carries the embed id, the
 * mirror's name and whether it is the subbed or dubbed version — the site's own
 * answer to both "which mirrors" and "which audio", so neither is guessed.
 */
export function parseAnimeggEpisodeTabs(html: string): AnimeggEpisodeTab[] {
  const tabs: AnimeggEpisodeTab[] = [];
  const seen = new Set<string>();
  const pattern =
    /data-id=['"](\d+)['"][^>]*?data-mirror=['"]([^'"]+)['"][^>]*?data-version=['"]([^'"]+)['"]/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const embedId = match[1] ?? "";
    const version = (match[3] ?? "").trim().toLowerCase();
    if (!embedId || seen.has(embedId)) continue;
    if (version !== "subbed" && version !== "dubbed") continue;
    seen.add(embedId);
    tabs.push({ embedId, mirror: clean(match[2]) || "Animegg", version });
  }
  return tabs;
}

/**
 * `var videoSources = [{file, label, bk, isBk}]` from an embed page.
 *
 * `bk` is deliberately ignored. It is a backup, but not a uniform one: for One
 * Piece it held a direct CDN URL and for Naruto an mp4upload *embed page*, which
 * would need its own extraction. Treating them alike would hand mpv an HTML
 * page. Recorded in the dossier as a future source, not used here.
 */
export function parseAnimeggEmbedSources(html: string): AnimeggEmbedSource[] {
  const sources: AnimeggEmbedSource[] = [];
  const seen = new Set<string>();
  const pattern = /\{\s*file:\s*"([^"]+)"\s*,\s*label:\s*"([^"]*)"/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const file = match[1]?.trim();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    sources.push({ file, label: clean(match[2]) });
  }
  return sources;
}

/** Absolute stream URL for an embed's relative `file`. */
export function animeggStreamUrl(file: string): string | null {
  try {
    const url = new URL(file, `${ANIMEGG_BASE_URL}/`);
    // The embed's own files are relative and resolve to https. An absolute
    // http: one would be handed to the player in the clear, with the episode
    // referer attached, so it is refused rather than downgraded silently.
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function animeggEpisodePath(slug: string, episode: number): string {
  return `${ANIMEGG_BASE_URL}/${slug}-episode-${episode}`;
}

export function animeggSeriesPath(slug: string): string {
  return `${ANIMEGG_BASE_URL}/series/${slug}`;
}

export function animeggEmbedPath(embedId: string): string {
  return `${ANIMEGG_BASE_URL}/embed/${embedId}`;
}

export function animeggSearchPath(query: string): string {
  return `${ANIMEGG_BASE_URL}/search/?q=${encodeURIComponent(query)}`;
}
