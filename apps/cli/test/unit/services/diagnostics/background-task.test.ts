import { describe, expect, test } from "bun:test";

import { runBackgroundTask } from "@/services/diagnostics/background-task";
import { DiagnosticsStoreImpl } from "@/services/diagnostics/DiagnosticsStoreImpl";

describe("runBackgroundTask", () => {
  test("records rejected fire-and-forget work without leaking sensitive context", async () => {
    const diagnosticsStore = new DiagnosticsStoreImpl();

    runBackgroundTask({
      task: "presence.heartbeat",
      category: "presence",
      diagnostics: diagnosticsStore,
      context: {
        streamUrl: "https://cdn.example/watch/1234567890/master.m3u8?token=secret",
        providerId: "vidking",
        sessionId: "session-1",
        playbackCycleId: "playback-1",
        providerAttemptId: "provider-1",
        traceId: "trace-1",
      },
      run: async () => {
        throw new Error("failed for https://cdn.example/watch/1234567890/master.m3u8?token=secret");
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    const [event] = diagnosticsStore.getSnapshot();
    expect(event).toMatchObject({
      level: "warn",
      category: "presence",
      operation: "background.presence.heartbeat",
      message: "Background task failed: presence.heartbeat",
      providerId: "vidking",
      sessionId: "session-1",
      playbackCycleId: "playback-1",
      providerAttemptId: "provider-1",
      traceId: "trace-1",
    });
    expect(event?.context).toMatchObject({
      errorName: "Error",
      errorMessage:
        "failed for https://cdn.example/watch/[redacted-id]/master.m3u8?token=[redacted]",
      streamUrl: "https://cdn.example/watch/[redacted-id]/master.m3u8?token=[redacted]",
      stage: "presence.heartbeat",
      status: "failed",
      severity: "degraded",
      failureClass: "unknown",
      recommendedAction: "retry",
      spanFamily: "presence.session",
    });
  });

  test("falls back to logger when diagnostics are unavailable", async () => {
    const warnings: unknown[] = [];

    runBackgroundTask({
      task: "update.check",
      category: "update",
      logger: {
        warn: (...args: unknown[]) => warnings.push(args),
      },
      run: Promise.reject(new Error("offline")),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(warnings).toEqual([
      [
        "Background task failed",
        {
          task: "update.check",
          category: "update",
          error: "offline",
        },
      ],
    ]);
  });
});
