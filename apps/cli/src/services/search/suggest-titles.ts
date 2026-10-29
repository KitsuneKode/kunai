// =============================================================================
// Catalog suggest path — the type-ahead band's remote source.
//
// Deliberately thin: ONE call into the fast registry catalog service for the
// active lane (TMDB for series, AniList for anime), with no provider-lane
// fan-out, no crosswalk enrichment, and no playback probing. `searchTitles`
// stays the committed-search path; this exists so a debounced keystroke can ask
// "what might you mean" at catalog speed.
//
// Suggestions are an enhancement, never an error surface: every failure mode
// resolves to `null` and the caller falls back to local-only rows.
// =============================================================================

import { shellModeToProviderLane } from "@/domain/provider-lane";
import { SUGGESTION_MIN_QUERY_LENGTH } from "@/domain/search/suggestion-engine";
import type { SearchResult, ShellMode } from "@/domain/types";
import type { ProviderCatalogIdentity } from "@kunai/core";
import { fetchYoutubeSearchSuggestions, getYoutubeProviderConfig } from "@kunai/providers/youtube";

import type { SearchRegistry } from "./SearchRegistry";

const SUGGESTION_MAX_REMOTE = 6;

export interface SuggestCatalogOutcome {
  readonly results: readonly SearchResult[];
  /** Catalog identity of the service that answered (e.g. "tmdb", "anilist"). */
  readonly sourceId: string;
  readonly sourceName: string;
}

type SuggestRegistry = Pick<SearchRegistry, "get" | "getDefault" | "getForProvider">;

/**
 * Resolve the catalog service for the lane:
 *  - `getForProvider` first so an anime provider's compatible catalog
 *    (AniList) wins exactly like `searchTitles` does,
 *  - anime mode then falls back to the `anilist` service explicitly,
 *  - otherwise the registry default (TMDB).
 *  - youtube mode returns nothing: the lane has no registry catalog and
 *    provider-native search is too heavy to run per keystroke.
 */
function resolveSuggestService(
  registry: SuggestRegistry,
  input: {
    readonly mode: ShellMode;
    readonly providerId: string;
    readonly providerCatalogIdentity?: ProviderCatalogIdentity;
  },
) {
  if (input.mode === "youtube") return undefined;
  try {
    return (
      registry.getForProvider(input.providerId, input.providerCatalogIdentity) ??
      (input.mode === "anime" ? registry.get("anilist") : undefined) ??
      registry.getDefault()
    );
  } catch {
    return undefined;
  }
}

export async function suggestCatalogTitles(input: {
  readonly query: string;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly providerCatalogIdentity?: ProviderCatalogIdentity;
  readonly searchRegistry: SuggestRegistry;
  readonly signal?: AbortSignal;
  readonly limit?: number;
}): Promise<SuggestCatalogOutcome | null> {
  const query = input.query.trim();
  if (query.length < SUGGESTION_MIN_QUERY_LENGTH || input.signal?.aborted) return null;

  if (input.mode === "youtube") {
    try {
      const suggestions = await fetchYoutubeSearchSuggestions(query, {
        signal: input.signal,
        preferredInstanceUrl: getYoutubeProviderConfig().invidiousInstanceUrl,
      });
      if (input.signal?.aborted) return null;
      return {
        results: suggestions.slice(0, input.limit ?? SUGGESTION_MAX_REMOTE).map((s) => ({
          id: `yt:suggest:${s}`,
          title: s,
          type: "movie",
          year: "",
          overview: "",
          posterPath: null,
          commitQuery: s,
          resultKind: "video",
          resolvedLane: "youtube",
        })),
        sourceId: "youtube",
        sourceName: "YouTube Suggestions",
      };
    } catch {
      return null;
    }
  }

  const service = resolveSuggestService(input.searchRegistry, input);
  if (!service) return null;

  try {
    const results = await service.search(query, input.signal);
    if (input.signal?.aborted) return null;
    // Stamp the lane like `withResolvedSearchLane` does for committed search —
    // a picked suggestion routes through the same session-mode reconciliation.
    const lane = shellModeToProviderLane(input.mode);
    return {
      results: results
        .slice(0, input.limit ?? SUGGESTION_MAX_REMOTE)
        .map((result) => ({ ...result, resolvedLane: result.resolvedLane ?? lane })),
      sourceId: service.metadata.id,
      sourceName: service.metadata.name,
    };
  } catch {
    return null;
  }
}
