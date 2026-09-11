/**
 * Derivation of release-signoff cases from runtime configuration and the
 * registered production provider modules.
 *
 * Release signoff previously hard-coded which providers it exercised, so it
 * could report a green release while proving a provider the product does not
 * actually default to. Cases are now derived from config, and a configured
 * default that is not a registered production module fails before any network
 * work happens.
 */

import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import type { SearchResult, TitleInfo } from "@/domain/types";
import type { Provider } from "@/services/providers/Provider";

export type ReleaseProviderRouteCase =
  | {
      readonly lane: "movie" | "series";
      readonly configuredProvider: string;
      readonly mode: "series";
      readonly title: TitleInfo;
      readonly season?: number;
      readonly episode?: number;
    }
  | {
      readonly lane: "anime";
      readonly configuredProvider: string;
      readonly mode: "anime";
      readonly searchQuery: "Onigiri";
      readonly expectedTitle: "Onigiri";
      readonly season: 1;
      readonly episode: 1;
    };

export function buildReleaseProviderRouteCases(
  config: { readonly provider: string; readonly animeProvider: string },
  productionProviderIds: readonly string[],
): readonly ReleaseProviderRouteCase[] {
  const registered = new Set(productionProviderIds);
  if (!registered.has(config.provider)) {
    throw new Error(`Configured series release provider is not registered: ${config.provider}`);
  }
  if (!registered.has(config.animeProvider)) {
    throw new Error(`Configured anime release provider is not registered: ${config.animeProvider}`);
  }
  return [
    {
      lane: "movie",
      configuredProvider: config.provider,
      mode: "series",
      title: { id: "438631", type: "movie", name: "Dune", year: "2021" },
    },
    {
      lane: "series",
      configuredProvider: config.provider,
      mode: "series",
      title: { id: "299167", type: "series", name: "Dutton Ranch", year: "2026" },
      season: 1,
      episode: 1,
    },
    {
      lane: "anime",
      configuredProvider: config.animeProvider,
      mode: "anime",
      searchQuery: "Onigiri",
      expectedTitle: "Onigiri",
      season: 1,
      episode: 1,
    },
  ];
}

/**
 * Search the configured anime default and turn its own result into the resolve
 * title. A zero-result search is provider drift, not a reason to fall back to a
 * hard-coded native id — that is exactly how a broken default route used to pass
 * signoff.
 */
export async function resolveReleaseAnimeSearchTitle(
  route: Extract<ReleaseProviderRouteCase, { readonly lane: "anime" }>,
  provider: Pick<Provider, "search">,
  language: { readonly audio: string; readonly subtitle: string },
  options: {
    readonly signal?: AbortSignal;
    /**
     * The catalog search the app routes to when the provider has no search of
     * its own — `searchRegistry.getForProvider(id)`, as in `searchTitles`.
     * Requiring `provider.search` would fail signoff on a route that works.
     *
     * Deliberately not used when the provider does search and comes back empty:
     * the app would fall through to the catalog there, but signoff exists to
     * catch the default's own search drifting, which that would hide.
     */
    readonly catalog?: { search(query: string, signal?: AbortSignal): Promise<SearchResult[]> };
  } = {},
): Promise<TitleInfo> {
  const { signal, catalog } = options;
  if (!provider.search && !catalog) {
    throw new Error(
      `Default anime provider "${route.configuredProvider}" has no search capability and no compatible catalog`,
    );
  }
  const results =
    (provider.search
      ? await provider.search(
          route.searchQuery,
          { audioPreference: language.audio, subtitlePreference: language.subtitle },
          signal,
        )
      : await catalog?.search(route.searchQuery, signal)) ?? [];
  if (results.length === 0) {
    throw new Error(
      `Default anime provider "${route.configuredProvider}" search returned zero results for "${route.searchQuery}"`,
    );
  }
  const normalizedExpected = normalizeTitle(route.expectedTitle);
  const selected =
    results.find((result) => normalizeTitle(result.title) === normalizedExpected) ?? results[0];
  if (!selected) {
    throw new Error(
      `Default anime provider "${route.configuredProvider}" returned no selectable result`,
    );
  }
  return titleInfoFromSearchResult(selected, selected.title);
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
