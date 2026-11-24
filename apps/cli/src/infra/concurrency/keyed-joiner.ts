// =============================================================================
// keyed-joiner.ts — the one "join a running request by key" implementation.
//
// Every in-flight dedup in the CLI goes through here. Hand-rolled copies kept
// re-growing the same bugs (#730, #731): a follower inheriting the leader's
// signal, a new caller joining work that was already cancelled, a cleared
// entry whose late answer repopulated a cache. The contract below is pinned by
// apps/cli/test/unit/infra/concurrency/keyed-joiner.test.ts.
//
// - One upstream AbortController per entry, owned by the entry, never by a
//   caller. `work` receives its signal.
// - Each caller joins with its own signal. A caller aborting detaches only that
//   caller: its promise rejects with its own abort reason (an Error reason as
//   is; a string or other reason becomes an AbortError).
// - When the last waiter leaves, the upstream is aborted with that waiter's
//   raw reason — the resolve commit policy reads strings like "shutdown" off
//   it ("abort", the default) — or, with `whenAbandoned: "finish"`, the
//   work keeps running so its answer can still warm a cache, and the entry
//   stays joinable until it settles.
// - An entry whose upstream is aborted is never joined; the next call starts
//   fresh.
// - The joiner itself keeps nothing once work settles, so a failed or
//   cancelled answer is never served to a later caller. Work that writes a
//   cache must skip the write when its upstream signal is aborted.
// - `clear()` aborts every running entry and rejects its waiters; a late
//   result from a cleared entry reaches nobody and never re-enters the map.
// =============================================================================

export type JoinRole = "leader" | "follower";

export type KeyedJoinerOptions = {
  /**
   * What the shared work does once its last waiter has left.
   * - `"abort"` (default): abort the upstream with that waiter's reason.
   * - `"finish"`: keep reading so the result can still warm a cache (posters,
   *   type-ahead TMDB answers). The entry stays joinable until it settles.
   */
  readonly whenAbandoned?: "abort" | "finish";
};

export type JoinOptions<C> = {
  /** This caller's own signal. Aborting it detaches this caller only. */
  readonly signal?: AbortSignal;
  /**
   * Entry-scoped state, created once by the leader before `work` starts and
   * handed to every later joiner. Only the leader's factory runs.
   */
  readonly context?: () => C;
  /**
   * Runs for each caller (leader first, before `work` starts) as it takes a
   * place in the entry. The returned function runs exactly once when that
   * caller leaves — settled, aborted, or cleared.
   */
  readonly onJoin?: (context: C, role: JoinRole) => (() => void) | void;
};

export type KeyedJoiner<V, C = undefined> = {
  /** Join the running work for `key`, or start it. */
  join(
    key: string,
    work: (upstream: AbortSignal, context: C) => Promise<V>,
    options?: JoinOptions<C>,
  ): Promise<V>;
  /** Whether a joinable (not yet settled, not aborted) entry exists for `key`. */
  has(key: string): boolean;
  /** Abort every running entry and reject its waiters. Later calls start fresh. */
  clear(): void;
  /** Number of joinable entries. */
  size(): number;
};

type Waiter<V> = {
  readonly resolve: (value: V) => void;
  readonly reject: (reason: Error) => void;
  /** Detach without settling: drops the signal listener and runs onJoin's cleanup. */
  readonly detach: () => void;
};

type Entry<V, C> = {
  readonly controller: AbortController;
  readonly context: C;
  readonly waiters: Set<Waiter<V>>;
};

