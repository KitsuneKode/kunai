/**
 * Deterministic "is this anime?" classifier for TMDB items. Lets a TMDB search
 * result (which has no provider mode) be tagged + routed to anime providers and
 * badged in the picker. Research-validated 26/26 on real TMDB data (see
 * apps/experiments/scratchpads/miroru-research-report-latest.md §8). Pure, no
 * network — runs on fields the app already fetches (search has original_language
 * + genre_ids; the detail payload adds the deeper tiers).
 */

export type AnimeClassifierInput = {
  readonly original_language?: string;
  readonly origin_country?: readonly string[];
  readonly production_countries?: readonly { readonly iso_3166_1: string }[];
  readonly genre_ids?: readonly number[];
  readonly keywords?: readonly { readonly id: number; readonly name?: string }[];
  readonly networks?: readonly { readonly name: string }[];
  readonly production_companies?: readonly { readonly name: string }[];
};

export type AnimeClassification = {
  readonly isAnime: boolean;
  readonly confidence: number;
  readonly reason: string;
};

const TMDB_ANIME_KEYWORD_ID = 210024;
const ANIMATION_GENRE_ID = 16;
const ANIME_NETWORKS =
  /Nippon TV|Tokyo MX|TOKYO MX|MBS\b|Fuji TV|TV Tokyo|BS11|Animax|TV Hokkaido|ytv|Yomiuri TV/i;
const ANIME_STUDIOS =
  /Studio Ghibli|CoMix Wave|Madhouse|Bones\b|MAPPA|ufotable|Kyoto Animation|Wit Studio|Trigger|A-1 Pictures|Pierrot|Sunrise|TMS Entertainment|OLM\b|P\.A\. Works|CloverWorks|Production I\.G|Shaft\b|White Fox|J\.C\.Staff|Silver Link/i;

export function isAnimeLikely(item: AnimeClassifierInput): AnimeClassification {
  // Tier 1 — Japanese original language. 13/13 anime had it, 0/13 non-anime. ~99.9%.
  if (item.original_language === "ja") {
    return { isAnime: true, confidence: 0.99, reason: "original_language=ja" };
  }

  // Tier 2 — JP origin AND the Animation genre.
  const jpOrigin =
    item.origin_country?.includes("JP") === true ||
    item.production_countries?.some((c) => c.iso_3166_1 === "JP") === true;
  const hasAnimation = item.genre_ids?.includes(ANIMATION_GENRE_ID) === true;
  if (jpOrigin && hasAnimation) {
    return { isAnime: true, confidence: 0.97, reason: "JP+Animation" };
  }

  // Tier 3 — the explicit TMDB "anime" keyword.
  if (item.keywords?.some((k) => k.id === TMDB_ANIME_KEYWORD_ID)) {
    return { isAnime: true, confidence: 0.95, reason: "anime keyword" };
  }

  // Tier 4 — an anime-specific TV network (catches Western-produced anime-style).
  if (item.networks?.some((n) => ANIME_NETWORKS.test(n.name))) {
    return { isAnime: true, confidence: 0.95, reason: "anime network" };
  }

  // Tier 5 — an anime studio (mostly for movies, which lack networks).
  if (item.production_companies?.some((c) => ANIME_STUDIOS.test(c.name))) {
    return { isAnime: true, confidence: 0.95, reason: "anime studio" };
  }

  // Animation genre alone is Western animation, not anime.
  if (hasAnimation) {
    return { isAnime: false, confidence: 0.7, reason: "western-animation" };
  }
  return { isAnime: false, confidence: 0.9, reason: "no-anime-signals" };
}
