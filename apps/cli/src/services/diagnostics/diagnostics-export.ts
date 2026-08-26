import {
  DiagnosticEventsRepository,
  getKunaiPaths,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

import type { DiagnosticEvent } from "./diagnostic-event";

export type DiagnosticsExportFormat = "jsonl" | "markdown" | "pretty";

export interface DiagnosticsRecentCommandOptions {
  readonly format?: DiagnosticsExportFormat;
  readonly limit?: number;
  readonly stdout?: Pick<typeof process.stdout, "write">;
  /**
   * Whether the destination is an interactive terminal. Drives both the default
   * format and whether colour is emitted, so a pipe keeps getting the machine
   * format it has always got.
   */
  readonly isTty?: boolean;
  readonly noColor?: boolean;
}

export async function runDiagnosticsRecentCommand(
  argv: readonly string[],
  options: DiagnosticsRecentCommandOptions = {},
): Promise<number> {
  if (argv[0] !== "recent") {
    process.stderr.write(
      "Usage: kunai diagnostics recent [--format pretty|jsonl|markdown] [--limit N] [--no-color]\n" +
        "       Defaults to pretty in a terminal and jsonl when piped or redirected.\n",
    );
    return 1;
  }

  const parsed = parseDiagnosticsRecentArgs(argv.slice(1), options);
  const paths = getKunaiPaths();
  const db = openKunaiDatabase(paths.cacheDbPath);
  try {
    runMigrations(db, "cache");
    const repository = new DiagnosticEventsRepository(db);
    const events = repository.listRecent(parsed.limit) as readonly DiagnosticEvent[];
    const output = renderDiagnosticEvents(events, parsed.format, {
      color: parsed.format === "pretty" && parsed.color,
    });
    (options.stdout ?? process.stdout).write(output);
    return 0;
  } finally {
    db.close();
  }
}

function renderDiagnosticEvents(
  events: readonly DiagnosticEvent[],
  format: DiagnosticsExportFormat,
  options: PrettyDiagnosticsOptions,
): string {
  if (format === "markdown") return formatDiagnosticEventsAsMarkdown(events);
  if (format === "pretty") return formatDiagnosticEventsAsPretty(events, options);
  return formatDiagnosticEventsAsJsonl(events);
}

export function formatDiagnosticEventsAsJsonl(events: readonly DiagnosticEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
}

export type PrettyDiagnosticsOptions = {
  /** ANSI colour is opt-in: diagnostics output is pasted into bug reports. */
  readonly color?: boolean;
};

/**
 * Context keys nearly every event repeats with the same value. They are still
 * printed — a diagnostics reader must not hide data — but they sort last so the
 * fields that actually differ between events lead the line.
 */
const LOW_SIGNAL_CONTEXT_KEYS = new Set(["status", "severity", "recommendedAction", "spanFamily"]);

/**
 * Basic 16-colour SGR only. Terminals that report no `COLORTERM`/`TERM` still
 * render these, which 256-colour and truecolour escapes cannot promise.
 */
const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
} as const;

const LEVEL_COLOR: Record<DiagnosticEvent["level"], string> = {
  debug: ANSI.dim,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: `${ANSI.bold}${ANSI.red}`,
};

/**
 * Human-readable rendering of recent diagnostics.
 *
 * The stored form is one JSON object per line, which is right for machines and
 * unreadable in a terminal: a single event wraps over several lines and buries
 * its message among correlation ids. This lays each event out as a timestamped
 * header, its message, and its context as `key=value` pairs, grouped under a
 * date heading so a multi-day tail stays legible.
 */
