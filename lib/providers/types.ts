// =============================================================================
// Provider interface
//
// A Provider describes everything the scraper needs to know about a streaming
// site. Adding a new provider = implementing this interface + registering it
// in lib/providers/index.ts. No other files need to change.
// =============================================================================

export interface Provider {
  // ── Identity ───────────────────────────────────────────────────────────────
  readonly id:          string;  // machine key used in config / CLI flags
  readonly name:        string;  // short human label
  readonly description: string;  // shown in the provider select menu
  readonly domain:      string;  // hostname fragment used for popup detection

  // ── URL builders ──────────────────────────────────────────────────────────
  movieUrl(tmdbId: string): string;
  seriesUrl(tmdbId: string, season: number, episode: number): string;

  // ── Scraper behaviour ──────────────────────────────────────────────────────
  // Whether to fire a mouse click at (500, 500) after DOM load to wake a lazy
  // player. VidKing uses autoPlay=true so no click is needed. Cineby does.
  readonly needsClick: boolean;

  // Strategy for extracting the content title from the page.
  //   "selectors"  — walk titleSelectors in order, take first non-empty text
  //   "og"         — prefer <meta property="og:title">
  //   "page-title" — fall back to document.title
  readonly titleSource:    "selectors" | "og" | "page-title";
  readonly titleSelectors?: readonly string[];

  // ── UI hints ──────────────────────────────────────────────────────────────
  readonly recommended?: boolean;
}
