import {
  hasBrowseResultFilters,
  parseBrowseFilterQuery,
  processBrowseSearchResults,
} from "@/app-shell/browse-filters";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchFilterEvidence } from "@/services/search/SearchRoutingService";

export type BrowseInitialResults<T> = {
  readonly options: readonly BrowseShellOption<T>[];
  /** Filter-evidence suffix appended to the result subtitle (empty when none). */
  readonly subtitleSuffix: string;
  readonly activeBadges: readonly string[];
};

/**
 * Run already-mapped browse options through the exact same local-filter pipeline
 * that interactive Enter search uses (`processBrowseSearchResults`). Bootstrap /
 * `-S` and preserved-search remounts feed initial results directly into the
 * shell instead of through `onSearch`, so without this they would skip library /
 * type / year narrowing that Enter applies — the honesty gap this repairs.
 */
export function buildBrowseInitialResults<T>(input: {
  readonly options: readonly BrowseShellOption<T>[];
  readonly query: string;
  readonly evidence?: SearchFilterEvidence;
}): BrowseInitialResults<T> {
  const parsedQuery = parseBrowseFilterQuery(input.query);
  if (!hasBrowseResultFilters(parsedQuery.filters)) {
    return { options: input.options, subtitleSuffix: "", activeBadges: [] };
  }

  const processed = processBrowseSearchResults(
    {
      options: input.options,
      upstreamFilterBadges: input.evidence?.upstream,
      localFilterBadges: input.evidence?.local,
      unsupportedFilterBadges: input.evidence?.unsupported,
    },
    parsedQuery,
  );

  const activeBadges = [
    ...processed.upstreamFilterBadges.map((badge) => `upstream ${badge}`),
    ...processed.localFilterBadges.map((badge) => `local ${badge}`),
    ...processed.unsupportedFilterBadges.map((badge) => `unsupported ${badge}`),
  ];

  return {
    options: processed.options,
    subtitleSuffix: activeBadges.length > 0 ? `  ·  ${activeBadges.join(", ")}` : "",
    activeBadges,
  };
}
