import { describe, expect, test } from "bun:test";

import type { ResolveTraceStore } from "@/services/diagnostics/ResolveTraceSink";
import { ResolveTraceSink } from "@/services/diagnostics/ResolveTraceSink";
import type { ResolveTrace } from "@kunai/types";

function trace(id: string): ResolveTrace {
  return {
    id,
    startedAt: "2026-07-28T12:00:00.000Z",
    title: { id: "1", kind: "movie", title: "Fight Club" },
    cacheHit: false,
    steps: [],
    failures: [],
  };
}

function store(overrides: Partial<ResolveTraceStore> = {}): ResolveTraceStore {
  return { add: () => {}, listRecent: () => [], ...overrides };
}

describe("ResolveTraceSink", () => {
  test("records a trace through the repository", () => {
    const added: ResolveTrace[] = [];
    const sink = new ResolveTraceSink(store({ add: (t) => void added.push(t) }));

    sink.record(trace("resolve-1"));

    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe("resolve-1");
  });

  test("a storage fault never escapes — a resolve must not fail on telemetry", () => {
    const sink = new ResolveTraceSink(
      store({
        add: () => {
          throw new Error("database is locked");
        },
      }),
    );

    expect(() => sink.record(trace("resolve-2"))).not.toThrow();
  });

  test("a malformed trace is dropped rather than thrown", () => {
    // The repository validates against resolveTraceSchema before insert, so a
    // shape regression upstream would otherwise surface as a playback failure.
    const sink = new ResolveTraceSink(
      store({
        add: () => {
          throw new Error("invalid trace");
        },
      }),
    );

    expect(() => sink.record({ id: "bad" } as unknown as ResolveTrace)).not.toThrow();
  });

  test("a read fault degrades to an empty list", () => {
    const sink = new ResolveTraceSink(
      store({
        listRecent: () => {
          throw new Error("disk full");
        },
      }),
    );

    expect(sink.listRecent()).toEqual([]);
  });

  test("passes the requested limit through to the repository", () => {
    const seen: number[] = [];
    const sink = new ResolveTraceSink(
      store({
        listRecent: (limit) => {
          seen.push(limit ?? -1);
          return [];
        },
      }),
    );

    sink.listRecent(5);

    expect(seen).toEqual([5]);
  });
});
