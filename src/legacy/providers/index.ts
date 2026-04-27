// =============================================================================
// Provider registry
//
// To add a provider:
//   1. Create src/providers/<name>.ts implementing PlaywrightProvider or ApiProvider.
//   2. Import + add one line to PROVIDERS below.
//   Nothing else needs to change.
// =============================================================================

import { VidKing } from "./vidking";
import { Cineby } from "./cineby";
import { BitCine } from "./bitcine";
import { AllAnime } from "./allanime";
import { Braflix } from "./braflix";
import { CinebyAnime } from "./cineby-anime";

export type {
  Provider,
  PlaywrightProvider,
  ApiProvider,
  ApiSearchResult,
  ResolveOpts,
  SearchBackend,
} from "./types";
export { isPlaywright, isApi } from "./types";
export { VidKing, Cineby, BitCine, AllAnime, Braflix, CinebyAnime };

import type { Provider, PlaywrightProvider } from "./types";

export const PROVIDERS: Readonly<Record<string, Provider>> = {
  [VidKing.id]: VidKing,
  [Cineby.id]: Cineby,
  [BitCine.id]: BitCine,
  [AllAnime.id]: AllAnime,
  [Braflix.id]: Braflix,
  [CinebyAnime.id]: CinebyAnime,
};

// Recommended-first ordering for menus.
export const PROVIDER_LIST: readonly Provider[] = Object.values(PROVIDERS).sort(
  (a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0),
);

// Separate list for menus that should only show Playwright providers
// (used when anime mode is off).
export const PLAYWRIGHT_PROVIDERS: readonly PlaywrightProvider[] = PROVIDER_LIST.filter(
  (p): p is PlaywrightProvider => p.kind === "playwright",
);

export const ANIME_PROVIDERS: readonly Provider[] = PROVIDER_LIST.filter(
  (p) => p.isAnimeProvider === true,
);

export const DEFAULT_PROVIDER_ID = VidKing.id;
export const DEFAULT_ANIME_PROVIDER_ID = AllAnime.id;

export function getProvider(id: string): Provider {
  const p = PROVIDERS[id];
  if (!p) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${id}". Available: ${known}`);
  }
  return p;
}

// Build a Playwright embed URL. Only valid for PlaywrightProvider.
export function buildUrl(
  provider: PlaywrightProvider,
  tmdbId: string,
  type: "movie" | "series",
  season: number,
  episode: number,
): string {
  return type === "movie" ? provider.movieUrl(tmdbId) : provider.seriesUrl(tmdbId, season, episode);
}

// Convenience overload by provider ID (throws if not a PlaywrightProvider).
export function buildUrlById(
  providerId: string,
  tmdbId: string,
  type: "movie" | "series",
  season: number,
  episode: number,
): string {
  const p = getProvider(providerId);
  if (p.kind !== "playwright")
    throw new Error(
      `Provider "${providerId}" is not a Playwright provider — use resolveStream instead.`,
    );
  return buildUrl(p, tmdbId, type, season, episode);
}

// All domains belonging to known streaming players.
// Used by the Playwright scraper to decide which popup tabs to keep vs close.
export const PLAYER_DOMAINS: readonly string[] = [
  ...PROVIDER_LIST.map((p) => p.domain),
  "about:blank",
  "blob:",
];
