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
    const raw =
      (data as any)?.data?.animes ?? (data as any)?.results ?? (data as any)?.animes ?? [];

    return (raw as any[]).map(
      (a): ApiSearchResult => ({
        id: String(a.id ?? a.animeId ?? ""),
        title: String(a.name ?? a.title ?? a.english ?? a.romaji ?? a.id ?? "Unknown"),
        type: "series",
        year: a.premiered ? String(a.premiered).split(" ").pop() : undefined,
      }),
    );
  },

  async resolveStream(id, _type, _season, episode, opts: ResolveOpts) {
    const url = `https://www.cineby.sc/anime/${id}?episode=${episode}&play=true`;
    return opts.embedScraper(url, { needsClick: true });
  },
};
