import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Logger } from "@/infra/logger/Logger";
import { DebugTraceReporter } from "@/services/diagnostics/DebugTraceReporter";
import type { DurableDiagnosticsSink } from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsServiceImpl } from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";
import { AsyncDurableDiagnosticsSink } from "@/services/diagnostics/DurableDiagnosticsSink";
import {
  createResolveWorkLedger,
  finalizeResolveWorkLedger,
} from "@/services/playback/ResolveWorkLedger";
import { DiagnosticEventsRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

type CapturedLog = {
  readonly level: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
};

function createLogger(): Logger & { messages: string[]; entries: CapturedLog[] } {
  const messages: string[] = [];
  const entries: CapturedLog[] = [];
  const capture = (level: string) => (message: string, context?: Record<string, unknown>) => {
    messages.push(`${level}:${message}`);
    entries.push({ level, message, context });
  };
  return {
    messages,
    entries,
    child: () => createLogger(),
    debug: capture("debug"),
    info: capture("info"),
    warn: capture("warn"),
    error: capture("error"),
    fatal: capture("fatal"),
  };
}

describe("DiagnosticsServiceImpl", () => {
  test("normalizes events and forwards them to the store and logger", () => {
    const store = new DiagnosticsStoreImpl();
    const logger = createLogger();
    const service = new DiagnosticsServiceImpl({ store, logger });

    service.record({
      category: "playback",
      operation: "playback.start",
      message: "Playback started",
      providerId: "vidking",
    });

    const event = store.getSnapshot()[0];
    expect(event).toMatchObject({
      level: "info",
      category: "playback",
      operation: "playback.start",
      message: "Playback started",
      providerId: "vidking",
    });
    expect(logger.messages).toEqual(["info:Playback started"]);
  });

  test("promotes legacy bare events into the shared envelope shape", () => {
    const store = new DiagnosticsStoreImpl();
    const service = new DiagnosticsServiceImpl({
      store,
      logger: createLogger(),
      now: () => new Date("2026-06-25T00:00:00.000Z"),
    });

    service.record({
      category: "playback",
      message: "Legacy playback event",
      context: { phase: "resolve" },
    });

    const event = store.getSnapshot()[0];
    expect(event).toMatchObject({
      category: "playback",
      operation: "playback.event",
      message: "Legacy playback event",
      context: {
        status: "succeeded",
        severity: "healthy",
        recommendedAction: "none",
        spanFamily: "playback.startup",
        phase: "resolve",
      },
    });
  });

  test("fans a redacted event out to store logger and trace reporter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-diagnostics-service-"));
    try {
      const filePath = join(dir, "trace.jsonl");
      const store = new DiagnosticsStoreImpl();
      const logger = createLogger();
      const service = new DiagnosticsServiceImpl({
        store,
        logger,
        traceReporter: new DebugTraceReporter({ filePath }),
      });
      const signedUrl =
        "https://cdn.example/stream.m3u8?X-Amz-Signature=secret&Policy=allow&quality=1080p";

      service.record({
        category: "playback",
        operation: "playback.startup.timeline",
        message: "Playback startup resolved",
        context: { streamUrl: signedUrl },
      });

      const expectedUrl =
        "https://cdn.example/stream.m3u8?X-Amz-Signature=[redacted]&Policy=[redacted]&quality=1080p";
      expect(store.getSnapshot()[0]?.context).toMatchObject({
        streamUrl: expectedUrl,
        status: "succeeded",
        spanFamily: "playback.startup",
      });
      expect(logger.entries[0]?.context).toMatchObject({ streamUrl: expectedUrl });
      const trace = JSON.parse((await readFile(filePath, "utf8")).trim());
      expect(trace.context).toMatchObject({ streamUrl: expectedUrl });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("builds support bundles from the same backing store", () => {
    const store = new DiagnosticsStoreImpl();
    const service = new DiagnosticsServiceImpl({
      store,
      logger: createLogger(),
      appVersion: "1.2.3",
      debug: true,
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    service.record({
      category: "cache",
      operation: "cache.hit",
      message: "Cache hit",
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      providerAttemptId: "provider-1",
      traceId: "trace-1",
      context: { streamUrl: "https://cdn.example/stream.m3u8?token=secret" },
    });

    const bundle = service.buildSupportBundle({ capabilities: { mpv: true } });

    expect(bundle.app).toEqual({ version: "1.2.3", debug: true });
    expect(bundle.eventCount).toBe(1);
    expect(bundle.events[0]?.context).toMatchObject({
      streamUrl: "https://cdn.example/stream.m3u8?token=[redacted]",
      status: "succeeded",
      spanFamily: "cache.maintenance",
    });
    expect(bundle.correlation).toEqual({
      sessionIds: ["session-1"],
      playbackCycleIds: ["playback-1"],
      providerAttemptIds: ["provider-1"],
      traceIds: ["trace-1"],
    });
  });

  test("exports retained resolve work ledgers in support bundles", () => {
    const service = new DiagnosticsServiceImpl({
      store: new DiagnosticsStoreImpl(),
      logger: createLogger(),
    });
    const ledger = createResolveWorkLedger({
      identity: {
        title: { id: "series-1", type: "series", name: "Series" },
        episode: { season: 1, episode: 2 },
        mode: "series",
        providerId: "vidking",
        audioPreference: "original",
        subtitlePreference: "none",
        purpose: "playable",
        freshnessPolicy: "trust-fresh",
      },
      intent: "playback",
      budgetLane: "user-blocking",
    });
    const snapshot = finalizeResolveWorkLedger(ledger, "resolved");

    service.recordResolveWorkLedger(snapshot);

    expect(service.buildSupportBundle().insights.resolveWork).toMatchObject({
      physicalWork: [expect.objectContaining({ resolveWorkKey: snapshot.resolveWorkKey })],
    });
  });

  test("queues redacted durable events without throwing when the durable sink fails", () => {
    const persisted: unknown[] = [];
    const durableSink: DurableDiagnosticsSink = {
      enqueue(event) {
        persisted.push(event);
        throw new Error("cache db unavailable");
      },
      getRecent() {
        return [];
      },
      getSnapshot() {
        return [];
      },
      flush() {},
      clear() {},
    };
    const store = new DiagnosticsStoreImpl();
    const service = new DiagnosticsServiceImpl({
      store,
      logger: createLogger(),
      durableSink,
    });

    expect(() =>
      service.record({
        category: "network",
        operation: "network.fetch.failed",
        level: "error",
        message: "Fetch failed",
        context: {
          url: "https://cdn.example/stream.m3u8?token=secret&quality=1080p",
        },
      }),
    ).not.toThrow();

    expect(store.getSnapshot()).toHaveLength(1);
    expect(persisted).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          url: "https://cdn.example/stream.m3u8?token=[redacted]&quality=1080p",
          status: "failed",
          severity: "blocked",
        }),
      }),
    ]);
  });

  test("builds support bundles from durable diagnostics after a service restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-durable-diagnostics-"));
    const db = openKunaiDatabase(join(dir, "cache.sqlite"));
    try {
      runMigrations(db, "cache");
      const repository = new DiagnosticEventsRepository(db);
      const firstService = new DiagnosticsServiceImpl({
        store: new DiagnosticsStoreImpl(),
        logger: createLogger(),
        durableSink: new AsyncDurableDiagnosticsSink({ repository }),
        now: () => new Date(),
      });

      firstService.record({
        category: "provider",
        operation: "provider.resolve.timeline",
        message: "Provider resolve failed",
        level: "error",
        context: { url: "https://cdn.example/watch?token=secret" },
      });
      firstService.flush();

      const secondService = new DiagnosticsServiceImpl({
        store: new DiagnosticsStoreImpl(),
        logger: createLogger(),
        durableSink: new AsyncDurableDiagnosticsSink({ repository }),
      });

      expect(secondService.buildSupportBundle().events).toEqual([
        expect.objectContaining({
          operation: "provider.resolve.timeline",
          context: expect.objectContaining({
            url: "https://cdn.example/watch?token=[redacted]",
            status: "failed",
            spanFamily: "provider.resolve",
          }),
        }),
      ]);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("exposes a revision that increments on record and clear; subscribe stops after unsubscribe", () => {
    const service = new DiagnosticsServiceImpl({
      store: new DiagnosticsStoreImpl(),
      logger: createLogger(),
    });
    const revisions: number[] = [];
    const unsubscribe = service.subscribe(() => revisions.push(service.getRevision()));

    expect(service.getRevision()).toBe(0);

    service.record({
      category: "playback",
      operation: "playback.start",
      message: "Playback started",
    });
    service.clear();

    expect(revisions).toEqual([1, 2]);
    expect(service.getRevision()).toBe(2);

    unsubscribe();
    service.record({
      category: "runtime",
      operation: "runtime.memory.sample",
      message: "after unsubscribe",
    });
    expect(revisions).toEqual([1, 2]);
    expect(service.getRevision()).toBe(3);
  });
});
