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
  const sourceEvents = traceEvents.filter(
    (event) => event.type === "source:start" || event.type === "source:failed",
  );
  const canonicalSourceEvents = sourceEvents.filter(
    (event) =>
      typeof event.attempt === "number" ||
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
