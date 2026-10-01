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

export type EndpointResiliencePolicy = {
  /**
   * Consecutive failures before an endpoint cools down. `1` is the
   * single-strike discipline (one failure parks the host — invidious pools,
   * wings seed hosts); `2+` tolerates a transient blip before cooling
   * (vidking's 60s/2-failure rule).
   */
  readonly strikesToCooldown?: number;
  /** The default cooldown once the strike threshold is reached. */
  readonly cooldownMs: number;
  /** Injectable clock so cooldown expiry is testable without real time. */
  readonly now?: () => number;
  /** Hard entry ceiling — same reasoning as {@link TTLCacheOptions.maxEntries}. */
  readonly maxEntries?: number;
};

/**
 * In-memory endpoint resilience tracker — the volatile sibling of the
 * persistent `EndpointHealthPort`. Providers keep one as the fallback for
 * contexts that inject no port (unit tests, bare resolves), and for host-level
 * bookkeeping the port is not scoped to (mirror pools, seed hosts).
 *
 * One primitive replaces what used to be three ad-hoc stores — a TTLCache of
 * flag values (wings), a bare cooldown Map (invidious), and a
 * consecutive-failure counter (vidking) — because the semantics differ only in
 * `strikesToCooldown`: how many consecutive failures park an endpoint, and for
 * how long. A stable success resets both, everywhere.
 *
 * `recordFailure` accepts a per-failure `cooldownMs` override so an upstream
 * `Retry-After` hint lands directly on the endpoint that earned it — a 429's
 * own "come back later" is better evidence than the policy default.
 */
export class EndpointResilienceTracker {
  private readonly cooldowns = new Map<string, number>();
  private readonly failureCounts = new Map<string, number>();
  private readonly strikesToCooldown: number;
  private readonly cooldownMs: number;
  private readonly maxEntries?: number;
  private readonly now: () => number;

  constructor(policy: EndpointResiliencePolicy) {
    this.strikesToCooldown = Math.max(1, policy.strikesToCooldown ?? 1);
    this.cooldownMs = policy.cooldownMs;
    this.maxEntries = policy.maxEntries;
    this.now = policy.now ?? Date.now;
  }

  /**
   * Mark an endpoint as failed. Returns whether it should still be tried —
   * `false` once the strike threshold cools it down. A `cooldownMs` override
   * parks the endpoint for exactly that window regardless of strike count: an
   * explicit upstream `Retry-After` outranks the policy's leniency. `at`
   * anchors the window for callers whose clock is injected per call.
   */
  recordFailure(
    id: string,
    opts?: { readonly cooldownMs?: number; readonly at?: number },
  ): boolean {
    const at = opts?.at ?? this.now();
    let stillTry = true;
    if (opts?.cooldownMs !== undefined) {
      this.cooldowns.set(id, at + Math.max(0, opts.cooldownMs));
      stillTry = false;
    } else {
      const count = (this.failureCounts.get(id) ?? 0) + 1;
      this.failureCounts.set(id, count);
      if (count >= this.strikesToCooldown) {
        this.cooldowns.set(id, at + this.cooldownMs);
        stillTry = false;
      }
    }
    this.evictIfNeeded();
    return stillTry;
  }

  /** A stable success is the only reset that means anything. */
  recordSuccess(id: string): void {
    this.failureCounts.delete(id);
    this.cooldowns.delete(id);
  }

  /** Cooldown expiry self-heals — past the window the endpoint earns a retry. */
  shouldTry(id: string, atEpochMs?: number): boolean {
    const cooldown = this.cooldowns.get(id);
    if (cooldown === undefined) return true;
    if ((atEpochMs ?? this.now()) >= cooldown) {
      this.cooldowns.delete(id);
      this.failureCounts.delete(id);
      return true;
    }
    return false;
  }

  failureCount(id: string): number {
    return this.failureCounts.get(id) ?? 0;
  }

  /** Distinct tracked endpoints — an id can sit in both maps at once. */
  get size(): number {
    let count = 0;
    for (const id of this.cooldowns.keys()) count += this.failureCounts.has(id) ? 0 : 1;
    return count + this.failureCounts.size;
  }

  reset(): void {
    this.cooldowns.clear();
    this.failureCounts.clear();
  }

  private evictIfNeeded(): void {
    const limit = this.maxEntries;
    if (limit === undefined) return;
    const now = this.now();
    for (const [id, until] of this.cooldowns) {
      if (now >= until) {
        this.cooldowns.delete(id);
        this.failureCounts.delete(id);
      }
    }
    while (this.size > limit) {
      const oldest = this.failureCounts.keys().next().value ?? this.cooldowns.keys().next().value;
      if (oldest === undefined) return;
      this.cooldowns.delete(oldest);
      this.failureCounts.delete(oldest);
    }
  }
}
