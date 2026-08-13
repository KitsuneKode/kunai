/**
 * Generic TTL cache + health tracker for provider response dedup and server health.
 */

type CacheEntry<V> = { readonly value: V; readonly expiresAt: number };

export type TTLCacheOptions = {
  /**
   * Hard entry ceiling. Without one, a cache keyed by title/media id grows for
   * the whole session: expiry alone never frees anything, because an entry is
   * only dropped when something asks for that exact key again.
   */
  readonly maxEntries?: number;
  /** Injectable clock so eviction and expiry are testable without real time. */
  readonly now?: () => number;
};

export class TTLCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>();
  private readonly maxEntries?: number;
  private readonly now: () => number;

  constructor(
    private readonly defaultTtlMs: number,
    options: TTLCacheOptions = {},
  ) {
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    // Replacing a key must not count as growth, so evict only after the write.
    this.store.set(key, { value, expiresAt: this.now() + (ttlMs ?? this.defaultTtlMs) });
    this.evictIfNeeded();
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove all entries older than the given TTL. */
  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }

  /** Drop expired entries first; only then fall back to oldest-inserted. */
  private evictIfNeeded(): void {
    const limit = this.maxEntries;
    if (limit === undefined || this.store.size <= limit) return;

    this.prune();

    // `Map` iterates in insertion order, so the first key is the oldest write.
    while (this.store.size > limit) {
      const oldest = this.store.keys().next();
      if (oldest.done) return;
      this.store.delete(oldest.value);
    }
  }
}

/**
 * Tracks server/endpoint health with failure cooldown.
 * Skips servers that have failed recently to avoid hammering known-bad endpoints.
 */
export class HealthTracker {
  private readonly cooldowns = new Map<string, number>();
  private readonly failureCounts = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number,
    private readonly maxFailures: number,
  ) {}

  /** Mark a server as failed. Returns true if it should still be tried (within failure limit). */
  recordFailure(id: string): boolean {
    const count = (this.failureCounts.get(id) ?? 0) + 1;
    this.failureCounts.set(id, count);

    if (count >= this.maxFailures) {
      this.cooldowns.set(id, Date.now() + this.cooldownMs);
      return false;
    }
    return true;
  }

  /** Mark a server as healthy (reset failure count). */
  recordSuccess(id: string): void {
    this.failureCounts.delete(id);
    this.cooldowns.delete(id);
  }

  /** Check if a server should be tried (not in cooldown). */
  shouldTry(id: string): boolean {
    const cooldown = this.cooldowns.get(id);
    if (!cooldown) return true;
    if (Date.now() >= cooldown) {
      this.cooldowns.delete(id);
      this.failureCounts.delete(id);
      return true;
    }
    return false;
  }

  /** Get failure count for diagnostics. */
  failureCount(id: string): number {
    return this.failureCounts.get(id) ?? 0;
  }
}
