import { describe, expect, test } from "bun:test";

import { createInitialState } from "@/domain/session/SessionState";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { buildDiagnosticsInsight } from "@/services/diagnostics/diagnostics-insight";
import {
  DiagnosticsServiceImpl,
  mergeDiagnosticEventsByKey,
} from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";

function createLogger() {
  return {
    child: () => createLogger(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
  };
}

describe("diagnostics trust fixes", () => {
  test("findActiveCorrelation prefers playback cycle over bare sessionId", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "en" },
      movie: { audio: "original", subtitle: "en" },
    });
    const insight = buildDiagnosticsInsight({
      state,
      recentEvents: [
        {
          timestamp: 2,
          level: "info",
          category: "runtime",
          operation: "runtime.memory.sample",
          message: "Runtime memory sample",
          sessionId: "session-old",
        },
        {
          timestamp: 1,
          level: "info",
          category: "playback",
          operation: "playback.startup.timeline",
          message: "Startup",
          sessionId: "session-old",
          playbackCycleId: "cycle-active",
          providerAttemptId: "attempt-1",
          traceId: "trace-1",
        },
      ],
    });
    expect(insight.developerEvidence.correlation.playbackCycleId).toBe("cycle-active");
    expect(insight.developerEvidence.correlation.sessionId).toBe("session-old");
  });

  test("mergeDiagnosticEventsByKey keeps newest unique events", () => {
    const memory: DiagnosticEvent[] = [
      {
        timestamp: 3,
        level: "info",
        category: "playback",
        operation: "playback.start",
        message: "live",
        sessionId: "s1",
      },
    ];
    const durable: DiagnosticEvent[] = [
      {
        timestamp: 2,
        level: "info",
        category: "session",
        operation: "session.started",
        message: "old",
        sessionId: "s0",
      },
      {
        timestamp: 3,
        level: "info",
        category: "playback",
        operation: "playback.start",
        message: "live",
        sessionId: "s1",
      },
    ];
    const merged = mergeDiagnosticEventsByKey(memory, durable, 10);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.message).toBe("live");
    expect(merged[1]?.message).toBe("old");
  });

  test("getRecent prefers memory when durable sink has failed", () => {
    const store = new DiagnosticsStoreImpl();
    const service = new DiagnosticsServiceImpl({
      store,
      logger: createLogger(),
      sessionId: "session-live",
      durableSink: {
        enqueue() {},
        getRecent() {
          return [
            {
              timestamp: 1,
              level: "info",
              category: "session",
              operation: "session.started",
              message: "stale prior session",
              sessionId: "session-old",
            },
          ];
        },
        getSnapshot() {
          return this.getRecent();
        },
        isFailed() {
          return true;
        },
        flush() {},
        clear() {},
      },
    });
    service.record({
      category: "playback",
      operation: "playback.start",
      message: "live event",
      sessionId: "session-live",
    });
    expect(service.getRecent(5).map((event) => event.message)).toEqual(["live event"]);
  });
});
