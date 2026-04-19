// =============================================================================
// Provider registry
//
// To add a new provider:
//   1. Create lib/providers/<name>.ts implementing the Provider interface.
//   2. Import it here and add it to PROVIDERS.
//   Nothing else needs to change — the scraper, menus, and config all read
//   from this registry at runtime.
// =============================================================================

import { VidKing } from "./vidking";
import { Cineby } from "./cineby";
import type { Provider } from "./types";

export type { Provider };
export { VidKing, Cineby };

export const PROVIDERS: Readonly<Record<string, Provider>> = {
  [VidKing.id]: VidKing,
  [Cineby.id]:  Cineby,
};

// Ordered list for UI menus (recommended providers first).
export const PROVIDER_LIST: readonly Provider[] = Object.values(PROVIDERS).sort(
  (a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0),
);

export const DEFAULT_PROVIDER_ID: string = VidKing.id;

// Returns the provider for a given ID, throws on unknown IDs.
// The unknown-provider error surfaces early (config load / flag parse) so
// users get a clear message instead of a silent scrape failure.
export function getProvider(id: string): Provider {
  const p = PROVIDERS[id];
  if (!p) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${id}". Available: ${known}`);
  }
  return p;
}

// Convenience: build a URL for any registered provider without importing the
// provider object directly.
export function buildUrl(
  providerId: string,
  tmdbId:     string,
  type:       "movie" | "series",
  season:     number,
  episode:    number,
): string {
  const p = getProvider(providerId);
  return type === "movie"
    ? p.movieUrl(tmdbId)
    : p.seriesUrl(tmdbId, season, episode);
}

// All domains that belong to known streaming players.
// Used by the scraper to decide which popup tabs to keep vs close.
export const PLAYER_DOMAINS: readonly string[] = [
  ...PROVIDER_LIST.map((p) => p.domain),
  "about:blank",
  "blob:",
];
