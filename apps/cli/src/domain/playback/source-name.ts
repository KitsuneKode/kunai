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
