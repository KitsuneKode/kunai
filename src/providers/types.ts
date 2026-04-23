// =============================================================================
// Provider type system
//
// Two kinds:
//   PlaywrightProvider  — headless Chromium intercepts the .m3u8 request.
//                         Requires `bunx playwright install chromium`.
//                         Examples: VidKing, Cineby, BitCine.
//
//   ApiProvider         — pure HTTP/GraphQL, no browser install needed.
//                         Examples: AllAnime, Braflix (hybrid: HTTP metadata
//                         + optional embedScraper callback for the embed step).
//
// Adding a provider = one file in src/providers/ + one line in PROVIDERS map.
// =============================================================================

import type { StreamData } from "@/scraper";

// ── Shared base ───────────────────────────────────────────────────────────────

interface BaseProvider {
  readonly id: string; // machine key — used in config / CLI flags
  readonly name: string; // short human label
  readonly description: string; // shown in select menus
  readonly domain: string; // hostname fragment for popup tab detection
  readonly recommended?: boolean;
  readonly isAnimeProvider?: boolean; // true → shown in anime provider picker
}

// ── Playwright providers ──────────────────────────────────────────────────────

export interface PlaywrightProvider extends BaseProvider {
  readonly kind: "playwright";

  movieUrl(tmdbId: string): string;
  seriesUrl(tmdbId: string, season: number, episode: number): string;

  readonly needsClick: boolean;

  // Title extraction strategy
  //   "selectors"  — walk titleSelectors, take first non-empty text
  //   "og"         — prefer <meta property="og:title">
  //   "page-title" — document.title
  readonly titleSource: "selectors" | "og" | "page-title";
  readonly titleSelectors?: readonly string[];
}

// ── API providers ─────────────────────────────────────────────────────────────

// Which search backend the provider uses.
//   "tmdb"      — shared videasy search (TMDB-format, works for most providers)
//   "allanime"  — AllAnime-family GraphQL search (anime-only)
//   "hianime"   — HiAnime API search via anime-db.videasy.net (anime-only)
//   "self"      — provider has its own search()  (Braflix, etc.)
export type SearchBackend = "tmdb" | "allanime" | "hianime" | "self";

export type ApiSearchResult = {
  id: string; // provider-internal ID (not a TMDB ID)
  title: string;
  type: "movie" | "series";
  year?: string;
  posterUrl?: string;
  epCount?: number;
};

// Passed to resolveStream and search.
// embedScraper is injected by index.ts so ApiProviders that need a final
// Playwright pass (e.g. Braflix embed extraction) don't need to import scraper.ts.
export type EmbedScraperOpts = { needsClick?: boolean };

export type ResolveOpts = {
  subLang: string;
  animeLang: "sub" | "dub";
  embedScraper: (embedUrl: string, opts?: EmbedScraperOpts) => Promise<StreamData | null>;
};

export interface ApiProvider extends BaseProvider {
  readonly kind: "api";
  readonly searchBackend: SearchBackend;

  // Called when searchBackend === "self" or "allanime".
  search(query: string, opts: Pick<ResolveOpts, "animeLang">): Promise<ApiSearchResult[]>;

  // Full resolution: HTTP metadata + optional embedScraper for the last step.
  resolveStream(
    id: string,
    type: "movie" | "series",
    season: number,
    episode: number,
    opts: ResolveOpts,
  ): Promise<StreamData | null>;
}

// ── Union & narrowing helpers ─────────────────────────────────────────────────

export type Provider = PlaywrightProvider | ApiProvider;

export const isPlaywright = (p: Provider): p is PlaywrightProvider => p.kind === "playwright";
export const isApi = (p: Provider): p is ApiProvider => p.kind === "api";
