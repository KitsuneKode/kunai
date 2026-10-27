// =============================================================================
// use-search-suggestions — the debounced catalog fetch behind the band.
//
// Every assertion is driven by a manual timer queue + deferred promises the
// test resolves by hand: no real clock, no sleeps — rapid keystrokes are just
// query changes with no timer flush between them.
// =============================================================================

import { describe, expect, test } from "bun:test";

import {
  useSearchSuggestions,
  type SuggestionTimers,
} from "@/app-shell/hooks/use-search-suggestions";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import { Text } from "ink";
import React, { act, useState } from "react";

import { render } from "../../harness/render-capture";

type Row = { readonly id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function suggestion(id: string): SearchSuggestion<Row> {
  return { id, title: id, source: "catalog", value: { id } };
}

/** Timer queue the test drains by hand — nothing fires until flushed. */
function manualTimers() {
  const queue: Array<{ handle: number; callback: () => void }> = [];
  let next = 0;
  const timers: SuggestionTimers = {
    set: (callback) => {
      const handle = ++next;
      queue.push({ handle, callback });
      return handle;
    },
    clear: (handle) => {
      const index = queue.findIndex((entry) => entry.handle === handle);
      if (index >= 0) queue.splice(index, 1);
    },
  };
  return {
    timers,
    /** Run and drop every queued callback. Returns how many fired. */
    flush(): number {
      const due = queue.splice(0);
      for (const entry of due) entry.callback();
      return due.length;
    },
    get size() {
      return queue.length;
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

type HarnessControl = { readonly setQuery: (q: string) => void };

function Harness({
  initialQuery,
  enabled = true,
  scopeKey,
  onSuggest,
  timers,
  onControl,
}: {
  readonly initialQuery: string;
  readonly enabled?: boolean;
  readonly scopeKey?: string;
  readonly onSuggest: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly SearchSuggestion<Row>[]>;
  readonly timers: SuggestionTimers;
  readonly onControl?: (control: HarnessControl) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const { suggestions, pending } = useSearchSuggestions<Row>({
    query,
    enabled,
    scopeKey,
    onSuggest,
    debounceMs: 300,
    timers,
  });
  onControl?.({ setQuery });
  return <Text>{`pending:${pending} ids:${suggestions.map((entry) => entry.id).join(",")}`}</Text>;
}

describe("useSearchSuggestions", () => {
  test("rapid keystrokes collapse to one request for the resting draft", async () => {
    const clock = manualTimers();
    const calls: string[] = [];
    const pendings: Array<ReturnType<typeof deferred<readonly SearchSuggestion<Row>[]>>> = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialQuery="d"
        timers={clock.timers}
        onControl={(next) => {
          control = next;
        }}
        onSuggest={(query) => {
          calls.push(query);
          const next = deferred<readonly SearchSuggestion<Row>[]>();
          pendings.push(next);
          return next.promise;
        }}
      />,
    );
    try {
      // "d" is below the minimum — nothing should be scheduled.
      expect(clock.size).toBe(0);

      // Rapid typing: each keystroke re-queues, but no timer has flushed yet,
      // so no request has fired.
      for (const next of ["du", "dun", "dune"]) {
        await act(async () => {
          control?.setQuery(next);
          await flushMicrotasks();
        });
      }
      expect(calls).toEqual([]);
      expect(clock.size).toBe(1);

      await act(async () => {
        expect(clock.flush()).toBe(1);
        await flushMicrotasks();
      });
      expect(calls).toEqual(["dune"]);
      expect(handle.lastFrame()).toContain("pending:true");

      await act(async () => {
        pendings[0]?.resolve([suggestion("catalog:1")]);
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("pending:false");
      expect(handle.lastFrame()).toContain("ids:catalog:1");
    } finally {
      handle.unmount();
    }
  });

  test("a superseded response never overwrites the newer request's result", async () => {
    const clock = manualTimers();
    const pendings: Array<ReturnType<typeof deferred<readonly SearchSuggestion<Row>[]>>> = [];
    const queries: string[] = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialQuery="du"
        timers={clock.timers}
        onControl={(next) => {
          control = next;
        }}
        onSuggest={(query) => {
          queries.push(query);
          const next = deferred<readonly SearchSuggestion<Row>[]>();
          pendings.push(next);
          return next.promise;
        }}
      />,
    );
    try {
      // First request fires…
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      expect(queries).toEqual(["du"]);

      // …then the draft changes and a second request fires for the new draft.
      await act(async () => {
        control?.setQuery("dune");
        await flushMicrotasks();
      });
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      expect(queries).toEqual(["du", "dune"]);

      // Newer request answers first.
      await act(async () => {
        pendings[1]?.resolve([suggestion("catalog:new")]);
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("ids:catalog:new");

      // The stale first request finally answers — it must be dropped.
      await act(async () => {
        pendings[0]?.resolve([suggestion("catalog:stale")]);
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("ids:catalog:new");
    } finally {
      handle.unmount();
    }
  });

  test("a draft change aborts the in-flight request signal", async () => {
    const clock = manualTimers();
    const signals: AbortSignal[] = [];
    let control: HarnessControl | undefined;
    const handle = render(
      <Harness
        initialQuery="du"
        timers={clock.timers}
        onControl={(next) => {
          control = next;
        }}
        onSuggest={(_query, signal) => {
          signals.push(signal);
          return deferred<readonly SearchSuggestion<Row>[]>().promise;
        }}
      />,
    );
    try {
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      await act(async () => {
        control?.setQuery("dun");
        await flushMicrotasks();
      });
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      handle.unmount();
    }
  });

  test("a catalog rejection settles quietly to empty, never an error", async () => {
    const clock = manualTimers();
    const pendings: Array<ReturnType<typeof deferred<readonly SearchSuggestion<Row>[]>>> = [];
    const handle = render(
      <Harness
        initialQuery="du"
        timers={clock.timers}
        onSuggest={() => {
          const next = deferred<readonly SearchSuggestion<Row>[]>();
          pendings.push(next);
          return next.promise;
        }}
      />,
    );
    try {
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("pending:true");

      await act(async () => {
        pendings[0]?.reject(new Error("tmdb 500"));
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("pending:false");
      expect(handle.lastFrame()).toContain("ids:");
      expect(handle.lastFrame()).not.toContain("500");
    } finally {
      handle.unmount();
    }
  });

  test("disabled band never schedules and clears any committed rows", async () => {
    const clock = manualTimers();
    const calls: string[] = [];
    const handle = render(
      <Harness
        initialQuery="dune"
        enabled={false}
        timers={clock.timers}
        onSuggest={async (query) => {
          calls.push(query);
          return [suggestion("catalog:x")];
        }}
      />,
    );
    try {
      expect(clock.size).toBe(0);
      expect(handle.lastFrame()).toContain("pending:false");
      expect(handle.lastFrame()).toContain("ids:");
      clock.flush();
      await flushMicrotasks();
      expect(calls).toEqual([]);
    } finally {
      handle.unmount();
    }
  });

  test("unmount aborts the in-flight request", async () => {
    const clock = manualTimers();
    const signals: AbortSignal[] = [];
    const handle = render(
      <Harness
        initialQuery="du"
        timers={clock.timers}
        onSuggest={(_query, signal) => {
          signals.push(signal);
          return deferred<readonly SearchSuggestion<Row>[]>().promise;
        }}
      />,
    );
    await act(async () => {
      clock.flush();
      await flushMicrotasks();
    });
    handle.unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
});

for (const nextScope of ["youtube:youtube", "anime:animegg"]) {
  test(`same-query scope switch to ${nextScope} cancels old suggestions and debounces the new scope`, async () => {
    const clock = manualTimers();
    const old = deferred<readonly SearchSuggestion<Row>[]>();
    const next = deferred<readonly SearchSuggestion<Row>[]>();
    let oldSignal: AbortSignal | undefined;
    let changeScope: (scope: string) => void = () => {};
    const calls: string[] = [];
    function ScopedHarness() {
      const [scope, setScope] = useState("anime:hianime");
      changeScope = setScope;
      return (
        <Harness
          initialQuery="same"
          scopeKey={scope}
          timers={clock.timers}
          onSuggest={(_query, signal) => {
            calls.push(scope);
            if (scope === "anime:hianime") {
              oldSignal = signal;
              return old.promise;
            }
            return next.promise;
          }}
        />
      );
    }
    const handle = render(<ScopedHarness />);
    try {
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      await act(async () => {
        changeScope(nextScope);
        await flushMicrotasks();
      });
      expect(oldSignal?.aborted).toBe(true);
      expect(clock.size).toBe(1);
      await act(async () => {
        old.resolve([suggestion("old-anime")]);
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).not.toContain("old-anime");
      await act(async () => {
        clock.flush();
        await flushMicrotasks();
      });
      expect(calls).toEqual(["anime:hianime", nextScope]);
      await act(async () => {
        next.resolve([suggestion("new-youtube")]);
        await flushMicrotasks();
      });
      expect(handle.lastFrame()).toContain("new-youtube");
    } finally {
      handle.unmount();
    }
  });
}

test("a settled result never renders in a different scope before effects clear it", async () => {
  const clock = manualTimers();
  const observed: Array<{ scope: string; ids: string[] }> = [];
  let changeScope: (scope: string) => void = () => {};
  function ScopedHarness() {
    const [scope, setScope] = useState("anime:hianime");
    changeScope = setScope;
    const state = useSearchSuggestions<Row>({
      query: "same",
      enabled: true,
      scopeKey: scope,
      timers: clock.timers,
      onSuggest: async () => [suggestion(scope)],
    });
    observed.push({ scope, ids: state.suggestions.map((row) => row.id) });
    return <Text>{state.suggestions.map((row) => row.id).join(",")}</Text>;
  }
  const handle = render(<ScopedHarness />);
  try {
    await act(async () => {
      clock.flush();
      await flushMicrotasks();
    });
    expect(handle.lastFrame()).toContain("anime:hianime");
    await act(async () => {
      changeScope("youtube:youtube");
      await flushMicrotasks();
    });
    expect(
      observed
        .filter((row) => row.scope === "youtube:youtube")
        .every((row) => row.ids.length === 0),
    ).toBe(true);
  } finally {
    handle.unmount();
  }
});
