/**
 * Stable identity for a source/server, used by favorites (persistence), the UI
 * (♥ + sort), and auto-select. Lowercase, strip everything that is not a letter
 * or digit so "VidLink", "Vid Link", "Vid-Link!" all map to "vidlink".
 */
export function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Toggle a source name in the favorites list by normalized identity. Returns a new array. */
export function toggleFavoriteSource(
  favorites: readonly string[],
  label: string,
): readonly string[] {
  const key = normalizeSourceName(label);
  if (!key) return favorites;
  return favorites.includes(key) ? favorites.filter((name) => name !== key) : [...favorites, key];
}

/** True when a label's normalized identity is in the favorites list. */
export function isFavoriteSource(favorites: readonly string[], label: string): boolean {
  return favorites.includes(normalizeSourceName(label));
}

/** Stable sort: favorite order is priority; non-favorites keep original order. */
export function sortByFavorites<T>(
  rows: readonly T[],
  favorites: readonly string[],
  labelOf: (row: T) => string,
): readonly T[] {
  const priorityByName = new Map(favorites.map((name, index) => [name, index]));
  return [...rows].sort((left, right) => {
    const leftPriority = priorityByName.get(normalizeSourceName(labelOf(left)));
    const rightPriority = priorityByName.get(normalizeSourceName(labelOf(right)));
    if (leftPriority === undefined && rightPriority === undefined) return 0;
    if (leftPriority === undefined) return 1;
    if (rightPriority === undefined) return -1;
    return leftPriority - rightPriority;
  });
}
