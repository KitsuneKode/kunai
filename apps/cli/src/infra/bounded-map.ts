/**
 * Insertion-ordered map with a hard entry ceiling and LRU promotion.
 *
 * Exists for the session-scoped metadata caches (`tmdb.ts`, `aniskip.ts`) that
 * used to be plain `Map`s: keyed by title/episode ids, they grew one entry per
 * title browsed for the whole session and never gave one back.
 * `ByteBudgetLruCache` in `app-shell/` is the byte-weighted cousin for image
 * payloads; this is the plain entry-count version for small records.
 *
 * `Map` iterates in insertion order, so the first key is always the oldest
 * write, and re-inserting on read is what makes eviction least-recently-used
 * rather than first-in.
 */
export class BoundedLruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Promote to most-recently-used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Membership without the LRU promotion — for caches that key `has()`. */
  has(key: K): boolean {
    return this.entries.has(key);
  }

  set(key: K, value: V): void {
    // Replacing an existing key is a refresh, not growth: delete first so the
    // write lands at the MRU end and never trips the ceiling on itself.
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
