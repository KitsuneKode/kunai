import { describe, expect, test } from "bun:test";

import type { Logger } from "@/infra/logger/Logger";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { DiagnosticsServiceImpl } from "@/services/diagnostics/DiagnosticsServiceImpl";

function silentLogger(): Logger {
  return {
    child: () => silentLogger(),
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };
}

function event(
  partial: Partial<DiagnosticEvent> & Pick<DiagnosticEvent, "message" | "timestamp">,
): DiagnosticEvent {
  return {
    level: "info",
    category: "runtime",
    operation: "runtime.event",
    ...partial,
  };
}

function serviceWith(input: {
  readonly sessionId: string;
  readonly memory: readonly DiagnosticEvent[];
  readonly durableBySession: readonly DiagnosticEvent[];
  readonly durableGlobal: readonly DiagnosticEvent[];
  readonly durableFailed?: boolean;
  readonly durableThrows?: boolean;
}): DiagnosticsServiceImpl {
  return new DiagnosticsServiceImpl({
    sessionId: input.sessionId,
    logger: silentLogger(),
    store: {
      record: () => {},
      getRecent: (limit) => input.memory.slice(0, limit ?? Number.POSITIVE_INFINITY),
      getSnapshot: () => [...input.memory].reverse(),
      clear: () => {},
    },
    durableSink: {
      enqueue: () => {},
      getRecent: (limit) => input.durableGlobal.slice(0, limit ?? Number.POSITIVE_INFINITY),
      getSnapshot: (limit) => input.durableGlobal.slice(0, limit ?? Number.POSITIVE_INFINITY),
      listBySession: (_sessionId, limit) => {
        if (input.durableThrows) throw new Error("durable read failed");
        return input.durableBySession.slice(0, limit ?? Number.POSITIVE_INFINITY);
      },
      isFailed: () => input.durableFailed === true,
      flush: () => {},
      clear: () => {},
    },
  });
}

describe("diagnostics read policy", () => {
  test("panel and bundle evidence prefer current-session durable over stale global rows", () => {
    const service = serviceWith({
      sessionId: "session-live",
      memory: [event({ message: "memory-live", sessionId: "session-live", timestamp: 20 })],
      durableBySession: [
        event({ message: "durable-live", sessionId: "session-live", timestamp: 10 }),
      ],
      durableGlobal: [event({ message: "stale-old", sessionId: "session-old", timestamp: 30 })],
    });

    const recent = service.getRecent(10);
    expect(recent.map((entry) => entry.message)).toEqual(["memory-live", "durable-live"]);

    const snapshot = service.getSnapshot();
    expect(snapshot.map((entry) => entry.message)).toEqual(["durable-live", "memory-live"]);

    const bundle = service.buildSupportBundle();
    expect(bundle.events.map((entry) => entry.message)).toEqual(["durable-live", "memory-live"]);
    expect(recent.map((entry) => entry.message)).toEqual(
      [...bundle.events].reverse().map((entry) => entry.message),
    );
  });

  test("exact duplicates collapse once while context-distinct events remain", () => {
    const shared = event({
      message: "same",
      sessionId: "session-live",
      timestamp: 10,
      context: { status: "succeeded" },
    });
    const distinct = event({
      message: "same",
      sessionId: "session-live",
      timestamp: 10,
      context: { status: "failed" },
    });
    const service = serviceWith({
      sessionId: "session-live",
      memory: [shared, distinct],
      durableBySession: [shared],
      durableGlobal: [],
    });

    expect(service.getRecent(10)).toEqual([shared, distinct]);
  });

  test("getRecent enforces the requested limit", () => {
    const service = serviceWith({
      sessionId: "session-live",
      memory: [
        event({ message: "m2", sessionId: "session-live", timestamp: 20 }),
        event({ message: "m1", sessionId: "session-live", timestamp: 10 }),
      ],
      durableBySession: [event({ message: "d1", sessionId: "session-live", timestamp: 15 })],
      durableGlobal: [],
    });

    expect(service.getRecent(1).map((entry) => entry.message)).toEqual(["m2"]);
  });

  test("failed or throwing durable sinks return memory", () => {
    const memory = [event({ message: "memory-only", sessionId: "session-live", timestamp: 5 })];
    expect(
      serviceWith({
        sessionId: "session-live",
        memory,
        durableBySession: [
          event({ message: "durable-live", sessionId: "session-live", timestamp: 1 }),
        ],
        durableGlobal: [],
        durableFailed: true,
      })
        .getRecent(10)
        .map((entry) => entry.message),
    ).toEqual(["memory-only"]);

    expect(
      serviceWith({
        sessionId: "session-live",
        memory,
        durableBySession: [],
        durableGlobal: [],
        durableThrows: true,
      })
        .getRecent(10)
        .map((entry) => entry.message),
    ).toEqual(["memory-only"]);
  });
});
