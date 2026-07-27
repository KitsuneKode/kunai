import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { DiagnosticCategory, DiagnosticEventInput } from "./diagnostic-event";
import { normalizeDiagnosticEvent } from "./diagnostic-event";
import { redactDiagnosticValue, resolveRedactionHomeDir } from "./redaction";
import { pruneOldDiagnosticFiles } from "./retention";

export type DebugTraceReporterOptions = {
  readonly filePath: string;
  readonly categories?: ReadonlySet<DiagnosticCategory | string>;
};

export const DEFAULT_DEBUG_SESSION_CATEGORIES = [
  "provider",
  "playback",
  "cache",
  "network",
  "subtitle",
] as const satisfies readonly DiagnosticCategory[];

export class DebugTraceReporter {
  constructor(private readonly options: DebugTraceReporterOptions) {
    const traceDir = dirname(options.filePath);
    mkdirSync(traceDir, { recursive: true });
    void pruneOldDiagnosticFiles({ dir: traceDir, prefix: "kunai-trace-", maxFiles: 10 });
  }

  record(event: DiagnosticEventInput): void {
    if (this.options.categories?.size && !this.options.categories.has(event.category)) {
      return;
    }

    const normalized = normalizeDiagnosticEvent(event);
    const redacted = redactDiagnosticValue(normalized, {
      homeDir: resolveRedactionHomeDir(),
    });
    appendFileSync(this.options.filePath, `${JSON.stringify(redacted)}\n`, "utf8");
  }
}

export function parseTraceCategories(value: string | undefined): ReadonlySet<string> | undefined {
  const categories = value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return categories && categories.length > 0 ? new Set(categories) : undefined;
}

export function resolveTraceCategories(options: {
  readonly explicit?: string;
  readonly debugSession?: boolean;
}): ReadonlySet<string> | undefined {
  return (
    parseTraceCategories(options.explicit) ??
    (options.debugSession ? new Set(DEFAULT_DEBUG_SESSION_CATEGORIES) : undefined)
  );
}

export function buildDebugSessionInstructions(input: {
  readonly tracePath: string;
  readonly categories?: ReadonlySet<string>;
}): readonly string[] {
  const categories = input.categories?.size ? [...input.categories].join(",") : "all";
  return [
    "Kunai debug session enabled.",
    `Trace JSONL: ${input.tracePath}`,
    `Trace categories: ${categories}`,
    "Use /diagnostics or /export-diagnostics after reproducing the issue.",
    "For breakpoints: bun --inspect-brk apps/cli/src/main.ts --debug-session",
  ];
}
