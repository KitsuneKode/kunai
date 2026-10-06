// =============================================================================
// inflight.ts — one shared task per key, per-caller cancellation on join.
//
// The fetch/decode layers underneath are leader-owned: the work runs to
// completion without any single caller's signal, so an aborted follower cannot
// kill a read another follower still needs (and a completed read still warms
// the cache for everyone). Each joiner races its own signal — aborting resolves
// its await early while the shared task continues.
// =============================================================================

type Inflight = {
  /**
   * Join or start the task for `key`. An aborted `signal` resolves `null` for
   * this caller only; the task itself is never cancelled by followers.
   */
  join<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T | null>;
  clear(): void;
  size(): number;
};

export function createKeyedInflight(): Inflight {
  const inflight = new Map<string, Promise<unknown>>();

  async function join<T>(
    key: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    if (signal?.aborted) return null;
    let task = inflight.get(key) as Promise<T> | undefined;
    if (!task) {
      task = work();
      inflight.set(key, task);
      void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
      });
    }
    if (!signal) return task;
    return new Promise<T | null>((resolve) => {
      // The signal may have fired while work() started — before this listener
      // could exist. An already-aborted signal never re-dispatches.
      if (signal.aborted) {
        resolve(null);
        return;
      }
      const onAbort = () => resolve(null);
      signal.addEventListener("abort", onAbort, { once: true });
      void task.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve(null);
        },
      );
    });
  }

  return {
    join,
    clear: () => inflight.clear(),
    size: () => inflight.size,
  };
}