export function formatDiagnosticEventsAsPretty(
  events: readonly DiagnosticEvent[],
  options: PrettyDiagnosticsOptions = {},
): string {
  if (events.length === 0) return "No diagnostic events recorded.\n";

  const paint = (value: string, code: string): string =>
    options.color ? `${code}${value}${ANSI.reset}` : value;
  const levelWidth = Math.max(...events.map((event) => event.level.length));
  const categoryWidth = Math.max(...events.map((event) => event.category.length));
  // Continuation lines align under the header rather than restating the time.
  const indent = " ".repeat("HH:MM:SS.mmm".length + 2);

  const lines: string[] = [];
  let currentDay: string | null = null;
  let currentSessionId: string | undefined;

  for (const event of events) {
    const date = new Date(event.timestamp);
    const day = formatLocalDay(date);
    if (day !== currentDay) {
      if (lines.length > 0) lines.push("");
      lines.push(paint(day, ANSI.bold));
      currentDay = day;
      // A day heading is a visual break, so reprint the session under it even
      // when the run spans midnight.
      currentSessionId = undefined;
    }
    // A session id is long and usually identical for every event in a tail.
    // Printing it per line buries the fields that differ, so it heads its run
    // instead — the same treatment the date gets.
    if (event.sessionId && event.sessionId !== currentSessionId) {
      lines.push(paint(`${indent}${event.sessionId}`, ANSI.dim));
      currentSessionId = event.sessionId;
    }

    lines.push(
      [
        paint(formatLocalTimeOfDay(date), ANSI.dim),
        paint(event.level.toUpperCase().padEnd(levelWidth), LEVEL_COLOR[event.level]),
        paint(event.category.padEnd(categoryWidth), ANSI.magenta),
        paint(event.operation, ANSI.bold),
      ].join("  "),
    );
    if (event.message) lines.push(`${indent}${event.message}`);

    const details = [
      formatCorrelation(event, { omitSessionId: true }),
      formatPrettyContext(event.context),
    ]
      .filter((part) => part.length > 0)
      .join("  ");
    if (details) lines.push(`${indent}${paint(details, ANSI.dim)}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Local time, not UTC: `recent` is read against the clock on the wall. */
function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalTimeOfDay(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  const millis = `${date.getMilliseconds()}`.padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

function formatPrettyContext(context: Record<string, unknown> | undefined): string {
  if (!context) return "";
  const entries = Object.entries(context).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  entries.sort(([left], [right]) => {
    const leftLow = LOW_SIGNAL_CONTEXT_KEYS.has(left) ? 1 : 0;
    const rightLow = LOW_SIGNAL_CONTEXT_KEYS.has(right) ? 1 : 0;
    return leftLow - rightLow;
  });
  return entries.map(([key, value]) => `${key}=${formatContextValue(value)}`).join("  ");
}

/**
 * Elision bounds for the readable format only.
 *
 * A single context value can be enormous — one real `skippedReasons` array runs
 * to 82 entries and roughly two thousand characters, which turns the whole tail
 * into one unreadable line. `pretty` samples such a value and says how much it
 * left out; `jsonl` and `markdown` stay lossless, so nothing is unrecoverable.
 */
const PRETTY_ARRAY_SAMPLE = 3;
const PRETTY_STRING_MAX = 160;

function formatContextValue(value: unknown): string {
  if (typeof value === "string") {
    const truncated =
      value.length > PRETTY_STRING_MAX
        ? `${value.slice(0, PRETTY_STRING_MAX)}… +${value.length - PRETTY_STRING_MAX} chars`
        : value;
    // Quote only when the value would otherwise blur into the next pair.
    return /[\s=]/.test(truncated) ? JSON.stringify(truncated) : truncated;
  }
  if (Array.isArray(value)) return formatContextArray(value);
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

function formatContextArray(value: readonly unknown[]): string {
  if (value.length <= PRETTY_ARRAY_SAMPLE) return JSON.stringify(value);
  const sample = value
    .slice(0, PRETTY_ARRAY_SAMPLE)
    .map((entry) => JSON.stringify(entry))
    .join(",");
  return `[${sample},… +${value.length - PRETTY_ARRAY_SAMPLE} more]`;
}

export function formatDiagnosticEventsAsMarkdown(events: readonly DiagnosticEvent[]): string {
  if (events.length === 0) return "# Kunai Diagnostics\n\nNo diagnostic events recorded.\n";
  const lines = ["# Kunai Diagnostics", ""];
  for (const event of events) {
    lines.push(
      `- ${new Date(event.timestamp).toISOString()} [${event.level}] ${event.category} ${event.operation}: ${event.message}`,
    );
    const correlation = formatCorrelation(event);
    if (correlation) lines.push(`  - ${correlation}`);
    if (event.context) {
      lines.push("  - context:");
      lines.push(
        ...JSON.stringify(event.context, null, 2)
          .split("\n")
          .map((line) => `    ${line}`),
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Exported so the format-default rule is testable without touching the real
 * profile: `runDiagnosticsRecentCommand` resolves `getKunaiPaths()` and opens
 * the live cache database, which a unit test must never do.
 */
export function parseDiagnosticsRecentArgs(
  argv: readonly string[],
  defaults: DiagnosticsRecentCommandOptions,
): {
  readonly format: DiagnosticsExportFormat;
  readonly limit: number;
  readonly color: boolean;
} {
  // A terminal gets the readable format; a pipe or redirect keeps the machine
  // format it has always received, so `> file` and `| jq` are unaffected.
  const isTty = defaults.isTty ?? false;
  let format: DiagnosticsExportFormat = defaults.format ?? (isTty ? "pretty" : "jsonl");
  let limit = defaults.limit ?? 100;
  let color = isTty && !defaults.noColor;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      const value = argv[index + 1];
      if (value === "jsonl" || value === "markdown" || value === "pretty") {
        format = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--no-color") {
      color = false;
      continue;
    }
    if (arg === "--color") {
      color = true;
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        limit = Math.min(value, 10_000);
        index += 1;
      }
    }
  }

  return { format, limit, color };
}

function formatCorrelation(
  event: DiagnosticEvent,
  options: { readonly omitSessionId?: boolean } = {},
): string {
  return [
    event.sessionId && !options.omitSessionId ? `session=${event.sessionId}` : null,
    event.playbackCycleId ? `playbackCycle=${event.playbackCycleId}` : null,
    event.providerAttemptId ? `providerAttempt=${event.providerAttemptId}` : null,
    event.traceId ? `trace=${event.traceId}` : null,
    event.spanId ? `span=${event.spanId}` : null,
    event.titleId ? `title=${event.titleId}` : null,
    event.providerId ? `provider=${event.providerId}` : null,
  ]
    .filter(Boolean)
    .join("  ");
}
