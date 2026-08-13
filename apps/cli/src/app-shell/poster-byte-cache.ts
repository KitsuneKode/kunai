// =============================================================================
// poster-byte-cache.ts — LRU with an explicit byte budget.
//
// Poster caches bound by entry count alone are only accidentally bounded: forty
// half-block thumbnails and forty full-width Kitty PNGs differ by orders of
// magnitude in bytes while counting the same. This cache tracks a caller-supplied
// weight so the ceiling is memory, not population.
//
// Deliberately knows nothing about images, terminals, paths, or React. It holds
// values and hands evicted ones back, which is what lets the poster caches layer
// renderer-specific cleanup on top without this file growing terminal knowledge.
// =============================================================================

export type ByteBudgetCacheOptions<K, V> = {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly weight: (value: V) => number;
  readonly onEvict?: (key: K, value: V) => void;
};

type Entry<V> = {
  readonly value: V;
  readonly weight: number;
};

export class ByteBudgetLruCache<K, V> {
  // Map iteration order is insertion order, so re-inserting on read is what
  // makes this LRU rather than FIFO.
  private readonly entries = new Map<K, Entry<V>>();
  private totalBytes = 0;

  constructor(private readonly options: ByteBudgetCacheOptions<K, V>) {}

  get size(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Promote to most-recently-used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Returns false when the value could never fit, leaving the cache untouched. */
  set(key: K, value: V): boolean {
    const weight = this.options.weight(value);
    if (!Number.isInteger(weight) || weight < 0) return false;
    // Evicting live entries to make room for something that cannot fit even in
    // an empty cache is pure loss, so refuse before touching anything.
    if (weight > this.options.maxBytes) return false;

    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes -= previous.weight;
      this.options.onEvict?.(key, previous.value);
    }

    this.entries.set(key, { value, weight });
    this.totalBytes += weight;
    this.evictUntilWithinBudget(key);
    return true;
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.weight;
    this.options.onEvict?.(key, entry.value);
    return true;
  }

  clear(): void {
    // Hand every value back before dropping them: callers release terminal
    // resources in onEvict, and a silent clear would leak them.
    for (const [key, entry] of this.entries) {
      this.options.onEvict?.(key, entry.value);
    }
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictUntilWithinBudget(protectedKey: K): void {
    while (this.entries.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      // The just-inserted entry is never the thing we drop to make room for
      // itself; `set()` has already refused anything that cannot fit.
      if (oldest.value === protectedKey && this.entries.size === 1) break;
      this.delete(oldest.value);
    }
  }
}