/** What a caller's promise rejects with when `signal` ends its wait. */
function abortErrorOf(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

const CLEARED = "The shared request was cleared.";

export function createKeyedJoiner<V, C = undefined>(
  options: KeyedJoinerOptions = {},
): KeyedJoiner<V, C> {
  const whenAbandoned = options.whenAbandoned ?? "abort";
  const entries = new Map<string, Entry<V, C>>();

  /** Abort the upstream with `cause`'s raw reason (a clear when absent). */
  function abortEntry(key: string, entry: Entry<V, C>, cause: AbortSignal | undefined): void {
    if (entry.controller.signal.aborted) return;
    if (entries.get(key) === entry) entries.delete(key);
    entry.controller.abort(cause ? cause.reason : new DOMException(CLEARED, "AbortError"));
    const rejection = abortErrorOf(entry.controller.signal);
    const waiters = [...entry.waiters];
    entry.waiters.clear();
    for (const waiter of waiters) {
      waiter.detach();
      waiter.reject(rejection);
    }
  }

  function settle(key: string, entry: Entry<V, C>, deliver: (waiter: Waiter<V>) => void): void {
    if (entries.get(key) === entry) entries.delete(key);
    // Cancelled work reaches nobody: its waiters were rejected (clear) or had
    // all left (last-waiter abort) when the upstream was aborted.
    if (entry.controller.signal.aborted) return;
    const waiters = [...entry.waiters];
    entry.waiters.clear();
    for (const waiter of waiters) {
      waiter.detach();
      deliver(waiter);
    }
  }

  function attach(
    key: string,
    entry: Entry<V, C>,
    role: JoinRole,
    joinOptions: JoinOptions<C> | undefined,
  ): Promise<V> {
    const signal = joinOptions?.signal;
    return new Promise<V>((resolve, reject) => {
      const cleanup = joinOptions?.onJoin?.(entry.context, role);
      let attached = true;
      const detach = () => {
        if (!attached) return;
        attached = false;
        signal?.removeEventListener("abort", onAbort);
        cleanup?.();
      };
      const waiter: Waiter<V> = { resolve, reject, detach };
      const onAbort = (): void => {
        if (!signal || !entry.waiters.delete(waiter)) return;
        detach();
        reject(abortErrorOf(signal));
        if (entry.waiters.size === 0 && whenAbandoned === "abort") {
          abortEntry(key, entry, signal);
        }
      };
      entry.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function join(
    key: string,
    work: (upstream: AbortSignal, context: C) => Promise<V>,
    joinOptions?: JoinOptions<C>,
  ): Promise<V> {
    const signal = joinOptions?.signal;
    // A caller that already left must neither join nor start work nobody reads.
    if (signal?.aborted) return Promise.reject(abortErrorOf(signal));

    const existing = entries.get(key);
    if (existing && !existing.controller.signal.aborted) {
      return attach(key, existing, "follower", joinOptions);
    }

    // SAFETY: `context` is required whenever C is not `undefined` — every
    // caller that declares a context type supplies its factory; for the
    // default C = undefined the absent factory yields exactly `undefined`.
    const context = (joinOptions?.context?.() ?? undefined) as C;
    const entry: Entry<V, C> = {
      controller: new AbortController(),
      context,
      waiters: new Set(),
    };
    entries.set(key, entry);
    // The leader's place is taken before work starts, so anything work emits
    // synchronously already reaches the leader's onJoin consumer.
    const leader = attach(key, entry, "leader", joinOptions);

    let task: Promise<V>;
    try {
      // Called synchronously: callers rely on a miss firing its request in the
      // same tick (the poster pipeline's disk/network lanes do).
      task = work(entry.controller.signal, context);
    } catch (error) {
      task = Promise.reject(error);
    }
    void task.then(
      (value) => settle(key, entry, (waiter) => waiter.resolve(value)),
      (error) => settle(key, entry, (waiter) => waiter.reject(error)),
    );
    return leader;
  }

  return {
    join,
    has: (key) => {
      const entry = entries.get(key);
      return entry !== undefined && !entry.controller.signal.aborted;
    },
    clear: () => {
      // Deleting the visited entry while iterating a Map is safe.
      for (const [key, entry] of entries) abortEntry(key, entry, undefined);
      entries.clear();
    },
    size: () => entries.size,
  };
}
