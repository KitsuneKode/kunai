/**
 * Matching a title Kunai already has against a provider's own catalog.
 *
 * Anime providers behind the default one are only useful if they can take over
 * a show that was found somewhere else, and most of them expose no AniList or
 * MAL id to join on — only names. So the join is by name, and the bar is high
 * on purpose: exactly one row may match, because a confidently played wrong
 * show is worse than falling through to the next provider.
 */

export type ProviderCatalogRow = {
  readonly slug: string;
  readonly title: string;
  readonly englishTitle?: string;
  readonly altNames?: readonly string[];
  readonly year?: number;
};

export type ProviderTitleQuery = {
  readonly title: string;
  readonly year?: number;
  readonly altNames?: readonly string[];
};

/**
 * Compare on letters and digits only: "Frieren: Beyond Journey's End" and
 * "Frieren - Beyond Journeys End" are one title, written by two catalogs.
 * Apostrophes close up rather than splitting a word, so "Journey's" keys the
 * same as "Journeys".
 */
export function normalizeTitleKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(FORMAT_QUALIFIER, "")
    .replace(/['‘’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A trailing "(TV)" or "(Movie)" is a catalog's format note, not part of the
 * name — AnimeGG lists "Jujutsu Kaisen (TV)" where AniList says "Jujutsu
 * Kaisen". Only format words are dropped: "(2011)" separates two different
 * shows, and removing it would merge them. Where dropping a format word does
 * leave two rows with one name, the uniqueness rule turns that into no match.
 */
const FORMAT_QUALIFIER = /\s*\((?:tv|movie|ova|ona|special|specials)\)\s*$/;

/**
 * The one row that is this title, or null. A year on both sides must agree —
 * that is what keeps a sequel from matching its first season — but a row
 * without one is not rejected, since several catalogs omit it.
 */
export function matchProviderCatalogTitle<TRow extends ProviderCatalogRow>(
  rows: readonly TRow[],
  query: ProviderTitleQuery,
): TRow | null {
  const wanted = new Set(
    [query.title, ...(query.altNames ?? [])].map(normalizeTitleKey).filter(Boolean),
  );
  if (wanted.size === 0) return null;

  const hits = rows.filter((row) => {
    const names = [row.title, row.englishTitle, ...(row.altNames ?? [])]
      .filter((name): name is string => Boolean(name))
      .map(normalizeTitleKey);
    if (!names.some((name) => wanted.has(name))) return false;
    return query.year === undefined || row.year === undefined || row.year === query.year;
  });

  return hits.length === 1 ? (hits[0] ?? null) : null;
}
