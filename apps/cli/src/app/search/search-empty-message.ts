import type { ShellMode } from "@/domain/types";

/** The parts of a search answer that explain an empty one. */
export type EmptySearchEvidence = {
  readonly providerSearchFailures?: readonly { readonly providerId: string }[];
  readonly diagnosis?: { readonly code?: string };
};

/** The lane Tab switches to from `mode`, as the user would name it. */
const OTHER_LANE = {
  series: "anime",
  anime: "shows & movies",
  youtube: "shows & movies",
} satisfies Record<ShellMode, string>;

/**
 * An empty answer must say *why* when we know: providers that threw get named
 * (the lane failed over and still found nothing), an unsupported advanced
 * search says the catalog can't answer, and only a real "nothing matches"
 * keeps the generic copy (#464).
 *
 * The generic copy names the other lane, because the commonest first miss is
 * an anime title searched in shows & movies, and Tab is the whole fix.
 */
export function buildSearchEmptyMessage(search: EmptySearchEvidence, mode: ShellMode): string {
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
  return `Press Tab to search ${OTHER_LANE[mode]} instead, or try fewer words.`;
}
