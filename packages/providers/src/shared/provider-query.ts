/**
 * `ProviderQueryCache` — one keyed async-cache primitive for the sites that used
 * to hand-roll it: a bare `Map` with hand-rolled expiry (movy seeds), a
 * `Map<K, Promise>` for probe dedup (miruro curl probes), a keyed TTL map with
 * stale-on-error fallback (invidious instance pools), a module-level
 * `inFlight` singleton (AllManga crypto derivation), and a value-carried
 * expiry map (vidlink enc-dec). Same contract everywhere, stated once:
 *
 * - **Query keys.** One entry per key; keys are caller-shaped (ids, urls).
 * - **In-flight dedup.** Two callers asking for the same key share one fetch.
 *   The fetcher's signal is the *first* caller's — a joiner whose own signal
 *   aborts still gets the shared promise, and if the first caller's abort
 *   rejects the fetch, joiners see the rejection and simply retry.
 * - **TTL.** Fresh entries return without touching the network. `ttlMs` may be
 *   a function of the resolved value for upstream-provided lifetimes (seed
 *   `ttlMs`, enc-dec `expiresAt`).
 * - **Stale-if-error.** With `staleIfError`, an expired entry survives a failed
 *   refresh — a broken registry still names instances that probably work.
 *   Errors are never *stored*: a thrown fetch clears in-flight and the next
 *   call retries fresh.
 * - **Abort honesty.** An aborted fetch is a failed fetch — it does not freeze
 *   a partial result into a long-lived entry. Fetchers that can produce a
 *   meaningful partial must say so by resolving, not throwing.
 * - **Bounded.** `maxEntries` evicts oldest-inserted, like {@link TTLCache}.
 *
 * This is deliberately not a TanStack port — there is no observer, no
 * background revalidation, and no retry policy; those belong to the caller's
 * cycle. It is the "query cache minus React" slice the provider layer needs.
 */
export type ProviderQueryPolicy<V> = {
  /** Freshness window; a function receives the stored value for upstream TTLs. */
  readonly ttlMs: number | ((value: V) => number);
  /**
   * Serve an expired entry when its refresh throws. The stale value is a better
   * answer than an error for directories and registries; never enable it for
   * secrets or seed material where staleness *is* the failure. A predicate
   * form receives the error and the call's signal — a caller abort is not a
   * fetch failure and must never be masked by a stale answer.
   */
  readonly staleIfError?:
    | boolean
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- predicate receives whatever the fetcher threw; untyped by contract
    | ((error: unknown, call: ProviderQueryCall | undefined) => boolean);
  /**
   * Treat entries expiring within this window as already stale — the fetch
   * happens anyway. For upstreams whose own TTL must not be spent to zero
   * before the value is used (movy's 5s headroom).
   */
  readonly refreshHeadroomMs?: number;
  /**
   * Resolved values failing this predicate are returned but never stored — an
   * empty registry page is a valid answer to hand the caller, not a fact worth
   * holding (the invidious "empty pool must not replace a working one" rule).
   */
  readonly cacheIf?: (value: V) => boolean;
  /** Hard entry ceiling — oldest-inserted evicts first. */
  readonly maxEntries?: number;
  /** Injectable clock so expiry is testable without real time. */
  readonly now?: () => number;
};

export type ProviderQueryCall = {
  /**
   * Per-call clock override (epoch ms) for callers whose clock is injected at
   * the boundary rather than fixed at construction — the invidious pool's
   * `options.now` seam.
   */
  readonly at?: number;
  /** The caller's signal, so `staleIfError` predicates can honor abort. */
  readonly signal?: AbortSignal;
};

export class ProviderQueryCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly ttlMs: ProviderQueryPolicy<V>["ttlMs"];
  private readonly staleIfError: ProviderQueryPolicy<V>["staleIfError"];
  private readonly refreshHeadroomMs: number;
  private readonly cacheIf?: (value: V) => boolean;
  private readonly maxEntries?: number;
  private readonly now: () => number;

  constructor(policy: ProviderQueryPolicy<V>) {
    this.ttlMs = policy.ttlMs;
    this.staleIfError = policy.staleIfError ?? false;
    this.refreshHeadroomMs = policy.refreshHeadroomMs ?? 0;
    this.cacheIf = policy.cacheIf;
    this.maxEntries = policy.maxEntries;
    this.now = policy.now ?? Date.now;
  }

  /** Fresh entry or undefined — no network, no stale answers. */
  get(key: K, call?: ProviderQueryCall): V | undefined {
    const now = call?.at ?? this.now();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt - this.refreshHeadroomMs <= now) {
      if (entry.expiresAt <= now) this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * The one door: fresh-hit, else dedup on the shared fetch, else run it.
   * A stale entry is not served here — `query` awaits the refresh so callers
   * get the freshest answer; `staleIfError` decides what a failed refresh
   * means (serve the stale entry, or propagate the error).
   */
  query(key: K, fetcher: () => Promise<V>, call?: ProviderQueryCall): Promise<V> {
    const now = call?.at ?? this.now();
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt - this.refreshHeadroomMs > now) {
      return Promise.resolve(entry.value);
    }

    /* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters --
     * typeof narrows the declared boolean|function and number|function policy
     * unions; rejection handlers receive genuinely untyped thrown values. */
    const staleIfError = (error: unknown) =>
      typeof this.staleIfError === "function" ? this.staleIfError(error, call) : this.staleIfError;

    const pending = this.inFlight.get(key);
    if (pending) {
      if (entry && this.staleIfError) {
        return pending.catch((error: unknown) =>
          staleIfError(error) ? entry.value : Promise.reject(error),
        );
      }
      return pending;
    }

    const fetch = fetcher().then(
      (value) => {
        if (this.cacheIf && !this.cacheIf(value)) return value;
        const ttl = typeof this.ttlMs === "function" ? this.ttlMs(value) : this.ttlMs;
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: now + Math.max(0, ttl) });
        this.evictIfNeeded(now);
        return value;
      },
      (error: unknown) => {
        if (entry && staleIfError(error)) {
          // Refresh failed — keep the stale entry for the next caller too.
          return entry.value;
        }
        this.entries.delete(key);
        throw error;
      },
    );
    /* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters */
    // Store the shared promise; rejections are marked handled so a losing
    // joiner that never awaited it cannot trip an unhandled-rejection.
    const shared = fetch.finally(() => {
      if (this.inFlight.get(key) === shared) this.inFlight.delete(key);
    });
    shared.catch(() => {});
    this.inFlight.set(key, shared);
    return shared;
  }

  invalidate(key: K): void {
    this.entries.delete(key);
  }

  reset(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * The expiry sweep must run on the same clock basis as the entries it
   * inspects — a caller-injected `at` (a test epoch like 0) mixed with a
   * real-time sweep would evict every write as "already expired".
   */
  private evictIfNeeded(now: number): void {
    const limit = this.maxEntries;
    if (limit === undefined) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
