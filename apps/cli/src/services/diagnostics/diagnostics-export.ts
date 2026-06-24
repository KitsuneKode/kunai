import {
  DiagnosticEventsRepository,
  getKunaiPaths,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

import type { DiagnosticEvent } from "./diagnostic-event";

export type DiagnosticsExportFormat = "jsonl" | "markdown";

export interface DiagnosticsRecentCommandOptions {
  readonly format?: DiagnosticsExportFormat;
  readonly limit?: number;
  readonly stdout?: Pick<typeof process.stdout, "write">;
}

export async function runDiagnosticsRecentCommand(
  argv: readonly string[],
  options: DiagnosticsRecentCommandOptions = {},
): Promise<number> {
  if (argv[0] !== "recent") {
    process.stderr.write("Usage: kunai diagnostics recent [--format jsonl|markdown] [--limit N]\n");
    return 1;
  }

  const parsed = parseDiagnosticsRecentArgs(argv.slice(1), options);
  const paths = getKunaiPaths();
  const db = openKunaiDatabase(paths.cacheDbPath);
  try {
    runMigrations(db, "cache");
    const repository = new DiagnosticEventsRepository(db);
    const events = repository.listRecent(parsed.limit) as readonly DiagnosticEvent[];
    const output =
      parsed.format === "markdown"
        ? formatDiagnosticEventsAsMarkdown(events)
        : formatDiagnosticEventsAsJsonl(events);
    (options.stdout ?? process.stdout).write(output);
    return 0;
  } finally {
    db.close();
  }
}

export function formatDiagnosticEventsAsJsonl(events: readonly DiagnosticEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
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

function parseDiagnosticsRecentArgs(
  argv: readonly string[],
  defaults: DiagnosticsRecentCommandOptions,
): { readonly format: DiagnosticsExportFormat; readonly limit: number } {
  let format = defaults.format ?? "jsonl";
  let limit = defaults.limit ?? 100;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      const value = argv[index + 1];
      if (value === "jsonl" || value === "markdown") {
        format = value;
        index += 1;
      }
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

  return { format, limit };
}

function formatCorrelation(event: DiagnosticEvent): string {
  return [
    event.sessionId ? `session=${event.sessionId}` : null,
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
