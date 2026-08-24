import type { ProviderTraceEvent } from "@kunai/types";

export type ProviderTraceEventSummary = {
  readonly type: ProviderTraceEvent["type"];
  readonly message: string;
  readonly sourceId?: string;
  readonly variantId?: string;
  readonly streamId?: string;
  readonly attempt?: number;
  readonly failureClass?: string | number | boolean | null;
  readonly serverId?: string | number | boolean | null;
  readonly stage?: string;
  /**
   * Milliseconds the stage took, when the provider timed it.
   *
   * Providers already emit `durationMs` on the event, but the summary dropped
   * it, so every consumer of a summarised trace -- the live smokes and the
   * diagnostics panel alike -- could see *that* a stage ran and never *how long
   * it took*. Attributing provider latency then meant re-reading raw events by
   * hand, which is exactly the measurement the timing instrumentation exists to
   * make routine.
   */
  readonly durationMs?: number;
  readonly at: string;
};

export type ProviderTraceSummary = {
  readonly eventCount: number;
  readonly lastEvent: ProviderTraceEventSummary | null;
  readonly sourceAttempts: readonly ProviderTraceEventSummary[];
};

export function summarizeProviderTraceEvents(
  events: readonly ProviderTraceEvent[] | undefined,
): ProviderTraceSummary {
  const traceEvents = events ?? [];
  // `source:success` belongs here too. Timed stages report their duration on
  // the event that ends them, and a stage that ends *well* ends on success --
  // so filtering to start/failed kept every successful stage's timing out of
  // the summary, which is the majority of the latency on a healthy resolve.
  const sourceEvents = traceEvents.filter(
    (event) =>
      event.type === "source:start" ||
      event.type === "source:failed" ||
      event.type === "source:success",
  );
  // A measured stage is canonical on its own. Stage timings carry no attempt,
  // server, or failure class, so keying "canonical" on those alone discarded
  // them whenever any per-attempt event existed alongside.
  const canonicalSourceEvents = sourceEvents.filter(
    (event) =>
      typeof event.attempt === "number" ||
      typeof event.durationMs === "number" ||
      event.attributes?.serverId !== undefined ||
      event.attributes?.failureClass !== undefined,
  );
  return {
    eventCount: traceEvents.length,
    lastEvent: summarizeProviderTraceEvent(traceEvents.at(-1)),
    sourceAttempts: dedupeSourceAttemptSummaries(
      (canonicalSourceEvents.length > 0 ? canonicalSourceEvents : sourceEvents)
        .map(summarizeProviderTraceEvent)
        .filter((event): event is ProviderTraceEventSummary => Boolean(event)),
    ),
  };
}

export function summarizeProviderTraceEvent(
  event: ProviderTraceEvent | undefined,
): ProviderTraceEventSummary | null {
  if (!event) return null;
  return {
    type: event.type,
    message: event.message,
    sourceId: event.sourceId,
    variantId: event.variantId,
    streamId: event.streamId,
    attempt: event.attempt,
    failureClass: event.attributes?.failureClass,
    serverId: event.attributes?.serverId,
    stage: typeof event.attributes?.stage === "string" ? event.attributes.stage : undefined,
    durationMs: event.durationMs,
    at: event.at,
  };
}

function dedupeSourceAttemptSummaries(
  events: readonly ProviderTraceEventSummary[],
): ProviderTraceEventSummary[] {
  const seen = new Set<string>();
  const deduped: ProviderTraceEventSummary[] = [];
  for (const event of events) {
    const key = [
      event.type,
      event.sourceId ?? "",
      event.attempt ?? "",
      event.failureClass ?? "",
      event.serverId ?? "",
      event.stage ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}
