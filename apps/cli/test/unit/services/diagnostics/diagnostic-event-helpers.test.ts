import { describe, expect, test } from "bun:test";

import {
  DIAGNOSTIC_SPAN_FAMILIES,
  buildCacheMaintenanceDiagnosticEvent,
  buildDiagnosticEvent,
  buildDownloadDiagnosticEvent,
  buildPlaybackDiagnosticEvent,
  buildPresenceDiagnosticEvent,
  buildRecoveryDiagnosticEvent,
  buildSearchDiagnosticEvent,
  buildSubtitleDiagnosticEvent,
  buildUiDiagnosticEvent,
  mapFailureToRecommendedAction,
  mapSeverityToHealthLabel,
} from "@/services/diagnostics/diagnostic-event-helpers";

describe("diagnostic-event-helpers", () => {
  test("builds a redacted structured envelope", () => {
    const event = buildDiagnosticEvent({
      category: "provider",
      operation: "provider.resolve.attempt",
      stage: "source-fetch",
      status: "failed",
      severity: "recoverable",
      durationMs: 742,
      failureClass: "timeout",
      recommendedAction: "fallback-provider",
      message: "Provider attempt failed",
      providerId: "vidking",
      correlation: {
        sessionId: "sess-1",
        playbackCycleId: "cycle-1",
        providerAttemptId: "attempt-1",
        traceId: "trace-1",
        spanId: "span-1",
      },
      subject: {
        providerId: "vidking",
        titleId: "tmdb:123",
      },
      context: {
        streamUrl: "https://cdn.example/stream.m3u8?token=secret",
        authorization: "Bearer secret",
        home: `${process.env.HOME}/secret/file`,
      },
    });

    expect(event.operation).toBe("provider.resolve.attempt");
    expect(event.context?.stage).toBe("source-fetch");
    expect(event.context?.status).toBe("failed");
    expect(event.context?.severity).toBe("recoverable");
    expect(event.context?.durationMs).toBe(742);
    expect(event.context?.failureClass).toBe("timeout");
    expect(event.context?.recommendedAction).toBe("fallback-provider");
    expect(event.sessionId).toBe("sess-1");
    expect(event.spanId).toBe("span-1");
    expect(JSON.stringify(event)).not.toContain("token=secret");
    expect(JSON.stringify(event)).not.toContain("Bearer secret");
    expect(JSON.stringify(event)).not.toContain(`${process.env.HOME}/secret`);
  });

  test("maps failure classes to recommended actions", () => {
    expect(mapFailureToRecommendedAction("timeout")).toBe("fallback-provider");
    expect(mapFailureToRecommendedAction("dependency")).toBe("check-dependency");
    expect(mapFailureToRecommendedAction("storage")).toBe("retry-download");
    expect(mapFailureToRecommendedAction("unknown")).toBe("export-diagnostics");
  });

  test("maps severity to health labels", () => {
    expect(mapSeverityToHealthLabel("healthy")).toBe("OK");
    expect(mapSeverityToHealthLabel("degraded")).toBe("Needs attention");
    expect(mapSeverityToHealthLabel("blocked")).toBe("Failed");
  });

  test("documents required span families", () => {
    expect(DIAGNOSTIC_SPAN_FAMILIES).toContain("playback.startup");
    expect(DIAGNOSTIC_SPAN_FAMILIES).toContain("provider.resolve");
    expect(DIAGNOSTIC_SPAN_FAMILIES).toContain("shell.overlay");
  });

  test("coalesces progress envelope fields by operation and stage", () => {
    const first = buildDiagnosticEvent({
      category: "playback",
      operation: "mpv.network.sample",
      stage: "buffering",
      status: "progress",
      message: "mpv network sample",
      context: { percent: 10 },
    });
    const second = buildDiagnosticEvent({
      category: "playback",
      operation: "mpv.network.sample",
      stage: "buffering",
      status: "progress",
      message: "mpv network sample",
      context: { percent: 20 },
    });
    expect(first.operation).toBe(second.operation);
    expect(first.context?.stage).toBe("buffering");
  });

  test("builds playback runtime events with the playback startup span", () => {
    const event = buildPlaybackDiagnosticEvent({
      operation: "mpv.network.sample",
      stage: "buffering",
      status: "progress",
      message: "MPV runtime event",
      context: { event: "network-stall", streamUrl: "https://cdn.example/file.m3u8?token=secret" },
    });

    expect(event.category).toBe("playback");
    expect(event.context?.spanFamily).toBe("playback.startup");
    expect(event.context?.status).toBe("progress");
    expect(JSON.stringify(event)).not.toContain("token=secret");
  });

  test("builds subsystem envelopes for recovery, subtitles, downloads, presence, and cache", () => {
    expect(
      buildRecoveryDiagnosticEvent({
        operation: "playback.recovery.decision",
        status: "skipped",
        message: "Recovery skipped",
      }).context?.spanFamily,
    ).toBe("recovery.attempt");

    expect(
      buildSubtitleDiagnosticEvent({
        operation: "subtitle.attach.outcome",
        status: "timed-out",
        failureClass: "timeout",
        message: "Late subtitle attachment timed out",
      }).context?.recommendedAction,
    ).toBe("fallback-provider");

    expect(
      buildDownloadDiagnosticEvent({
        operation: "download.profile.confirmed",
        status: "succeeded",
        message: "Download queued",
      }).context?.spanFamily,
    ).toBe("download.job");

    expect(
      buildPresenceDiagnosticEvent({
        operation: "presence.clear.failed",
        status: "failed",
        failureClass: "ipc",
        message: "Presence clear failed",
      }).context?.recommendedAction,
    ).toBe("recover");

    const cache = buildCacheMaintenanceDiagnosticEvent({
      operation: "storage.maintenance.startup",
      status: "failed",
      failureClass: "storage",
      message: "Cache maintenance failed",
    });
    expect(cache.category).toBe("cache");
    expect(cache.context?.spanFamily).toBe("cache.maintenance");
    expect(cache.context?.recommendedAction).toBe("retry-download");
  });

  test("builds search and shell envelopes with canonical span families", () => {
    const search = buildSearchDiagnosticEvent({
      operation: "search.query.completed",
      status: "succeeded",
      severity: "healthy",
      recommendedAction: "none",
      message: "Search complete",
      context: { query: "Dune", count: 4 },
    });
    expect(search.category).toBe("search");
    expect(search.context?.spanFamily).toBe("search.routing");

    const ui = buildUiDiagnosticEvent({
      operation: "export-diagnostics",
      status: "succeeded",
      severity: "healthy",
      recommendedAction: "none",
      message: "Diagnostics exported",
      context: { path: "kunai-diagnostics-export.json" },
    });
    expect(ui.category).toBe("ui");
    expect(ui.context?.spanFamily).toBe("shell.overlay");
  });
});
