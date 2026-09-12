/**
 * KickAssAnime response parsers.
 *
 * The catalog is a plain JSON API; the only HTML step is the player page, and
 * even that carries its stream as serialized Astro island props rather than
 * anything encrypted. These functions are the whole extraction, kept pure so the
 * contract is pinned by fixtures (see `.docs/provider-dossiers/kickassanime.md`).
 */

export type KaaSearchResult = {
  readonly slug: string;
  readonly title: string;
  readonly englishTitle?: string;
  readonly type?: string;
  readonly year?: number;
  readonly episodeCount?: number;
  readonly locales: readonly string[];
  readonly posterKey?: string;
};

export type KaaEpisodePage = {
  /** Every page's episode numbers — the site lists the whole run on each page. */
  readonly pages: readonly { readonly number: number; readonly eps: readonly number[] }[];
  /** Episodes on the page that was requested, with their per-episode slugs. */
  readonly episodes: readonly KaaEpisode[];
};

export type KaaEpisode = {
  readonly slug: string;
  readonly number: number;
  readonly title?: string;
  /** `/image/thumbnail/<key>.webp` on the catalog host. */
  readonly thumbnailKey?: string;
};

export type KaaServer = { readonly name: string; readonly src: string };

export type KaaPlayerPayload = {
  readonly manifest: string;
  readonly subtitles: readonly {
    readonly language: string;
    readonly name: string;
    readonly src: string;
  }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** `POST /api/fsearch` → `{ result: [...] }`. */
export function parseKaaSearchResults(body: unknown): KaaSearchResult[] {
  if (!isRecord(body) || !Array.isArray(body.result)) return [];
  const results: KaaSearchResult[] = [];
  for (const row of body.result) {
    if (!isRecord(row)) continue;
    const slug = text(row.slug);
    const title = text(row.title) ?? text(row.title_en);
    if (!slug || !title) continue;
    // Announced shows are listed with no audio and nowhere to watch; offering
    // one would only lead to an empty episode list.
    const locales = Array.isArray(row.locales)
      ? row.locales.filter((l): l is string => typeof l === "string")
      : [];
    if (locales.length === 0 && row.watch_uri === null) continue;
    const englishTitle = text(row.title_en);
    const posterKey = isRecord(row.poster) ? text(row.poster.hq) : undefined;
    results.push({
      slug,
      title,
      ...(englishTitle && englishTitle !== title ? { englishTitle } : {}),
      ...(text(row.type) ? { type: text(row.type) } : {}),
      ...(positiveInteger(row.year) ? { year: positiveInteger(row.year) } : {}),
      ...(positiveInteger(row.episode_count)
        ? { episodeCount: positiveInteger(row.episode_count) }
        : {}),
      locales,
      ...(posterKey ? { posterKey } : {}),
    });
  }
  return results;
}

/** `GET /api/show/<slug>/episodes?ep=<page>&lang=<locale>`. */
export function parseKaaEpisodePage(body: unknown): KaaEpisodePage {
  if (!isRecord(body)) return { pages: [], episodes: [] };
  const pages: { number: number; eps: number[] }[] = [];
  for (const page of Array.isArray(body.pages) ? body.pages : []) {
    if (!isRecord(page)) continue;
    const number = positiveInteger(page.number);
    if (!number) continue;
    const eps = (Array.isArray(page.eps) ? page.eps : []).filter(
      (ep): ep is number => typeof ep === "number" && Number.isInteger(ep) && ep > 0,
    );
    pages.push({ number, eps });
  }
  const episodes: KaaEpisode[] = [];
  for (const row of Array.isArray(body.result) ? body.result : []) {
    if (!isRecord(row)) continue;
    const slug = text(row.slug);
    // Fractional specials (13.5) are not addressable as a Kunai episode number.
    const number = positiveInteger(row.episode_number);
    if (!slug || !number) continue;
    const title = text(row.title);
    const thumbnailKey = isRecord(row.thumbnail) ? text(row.thumbnail.hq) : undefined;
    episodes.push({
      slug,
      number,
      ...(title ? { title } : {}),
      ...(thumbnailKey ? { thumbnailKey } : {}),
    });
  }
  return { pages, episodes };
}

/** Every episode number the show lists, ascending and de-duplicated. */
export function kaaEpisodeNumbers(page: KaaEpisodePage): number[] {
  return [...new Set(page.pages.flatMap((p) => p.eps))].sort((a, b) => a - b);
}

/** Which listing page holds an episode, so its slug can be fetched. */
export function kaaPageForEpisode(page: KaaEpisodePage, episode: number): number | undefined {
  return page.pages.find((p) => p.eps.includes(episode))?.number;
}

/** `GET /api/show/<slug>/episode/ep-<n>-<epSlug>` → `{ servers: [{name, src}] }`. */
export function parseKaaServers(body: unknown): KaaServer[] {
  if (!isRecord(body) || !Array.isArray(body.servers)) return [];
  const servers: KaaServer[] = [];
  for (const row of body.servers) {
    if (!isRecord(row)) continue;
    const name = text(row.name);
    const src = text(row.src);
    if (name && src && /^https:\/\//i.test(src)) servers.push({ name, src });
  }
  return servers;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Astro serializes island props as tagged tuples: `[0, value]` for a value
 * (objects nested inside carry tagged fields of their own) and `[1, [...]]` for
 * an array of tagged items. Only those two tags appear in the player props; any
 * other tag is a type this parser does not claim to read.
 */
export function decodeAstroProp(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number") return value;
  const [tag, payload] = value as [number, unknown];
  if (tag === 1) return Array.isArray(payload) ? payload.map(decodeAstroProp) : [];
  if (tag !== 0) return undefined;
  if (isRecord(payload)) {
    return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, decodeAstroProp(v)]));
  }
  return payload;
}

/**
 * The cat-player page's `<astro-island props="...">`: the stream manifest and
 * its subtitle tracks, in the clear. The manifest arrives with a doubled slash
 * after the scheme on some servers (`https:////bl.krussdomi.com/...`), so it is
 * normalized through the URL parser rather than used as written.
 */
export function parseKaaPlayerPage(html: string): KaaPlayerPayload | null {
  const match = /<astro-island[^>]*\sprops="([^"]*manifest[^"]*)"/i.exec(html);
  if (!match?.[1]) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decodeEntities(match[1]));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const props = Object.fromEntries(
    Object.entries(raw).map(([key, tagged]) => [key, decodeAstroProp(tagged)]),
  );

  const manifest = normalizeHttpsUrl(text(props.manifest));
  if (!manifest) return null;

  const subtitles: { language: string; name: string; src: string }[] = [];
  for (const row of Array.isArray(props.subtitles) ? props.subtitles : []) {
    if (!isRecord(row)) continue;
    const src = normalizeHttpsUrl(text(row.src));
    const language = text(row.language);
    if (!src || !language) continue;
    subtitles.push({ language, name: text(row.name) ?? language, src });
  }
  return { manifest, subtitles };
}

function normalizeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
