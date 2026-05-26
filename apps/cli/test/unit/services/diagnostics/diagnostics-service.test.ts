import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Logger } from "@/infra/logger/Logger";
import { DebugTraceReporter } from "@/services/diagnostics/DebugTraceReporter";
import { DiagnosticsServiceImpl } from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";

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
      expect(store.getSnapshot()[0]?.context).toEqual({ streamUrl: expectedUrl });
      expect(logger.entries[0]?.context).toMatchObject({ streamUrl: expectedUrl });
      const trace = JSON.parse((await readFile(filePath, "utf8")).trim());
      expect(trace.context).toEqual({ streamUrl: expectedUrl });
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
    expect(bundle.events[0]?.context).toEqual({
      streamUrl: "https://cdn.example/stream.m3u8?token=[redacted]",
    });
    expect(bundle.correlation).toEqual({
      sessionIds: ["session-1"],
      playbackCycleIds: ["playback-1"],
      providerAttemptIds: ["provider-1"],
      traceIds: ["trace-1"],
    });
  });
});
