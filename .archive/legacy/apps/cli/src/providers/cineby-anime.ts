import type { ApiProvider, ApiSearchResult, ResolveOpts } from "./types";

// CinebyAnime — HiAnime search (anime-db.videasy.net) + Cineby Playwright stream.
//
// Search: pure HTTP against the HiAnime API — no browser needed.
// Stream: delegates to opts.embedScraper which opens cineby.sc/anime/{slug}
//         in Chromium and intercepts the .m3u8 (same as regular Cineby).
//
// This mirrors the Braflix pattern: HTTP metadata + embedScraper for the last
// step. No circular dependency on scraper.ts.

const HIANIME_SEARCH = "https://anime-db.videasy.net/api/v2/hianime/search";

export const CinebyAnime: ApiProvider = {
  kind: "api",
  id: "cineby-anime",
  name: "Cineby Anime",
  description: "Cineby Anime  (HiAnime search · Playwright stream · sub & dub)",
  domain: "cineby.sc",
  recommended: false,
  isAnimeProvider: true,
  searchBackend: "hianime",

  async search(query): Promise<ApiSearchResult[]> {
    const url = `${HIANIME_SEARCH}?q=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HiAnime search ${res.status}: ${url}`);

    const data = (await res.json()) as Record<string, unknown>;
    const nested =
      data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};
    const raw = nested.animes ?? data.results ?? data.animes ?? [];

    return (Array.isArray(raw) ? raw : []).map(
      (a): ApiSearchResult => ({
        id: String(readRecord(a).id ?? readRecord(a).animeId ?? ""),
        title: String(
          readRecord(a).name ??
            readRecord(a).title ??
            readRecord(a).english ??
            readRecord(a).romaji ??
            readRecord(a).id ??
            "Unknown",
        ),
        type: "series",
        year: readRecord(a).premiered
          ? String(readRecord(a).premiered).split(" ").pop()
          : undefined,
      }),
    );
  },

  async resolveStream(id, _type, _season, episode, opts: ResolveOpts) {
    const url = `https://www.cineby.sc/anime/${id}?episode=${episode}&play=true`;
    return opts.embedScraper(url, { needsClick: true });
  },
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
