/**
 * Caps a session-scoped cache keyed by caller input. Expiry alone never frees
 * anything — a key is only dropped when something asks for that exact key
 * again — so an unbounded map grows for the life of the process on a long
 * session or a scripted scan of the catalog.
 *
 * Eviction drops expired entries first (reaping what TTL would have cleaned on
 * a hit anyway), then falls back to oldest-inserted — `Map` iterates in
 * insertion order, matching `TTLCache.evictIfNeeded` semantics.
 */
export function evictOverflowedEntries<K, E extends { readonly expiresAt: number }>(
  map: Map<K, E>,
  maxEntries: number,
  now: number,
): void {
  if (map.size <= maxEntries) return;

  for (const [key, entry] of map) {
    if (now >= entry.expiresAt) map.delete(key);
  }

  while (map.size > maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}
