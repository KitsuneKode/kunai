import { expect, test } from "bun:test";

import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

test("support bundle surfaces continuation project and source insights", () => {
  const events: DiagnosticEvent[] = [
    {
      timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
      level: "info",
      category: "session",
      operation: "continuation.project",
      message: "Continuation target selected",
      context: { surface: "calendar", kind: "next-up" },
    },
    {
      timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      level: "info",
      category: "playback",
      operation: "continuation.source",
      message: "Continue source resolved",
      context: { preference: "auto", resolved: "stream" },
    },
  ];

  const bundle = buildDiagnosticsSupportBundle({
    appVersion: "test",
    debug: false,
    events,
  });

  expect(bundle.insights.continuationDecision?.eventCount).toBe(2);
  expect(bundle.insights.continuationDecision?.latestOperation).toBe("continuation.source");
});
