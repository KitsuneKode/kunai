import { describe, expect, test } from "bun:test";

import type { Logger } from "@/infra/logger/Logger";
import { DiagnosticsServiceImpl } from "@/services/diagnostics/DiagnosticsServiceImpl";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";

function createLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    child: () => createLogger(),
    debug: (message) => messages.push(`debug:${message}`),
    info: (message) => messages.push(`info:${message}`),
    warn: (message) => messages.push(`warn:${message}`),
    error: (message) => messages.push(`error:${message}`),
    fatal: (message) => messages.push(`fatal:${message}`),
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
      context: { streamUrl: "https://cdn.example/stream.m3u8?token=secret" },
    });

    const bundle = service.buildSupportBundle({ capabilities: { mpv: true } });

    expect(bundle.app).toEqual({ version: "1.2.3", debug: true });
    expect(bundle.eventCount).toBe(1);
    expect(bundle.events[0]?.context).toEqual({ streamUrl: "[redacted-url]" });
  });
});
