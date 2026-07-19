import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import type { DiagnosticSeverity } from "@/services/diagnostics/diagnostics-insight";
import { getDiagnosticOperation } from "@/services/diagnostics/operation-taxonomy";

import type { ShellStatusTone } from "./types";

export type DiagnosticsPanelSpan = {
  readonly id: string;
  readonly worstSeverity: DiagnosticSeverity;
  readonly eventCount: number;
  readonly headline: string;
  readonly events: readonly DiagnosticEvent[];
  /** Earliest event timestamp in the span — used to order newest-started first. */
  readonly startedAt: number;
};

export type DiagnosticsPanelModel = {
  readonly spans: readonly DiagnosticsPanelSpan[];
  readonly defaultExpandedSpanIds: readonly string[];
};

export type DiagnosticsPanelFlatLine = {
  readonly label: string;
  readonly detail?: string;
  readonly tone?: ShellStatusTone;
  /** Present on span header rows for expand/collapse targeting. */
  readonly spanId?: string;
};

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  blocked: 4,
  recoverable: 3,
  degraded: 2,
  unknown: 1,
  healthy: 0,
};

function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
  return (
    value === "healthy" ||
    value === "degraded" ||
    value === "recoverable" ||
    value === "blocked" ||
    value === "unknown"
  );
}

export function eventDiagnosticSeverity(event: DiagnosticEvent): DiagnosticSeverity {
  if (isDiagnosticSeverity(event.context?.severity)) {
    return event.context.severity;
  }
  if (event.level === "error") return "blocked";
  if (event.level === "warn") return "recoverable";
  return "healthy";
}

export function diagnosticsSeverityTone(severity: DiagnosticSeverity): ShellStatusTone {
  switch (severity) {
    case "healthy":
      return "success";
    case "degraded":
    case "recoverable":
      return "warning";
    case "blocked":
      return "error";
    default:
      return "neutral";
  }
}

function correlationId(event: DiagnosticEvent): string {
  const cycleId = event.playbackCycleId?.trim();
  if (cycleId) return cycleId;
  const traceId = event.traceId?.trim();
  if (traceId) return traceId;
  return "uncorrelated";
}

function pickHeadlineEvent(events: readonly DiagnosticEvent[]): DiagnosticEvent {
  const first = events[0];
  if (!first) {
    throw new Error("pickHeadlineEvent requires at least one event");
  }
  let best = first;
  for (let i = 1; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;
    const rank = SEVERITY_RANK[eventDiagnosticSeverity(event)];
    const bestRank = SEVERITY_RANK[eventDiagnosticSeverity(best)];
    if (rank > bestRank || (rank === bestRank && event.timestamp > best.timestamp)) {
      best = event;
    }
  }
  return best;
}

function headlineForSpan(events: readonly DiagnosticEvent[]): string {
  const headlineEvent = pickHeadlineEvent(events);
  return (
    getDiagnosticOperation(headlineEvent.operation)?.summary ??
    headlineEvent.message ??
    headlineEvent.operation
  );
}

function worstSeverity(events: readonly DiagnosticEvent[]): DiagnosticSeverity {
  let worst: DiagnosticSeverity = "healthy";
  for (const event of events) {
    const severity = eventDiagnosticSeverity(event);
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) {
      worst = severity;
    }
  }
  return worst;
}

/**
 * Pure span-grouped diagnostics view model.
 * Groups by `playbackCycleId`, falling back to `traceId`.
 * Spans are ordered newest-started first; the newest span is expanded by default.
 */
export function buildDiagnosticsPanelModel(input: {
  readonly recentEvents: readonly DiagnosticEvent[];
}): DiagnosticsPanelModel {
  const groups = new Map<string, DiagnosticEvent[]>();

  for (const event of input.recentEvents) {
    const id = correlationId(event);
    const bucket = groups.get(id);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(id, [event]);
    }
  }

  const spans: DiagnosticsPanelSpan[] = [...groups.entries()].map(([id, events]) => {
    const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
    return {
      id,
      worstSeverity: worstSeverity(ordered),
      eventCount: ordered.length,
      headline: headlineForSpan(ordered),
      events: ordered,
      startedAt: ordered[0]?.timestamp ?? 0,
    };
  });

  spans.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));

  return {
    spans,
    defaultExpandedSpanIds: spans[0] ? [spans[0].id] : [],
  };
}

/**
 * Flatten spans into panel lines. Expanded spans include indented event rows;
 * collapsed spans are header-only (`▶` / `▼`).
 */
export function flattenDiagnosticsPanelSpans(
  model: DiagnosticsPanelModel,
  expandedSpanIds: ReadonlySet<string>,
): DiagnosticsPanelFlatLine[] {
  const lines: DiagnosticsPanelFlatLine[] = [];

  for (const span of model.spans) {
    const expanded = expandedSpanIds.has(span.id);
    lines.push({
      spanId: span.id,
      label: `${expanded ? "▼" : "▶"} ${span.headline}`,
      detail: `${span.eventCount} event${span.eventCount === 1 ? "" : "s"} · ${span.worstSeverity}`,
      tone: diagnosticsSeverityTone(span.worstSeverity),
    });

    if (!expanded) continue;

    const newestFirst = [...span.events].sort((a, b) => b.timestamp - a.timestamp);
    for (const event of newestFirst) {
      lines.push({
        label: `  ${new Date(event.timestamp).toISOString()} [${event.level}]`,
        detail: [event.message, event.operation].filter(Boolean).join("  ·  "),
        tone: event.level === "error" ? "error" : event.level === "warn" ? "warning" : "neutral",
      });
    }
  }

  return lines;
}

export function resolveDiagnosticsExpandedSpanIds(
  model: DiagnosticsPanelModel,
  override: ReadonlySet<string> | null | undefined,
): ReadonlySet<string> {
  if (override) return override;
  return new Set(model.defaultExpandedSpanIds);
}

export function toggleDiagnosticsSpanExpanded(
  current: ReadonlySet<string>,
  spanId: string,
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(spanId)) {
    next.delete(spanId);
  } else {
    next.add(spanId);
  }
  return next;
}
