import { describe, expect, test } from "bun:test";

import {
  buildDiagnosticsPanelModel,
  flattenDiagnosticsPanelSpans,
} from "@/app-shell/diagnostics-panel.model";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { getDiagnosticOperation } from "@/services/diagnostics/operation-taxonomy";

function event(
  over: Partial<DiagnosticEvent> & Pick<DiagnosticEvent, "operation">,
): DiagnosticEvent {
  return {
    timestamp: 1,
    level: "info",
    category: "playback",
    message: over.message ?? over.operation,
    ...over,
  };
}

describe("buildDiagnosticsPanelModel", () => {
  test("groups mixed events from two playback cycles into spans with taxonomy headlines", () => {
    const events: DiagnosticEvent[] = [
      event({
        timestamp: 10,
        playbackCycleId: "cycle-old",
        operation: "mpv.launch.started",
        message: "launched",
        level: "info",
        context: { severity: "healthy", status: "succeeded" },
      }),
      event({
        timestamp: 20,
        playbackCycleId: "cycle-new",
        operation: "provider.resolve.attempt",
        category: "provider",
        message: "attempt",
        level: "info",
        context: { severity: "healthy", status: "started" },
      }),
      event({
        timestamp: 30,
        playbackCycleId: "cycle-new",
        operation: "playback.phase.failed",
        message: "phase failed",
        level: "error",
        context: { severity: "blocked", status: "failed", failureClass: "timeout" },
      }),
      event({
        timestamp: 40,
        playbackCycleId: "cycle-old",
        operation: "mpv.playback.completed",
        message: "done",
        level: "info",
        context: { severity: "healthy", status: "succeeded" },
      }),
    ];

    const model = buildDiagnosticsPanelModel({ recentEvents: events });

    expect(model.spans).toHaveLength(2);
    expect(model.spans.map((span) => span.id)).toEqual(["cycle-new", "cycle-old"]);

    const failing = model.spans[0];
    expect(failing?.worstSeverity).toBe("blocked");
    expect(failing?.eventCount).toBe(2);
    expect(failing?.headline).toBe(getDiagnosticOperation("playback.phase.failed")?.summary);
    expect(failing?.headline).not.toBe("playback.phase.failed");
    expect(failing?.headline).not.toContain("playback.phase.failed");

    const healthy = model.spans[1];
    expect(healthy?.worstSeverity).toBe("healthy");
    expect(healthy?.eventCount).toBe(2);
    expect(healthy?.headline).toBe(getDiagnosticOperation("mpv.playback.completed")?.summary);
    expect(healthy?.headline).not.toBe("mpv.playback.completed");
  });

  test("falls back to traceId when playbackCycleId is absent", () => {
    const model = buildDiagnosticsPanelModel({
      recentEvents: [
        event({
          timestamp: 2,
          traceId: "trace-a",
          operation: "provider.resolve.timeline",
          category: "provider",
          level: "error",
          context: { severity: "recoverable", failureClass: "http" },
        }),
        event({
          timestamp: 1,
          traceId: "trace-b",
          operation: "runtime.memory.sample",
          category: "runtime",
          context: { severity: "healthy" },
        }),
      ],
    });

    expect(model.spans).toHaveLength(2);
    expect(model.spans[0]?.id).toBe("trace-a");
    expect(model.spans[0]?.worstSeverity).toBe("recoverable");
    expect(model.spans[0]?.headline).toBe(
      getDiagnosticOperation("provider.resolve.timeline")?.summary,
    );
  });

  test("marks the newest span expanded by default", () => {
    const model = buildDiagnosticsPanelModel({
      recentEvents: [
        event({ timestamp: 1, playbackCycleId: "older", operation: "session.started" }),
        event({
          timestamp: 2,
          playbackCycleId: "newer",
          operation: "playback.phase.failed",
          level: "error",
          context: { severity: "blocked" },
        }),
      ],
    });

    expect(model.defaultExpandedSpanIds).toEqual(["newer"]);
  });
});

describe("flattenDiagnosticsPanelSpans", () => {
  test("collapses non-expanded spans to a header only", () => {
    const model = buildDiagnosticsPanelModel({
      recentEvents: [
        event({
          timestamp: 2,
          playbackCycleId: "open",
          operation: "playback.phase.failed",
          level: "error",
          message: "phase failed",
          context: { severity: "blocked" },
        }),
        event({
          timestamp: 1,
          playbackCycleId: "closed",
          operation: "mpv.launch.started",
          message: "launched",
          context: { severity: "healthy" },
        }),
      ],
    });

    const lines = flattenDiagnosticsPanelSpans(model, new Set(["open"]));
    const headers = lines.filter((line) => line.spanId);
    expect(headers).toHaveLength(2);
    expect(headers[0]?.spanId).toBe("open");
    expect(headers[0]?.label).toMatch(/^▼/);
    expect(headers[1]?.spanId).toBe("closed");
    expect(headers[1]?.label).toMatch(/^▶/);

    // Section for a span id = header through the line before the next header.
    function sectionForSpanId(spanId: string) {
      const start = lines.findIndex((line) => line.spanId === spanId);
      expect(start).not.toBe(-1);
      const end = lines.findIndex((line, index) => index > start && Boolean(line.spanId));
      return lines.slice(start, end < 0 ? lines.length : end);
    }

    const openSection = sectionForSpanId("open");
    expect(openSection.length).toBeGreaterThan(1);
    expect(openSection.slice(1).every((line) => !line.spanId && line.label.startsWith("  "))).toBe(
      true,
    );
    expect(openSection.some((line) => line.detail?.includes("phase failed"))).toBe(true);

    // Collapsed span: header only — no indented body rows for that span id.
    const closedSection = sectionForSpanId("closed");
    expect(closedSection).toHaveLength(1);
    expect(closedSection[0]?.spanId).toBe("closed");
    expect(closedSection.some((line) => line.label.startsWith("  "))).toBe(false);
    expect(closedSection.some((line) => line.detail?.includes("launched"))).toBe(false);
  });
});
