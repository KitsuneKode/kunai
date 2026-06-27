import { describe, expect, test } from "bun:test";

import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { AsyncDurableDiagnosticsSink } from "@/services/diagnostics/DurableDiagnosticsSink";
import type { DiagnosticEventsRepository } from "@kunai/storage";

function event(
  partial: Partial<DiagnosticEvent> & Pick<DiagnosticEvent, "message">,
): DiagnosticEvent {
  return {
    timestamp: Date.now(),
    level: "info",
    category: "runtime",
    operation: "runtime",
    ...partial,
  };
}

describe("AsyncDurableDiagnosticsSink", () => {
  test("drops debug progress before error events when queue is full", () => {
    const inserted: DiagnosticEvent[] = [];
    const sink = new AsyncDurableDiagnosticsSink({
      repository: {
        insert: (value: DiagnosticEvent) => {
          inserted.push(value as DiagnosticEvent);
        },
        listRecent: () => inserted,
        getSnapshot: () => inserted,
        prune: () => ({ deleted: 0 }),
        clear: () => {
          inserted.length = 0;
        },
      } as unknown as DiagnosticEventsRepository,
      maxQueueSize: 2,
    });

    sink.enqueue(
      event({
        level: "debug",
        operation: "mpv.network.sample",
        message: "sample-1",
        context: { status: "progress" },
      }),
    );
    sink.enqueue(
      event({
        level: "error",
        operation: "provider.resolve.timeline",
        message: "failed",
      }),
    );
    sink.enqueue(
      event({
        level: "debug",
        operation: "mpv.network.sample",
        message: "sample-2",
        context: { status: "progress" },
      }),
    );

    sink.flush();
    expect(inserted.map((entry) => entry.message)).toEqual(["failed"]);
  });

  test("coalesces repetitive progress samples for the same operation and stage", () => {
    const inserted: DiagnosticEvent[] = [];
    const sink = new AsyncDurableDiagnosticsSink({
      repository: {
        insert: (value: DiagnosticEvent) => {
          inserted.push(value as DiagnosticEvent);
        },
        listRecent: () => inserted,
        getSnapshot: () => inserted,
        prune: () => ({ deleted: 0 }),
        clear: () => {
          inserted.length = 0;
        },
      } as unknown as DiagnosticEventsRepository,
      maxQueueSize: 10,
    });

    for (let index = 0; index < 5; index += 1) {
      sink.enqueue(
        event({
          level: "debug",
          operation: "mpv.network.sample",
          message: `sample-${index}`,
          context: { status: "progress", stage: "buffering", percent: index * 10 },
        }),
      );
    }

    sink.flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.message).toBe("sample-4");
    expect(inserted[0]?.context?.percent).toBe(40);
  });

  test("marks failed and stops enqueueing after repository insert throws", () => {
    const sink = new AsyncDurableDiagnosticsSink({
      repository: {
        insert: () => {
          throw new Error("disk full");
        },
        listRecent: () => [],
        getSnapshot: () => [],
        prune: () => ({ deleted: 0 }),
        clear: () => {},
      } as unknown as DiagnosticEventsRepository,
    });

    expect(() => sink.enqueue(event({ message: "first" }))).not.toThrow();
    sink.flush();
    expect(() => sink.enqueue(event({ message: "second" }))).not.toThrow();
    sink.flush();
  });
});
