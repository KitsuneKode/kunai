// One generation counter for "a refresh happened while this fetch was in flight".
//
// Cache writers use this gate: capture before the fetch, invalidate on
// refresh, and commit only when that capture is still current.

export interface CacheGenerationToken {
  readonly value: number;
}

export interface CacheGenerationCommitOptions {
  readonly signal?: AbortSignal;
  readonly complete?: boolean;
}

export interface CacheGenerationGate {
  capture(): CacheGenerationToken;
  isCurrent(token: CacheGenerationToken): boolean;
  /** Bumps the generation and notifies listeners. Returns the new value. */
  invalidate(): number;
  /**
   * Runs `commit` only when `token` is still current, the caller has not
   * aborted, and `complete` is not false. Returns whether it committed.
   */
  commitIfFresh(
    token: CacheGenerationToken,
    options: CacheGenerationCommitOptions,
    commit: () => void,
  ): boolean;
  /** Fired after every invalidate. The returned function removes the listener. */
  onInvalidate(listener: () => void): () => void;
}

export function createCacheGenerationGate(): CacheGenerationGate {
  let generation = 0;
  const listeners = new Set<() => void>();

  return {
    capture: () => ({ value: generation }),
    isCurrent: (token) => token.value === generation,
    invalidate: () => {
      generation += 1;
      for (const listener of listeners) listener();
      return generation;
    },
    commitIfFresh: (token, options, commit) => {
      if (token.value !== generation) return false;
      if (options.signal?.aborted === true) return false;
      if (options.complete === false) return false;
      commit();
      return true;
    },
    onInvalidate: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
