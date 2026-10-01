/**
 * Rescue for catalogs whose search matches the query as one literal phrase —
 * "cyberpunk edgerunners" finds nothing on AnimeGG, KickAssAnime, or AnimeKai
 * while "Cyberpunk: Edgerunners" sits in the catalog. ani-cli's fix, shared:
 * retry with the longest word, then keep only rows whose name contains every
 * word of the original query.
 */

import { normalizeTitleKey } from "./provider-title-match";

/**
 * The fallback query: the longest word in the phrase, or null when the query
 * is a single word (nothing wider to retry with). Tokenize on the raw query —
 * punctuation inside a word stays attached, matching what the site's own
 * search box would receive.
 */
export function longestWordFallbackQuery(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let longest = "";
  for (const word of words) {
    if (word.length > longest.length) longest = word;
  }
  return longest || null;
}

/**
 * Keep rows whose name fields contain every word of the original query.
 * Normalization runs through {@link normalizeTitleKey} so punctuation and case
 * do not block a real hit.
 */
export function filterResultsByQueryWords<TRow>(
  rows: readonly TRow[],
  query: string,
  namesOf: (row: TRow) => readonly (string | undefined)[],
): readonly TRow[] {
  const words = normalizeTitleKey(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const names = namesOf(row)
      .filter((name): name is string => Boolean(name))
      .map(normalizeTitleKey);
    return words.every((word) => names.some((name) => name.includes(word)));
  });
}

/**
 * Run `search` on the query as written; when it returns nothing and the query
 * is multiword, retry with the longest word and filter the wider set back down
 * client-side. The second fetch is the only extra request a miss costs.
 */
export async function searchWithPhraseFallback<TRow>(
  query: string,
  search: (q: string) => Promise<readonly TRow[]>,
  namesOf: (row: TRow) => readonly (string | undefined)[],
): Promise<readonly TRow[]> {
  const results = await search(query);
  if (results.length > 0) return results;
  const fallback = longestWordFallbackQuery(query);
  if (!fallback) return results;
  const widened = await search(fallback);
  return filterResultsByQueryWords(widened, query, namesOf);
}
