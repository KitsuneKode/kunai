import { describe, expect, test } from "bun:test";

import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";

/**
 * Work that records every upstream signal it was started with. Each run is
 * settled by hand, so every ordering in this suite is explicit.
 */
function controlledWork<T>() {
  const runs: { signal: AbortSignal; gate: PromiseWithResolvers<T> }[] = [];
  const work = (signal: AbortSignal) => {
    const gate = Promise.withResolvers<T>();
    runs.push({ signal, gate });
    return gate.promise;
  };
  return { runs, work };
}

describe("createKeyedJoiner", () => {
  test("concurrent callers for one key share one run of the work", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();

    const a = joiner.join("k", work);
    const b = joiner.join("k", work);
    expect(runs).toHaveLength(1);

    runs[0]?.gate.resolve("answer");
    expect(await a).toBe("answer");
    expect(await b).toBe("answer");
    expect(joiner.size()).toBe(0);
  });

  test("a miss starts the work synchronously", () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    void joiner.join("k", work);
    expect(runs).toHaveLength(1);
  });

  test("different keys never share", () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    void joiner.join("a", work);
    void joiner.join("b", work);
    expect(runs).toHaveLength(2);
  });

  test("a caller aborting detaches only that caller, with its own reason", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const leaving = new AbortController();
    const staying = new AbortController();
    const reason = new Error("navigated away");

    const left = joiner.join("k", work, { signal: leaving.signal });
    const kept = joiner.join("k", work, { signal: staying.signal });
    leaving.abort(reason);

    await expect(left).rejects.toBe(reason);
    expect(runs[0]?.signal.aborted).toBe(false);
    runs[0]?.gate.resolve("answer");
    expect(await kept).toBe("answer");
  });

  test("the leader aborting does not cancel a follower's answer", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const leader = new AbortController();

    const first = joiner.join("k", work, { signal: leader.signal });
    const second = joiner.join("k", work, { signal: new AbortController().signal });
    leader.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    runs[0]?.gate.resolve("still wanted");
    expect(await second).toBe("still wanted");
  });

  test("when the last waiter leaves, the upstream is aborted with that waiter's reason", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const a = new AbortController();
    const b = new AbortController();
    const lastReason = new Error("last one out");

    const first = joiner.join("k", work, { signal: a.signal });
    const second = joiner.join("k", work, { signal: b.signal });
    a.abort();
    expect(runs[0]?.signal.aborted).toBe(false);
    b.abort(lastReason);

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toBe(lastReason);
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(runs[0]?.signal.reason).toBe(lastReason);
    expect(joiner.has("k")).toBe(false);
  });

  test("an entry whose upstream was aborted is never joined; the next call starts fresh", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const only = new AbortController();

    const abandoned = joiner.join("k", work, { signal: only.signal });
    only.abort();
    await expect(abandoned).rejects.toThrow();

    // The abandoned work has not settled yet — a new caller still gets its own run.
    const fresh = joiner.join("k", work);
    expect(runs).toHaveLength(2);
    runs[0]?.gate.resolve("stale");
    runs[1]?.gate.resolve("fresh");
    expect(await fresh).toBe("fresh");
  });

  test("a signal-less caller keeps the work alive after every signalled caller leaves", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const leaving = new AbortController();

    const left = joiner.join("k", work, { signal: leaving.signal });
    const patient = joiner.join("k", work);
    leaving.abort();

    await expect(left).rejects.toThrow();
    expect(runs[0]?.signal.aborted).toBe(false);
    runs[0]?.gate.resolve("answer");
    expect(await patient).toBe("answer");
  });

  test("finish mode keeps abandoned work running and joinable", async () => {
    const joiner = createKeyedJoiner<string>({ whenAbandoned: "finish" });
    const { runs, work } = controlledWork<string>();
    const only = new AbortController();

    const abandoned = joiner.join("k", work, { signal: only.signal });
    only.abort();
    await expect(abandoned).rejects.toThrow();
    expect(runs[0]?.signal.aborted).toBe(false);
    expect(joiner.has("k")).toBe(true);

    const later = joiner.join("k", work);
    expect(runs).toHaveLength(1);
    runs[0]?.gate.resolve("warmed");
    expect(await later).toBe("warmed");
  });

  test("an already-aborted caller neither starts nor joins work", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const reason = new Error("gone before asking");

    await expect(joiner.join("k", work, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(runs).toHaveLength(0);

    const running = joiner.join("k", work);
    await expect(joiner.join("k", work, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    runs[0]?.gate.resolve("answer");
    expect(await running).toBe("answer");
  });

  test("a failure reaches every waiter and is not kept: the next call retries", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const failure = new Error("upstream down");

    const a = joiner.join("k", work);
    const b = joiner.join("k", work);
    runs[0]?.gate.reject(failure);
    expect(await Promise.allSettled([a, b])).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);

    const retry = joiner.join("k", work);
    expect(runs).toHaveLength(2);
    runs[1]?.gate.resolve("recovered");
    expect(await retry).toBe("recovered");
  });

  test("work that throws synchronously rejects instead of escaping join", async () => {
    const joiner = createKeyedJoiner<string>();
    const failure = new Error("sync throw");
    await expect(
      joiner.join("k", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(joiner.size()).toBe(0);
  });

  test("clear aborts running work, rejects its waiters, and a later call starts fresh", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();

    const waiting = joiner.join("k", work);
    joiner.clear();
    expect(runs[0]?.signal.aborted).toBe(true);
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(joiner.size()).toBe(0);

    const fresh = joiner.join("k", work);
    expect(runs).toHaveLength(2);
    // The cleared run answers late: it must not settle or evict the fresh entry.
    runs[0]?.gate.resolve("late");
    await Promise.resolve();
    expect(joiner.has("k")).toBe(true);
    runs[1]?.gate.resolve("fresh");
    expect(await fresh).toBe("fresh");
  });

  test("clear in finish mode aborts too", async () => {
    const joiner = createKeyedJoiner<string>({ whenAbandoned: "finish" });
    const { runs, work } = controlledWork<string>();
    const waiting = joiner.join("k", work);
    joiner.clear();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(runs[0]?.signal.aborted).toBe(true);
  });

  test("a non-Error reason reaches the upstream raw; the caller still rejects with an Error", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const caller = new AbortController();
    const pending = joiner.join("k", work, { signal: caller.signal });
    caller.abort("shutdown");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runs[0]?.signal.reason).toBe("shutdown");
  });

  test("work that gates its cache write on the upstream signal never caches a cancelled answer", async () => {
    const joiner = createKeyedJoiner<string>();
    const cache = new Map<string, string>();
    const gate = Promise.withResolvers<string>();
    const work = async (signal: AbortSignal) => {
      const value = await gate.promise;
      if (!signal.aborted) cache.set("k", value);
      return value;
    };
    const only = new AbortController();

    const abandoned = joiner.join("k", work, { signal: only.signal });
    only.abort();
    await expect(abandoned).rejects.toThrow();
    gate.resolve("partial");
    await gate.promise;
    await Promise.resolve();
    expect(cache.has("k")).toBe(false);
  });

  test("aborting after the answer arrived is a no-op", async () => {
    const joiner = createKeyedJoiner<string>();
    const { runs, work } = controlledWork<string>();
    const caller = new AbortController();
    const pending = joiner.join("k", work, { signal: caller.signal });
    runs[0]?.gate.resolve("answer");
    expect(await pending).toBe("answer");
    caller.abort();
    expect(runs[0]?.signal.aborted).toBe(false);
  });

  test("context is created once by the leader and shared; onJoin cleanup runs once per caller", async () => {
    type Ctx = { readonly members: Set<string>; created: number };
    let created = 0;
    const joiner = createKeyedJoiner<string, Ctx>();
    const { runs, work } = controlledWork<string>();
    const left: string[] = [];
    const roles: string[] = [];
    const join = (name: string, signal?: AbortSignal) =>
      joiner.join("k", (upstream) => work(upstream), {
        signal,
        context: () => {
          created += 1;
          return { members: new Set(), created };
        },
        onJoin: (ctx, role) => {
          roles.push(`${name}:${role}`);
          ctx.members.add(name);
          return () => {
            ctx.members.delete(name);
            left.push(name);
          };
        },
      });

    const quitter = new AbortController();
    const a = join("a");
    const b = join("b", quitter.signal);
    const c = join("c");
    expect(created).toBe(1);
    expect(roles).toEqual(["a:leader", "b:follower", "c:follower"]);

    quitter.abort();
    await expect(b).rejects.toThrow();
    expect(left).toEqual(["b"]);

    runs[0]?.gate.resolve("done");
    await Promise.all([a, c]);
    expect(left.toSorted()).toEqual(["a", "b", "c"]);
  });

  test("the leader's onJoin runs before work starts, so synchronous output reaches it", async () => {
    const joiner = createKeyedJoiner<string, { readonly seen: string[] }>();
    const seen: string[] = [];
    const result = joiner.join(
      "k",
      async (_signal, ctx) => {
        ctx.seen.push("work-started");
        return "ok";
      },
      {
        context: () => ({ seen }),
        onJoin: (ctx) => {
          ctx.seen.push("leader-joined");
        },
      },
    );
    expect(seen).toEqual(["leader-joined", "work-started"]);
    expect(await result).toBe("ok");
  });

  test("clear runs onJoin cleanup for waiters it rejects", async () => {
    const joiner = createKeyedJoiner<string>();
    const { work } = controlledWork<string>();
    let cleaned = 0;
    const waiting = joiner.join("k", work, {
      onJoin: () => () => {
        cleaned += 1;
      },
    });
    joiner.clear();
    await expect(waiting).rejects.toThrow();
    expect(cleaned).toBe(1);
  });
});
