import type { searchTitles } from "@/services/search/SearchRoutingService";

export function appendSearchFilterChip(query: string, chip: string): string {
  const trimmed = query.trim();
  if (!trimmed) return chip;
  if (trimmed.split(/\s+/).includes(chip)) return trimmed;
  return `${trimmed} ${chip}`;
}

/**
 * An empty answer must say *why* when we know: providers that threw get named
 * (the lane failed over and still found nothing), an unsupported advanced
 * search says the catalog can't answer, and only a real "nothing matches"
 * keeps the generic copy (#464).
 */
export function buildSearchEmptyMessage(search: Awaited<ReturnType<typeof searchTitles>>): string {
  const failures = search.providerSearchFailures;
  if (failures && failures.length > 0) {
    const names = [...new Set(failures.map((failure) => failure.providerId))].join(", ");
    return `Provider search failed (${names}). Check /diagnostics or switch provider with /provider.`;
  }
  if (search.diagnosis?.code === "catalog-fallback") {
    return "TMDB is unreachable and the backup catalog (Wikidata) found no match. Try the original title, or search again once TMDB is back.";
  }
  if (search.diagnosis?.code === "compatible-catalog-unavailable") {
    return "The active provider can't answer a filtered search like this. Simplify the query or switch provider with /provider.";
  }
  return "No results found. Adjust the query and try again.";
}
