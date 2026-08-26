import { expect, test } from "bun:test";

import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import {
  formatDiagnosticEventsAsJsonl,
  formatDiagnosticEventsAsMarkdown,
  formatDiagnosticEventsAsPretty,
  parseDiagnosticsRecentArgs,
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

/**
 * Diagnostics output is pasted into bug reports, so the readable format must be
 * plain text unless colour is explicitly asked for.
 */
test("pretty format stays free of ANSI unless colour is requested", () => {
  const plain = formatDiagnosticEventsAsPretty([event]);
  expect(plain).not.toContain("\u001b[");
  expect(plain).toContain("provider.resolve.timeline");
  expect(plain).toContain("Provider resolve failed");
  expect(plain).toContain("ERROR");

  expect(formatDiagnosticEventsAsPretty([event], { color: true })).toContain("\u001b[");
});

test("pretty format groups the date and prints a session id once per run", () => {
  const second: DiagnosticEvent = {
    ...event,
    timestamp: event.timestamp + 1_000,
    level: "info",
    message: "Provider resolve retried",
  };
  const rendered = formatDiagnosticEventsAsPretty([event, second]);
  const lines = rendered.split("\n");

  expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Local time, not UTC: `recent` is read against the clock on the wall.
  expect(lines.filter((line) => /^\d{2}:\d{2}:\d{2}\.\d{3}\s{2}/.test(line))).toHaveLength(2);
  // The id heads its run rather than repeating on every event.
  expect(lines.filter((line) => line.trim() === "session-1")).toHaveLength(1);
  expect(rendered).not.toContain("session=session-1");
});

test("pretty format keeps every context key and sorts the repetitive ones last", () => {
  const noisy: DiagnosticEvent = {
    ...event,
    context: { status: "failed", failureCode: "need-captcha", severity: "unhealthy", attempts: 3 },
  };
  const details = formatDiagnosticEventsAsPretty([noisy])
    .split("\n")
    .find((line) => line.includes("failureCode="));

  expect(details).toBeDefined();
  // Nothing is hidden — a diagnostics reader that drops fields is worse than a
  // noisy one — but the fields that differ between events lead.
  expect(details).toContain("status=failed");
  expect(details).toContain("severity=unhealthy");
  expect(details?.indexOf("failureCode=")).toBeLessThan(details?.indexOf("status=") ?? -1);
  expect(details?.indexOf("attempts=")).toBeLessThan(details?.indexOf("severity=") ?? -1);
});

test("pretty format quotes only values that would blur into the next pair", () => {
  const spaced: DiagnosticEvent = {
    ...event,
    context: { label: "The Avengers S01E01", reason: "shutdown", count: 2 },
  };
  const rendered = formatDiagnosticEventsAsPretty([spaced]);

  expect(rendered).toContain('label="The Avengers S01E01"');
  expect(rendered).toContain("reason=shutdown");
  expect(rendered).toContain("count=2");
});

test("pretty format reports an empty tail instead of rendering nothing", () => {
  expect(formatDiagnosticEventsAsPretty([])).toBe("No diagnostic events recorded.\n");
});

/**
 * A pipe or redirect must keep the machine format it has always produced, or
 * `kunai diagnostics recent > report.jsonl` and `| jq` silently change shape.
 */
test("format defaults to pretty on a terminal and jsonl when piped", () => {
  expect(parseDiagnosticsRecentArgs([], { isTty: true }).format).toBe("pretty");
  expect(parseDiagnosticsRecentArgs([], { isTty: false }).format).toBe("jsonl");
  expect(parseDiagnosticsRecentArgs([], {}).format).toBe("jsonl");

  // An explicit --format always wins over the terminal default.
  expect(parseDiagnosticsRecentArgs(["--format", "jsonl"], { isTty: true }).format).toBe("jsonl");
  expect(parseDiagnosticsRecentArgs(["--format", "pretty"], { isTty: false }).format).toBe(
    "pretty",
  );
  expect(parseDiagnosticsRecentArgs(["--format", "markdown"], { isTty: true }).format).toBe(
    "markdown",
  );
});

test("colour follows the terminal, and both NO_COLOR and --no-color turn it off", () => {
  expect(parseDiagnosticsRecentArgs([], { isTty: true }).color).toBe(true);
  expect(parseDiagnosticsRecentArgs([], { isTty: false }).color).toBe(false);
  expect(parseDiagnosticsRecentArgs([], { isTty: true, noColor: true }).color).toBe(false);
  expect(parseDiagnosticsRecentArgs(["--no-color"], { isTty: true }).color).toBe(false);
  // --color is the way back on for a pipe that does want escapes.
  expect(parseDiagnosticsRecentArgs(["--color"], { isTty: false }).color).toBe(true);
});

test("limit stays bounded and ignores junk", () => {
  expect(parseDiagnosticsRecentArgs([], {}).limit).toBe(100);
  expect(parseDiagnosticsRecentArgs(["--limit", "5"], {}).limit).toBe(5);
  expect(parseDiagnosticsRecentArgs(["--limit", "999999"], {}).limit).toBe(10_000);
  expect(parseDiagnosticsRecentArgs(["--limit", "nope"], {}).limit).toBe(100);
});

/**
 * One real `skippedReasons` array ran to 82 entries and about two thousand
 * characters, which turned the whole tail into a single unreadable line. The
 * readable format samples it and says how much it dropped; `jsonl` stays
 * lossless so nothing is unrecoverable.
 */
test("pretty format samples oversized values and says what it elided", () => {
  const bulky: DiagnosticEvent = {
    ...event,
    context: {
      skippedReasons: Array.from({ length: 82 }, () => "movie"),
      shortList: ["a", "b"],
      note: "x".repeat(400),
    },
  };
  const rendered = formatDiagnosticEventsAsPretty([bulky]);

  expect(rendered).toContain('skippedReasons=["movie","movie","movie",… +79 more]');
  // A short array is still shown in full.
  expect(rendered).toContain('shortList=["a","b"]');
  expect(rendered).toContain("… +240 chars");
  expect(rendered.split("\n").every((line) => line.length < 400)).toBe(true);

  // The lossless formats keep every entry.
  expect(formatDiagnosticEventsAsJsonl([bulky])).toContain(JSON.stringify(bulky.context));
});
