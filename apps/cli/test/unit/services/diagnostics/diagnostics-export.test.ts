import { expect, test } from "bun:test";

import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import {
  formatDiagnosticEventsAsJsonl,
  formatDiagnosticEventsAsMarkdown,
} from "@/services/diagnostics/diagnostics-export";

const event: DiagnosticEvent = {
  timestamp: Date.parse("2026-06-24T12:00:00.000Z"),
  level: "error",
  category: "provider",
  operation: "provider.resolve.timeline",
  message: "Provider resolve failed",
  sessionId: "session-1",
  traceId: "trace-1",
  providerId: "videasy",
  context: {
    url: "https://cdn.example/stream.m3u8?token=[redacted]",
    outcome: "failed",
  },
};

test("formats diagnostic events as stable jsonl", () => {
  expect(formatDiagnosticEventsAsJsonl([event])).toBe(`${JSON.stringify(event)}\n`);
});

test("formats diagnostic events as copy-friendly markdown", () => {
  expect(formatDiagnosticEventsAsMarkdown([event])).toContain(
    "- 2026-06-24T12:00:00.000Z [error] provider provider.resolve.timeline: Provider resolve failed",
  );
  expect(formatDiagnosticEventsAsMarkdown([event])).toContain("trace=trace-1");
  expect(formatDiagnosticEventsAsMarkdown([event])).toContain(
    '"url": "https://cdn.example/stream.m3u8?token=[redacted]"',
  );
});
