import type { SessionState } from "@/domain/session/SessionState";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";

export type PlaybackFailureWaterfallRow = {
  readonly label: string;
  readonly detail: string | null;
  readonly status: "running" | "failed" | "succeeded";
};

export type PlaybackFailureWaterfallModel = {
  readonly title: string;
  readonly rows: readonly PlaybackFailureWaterfallRow[];
  readonly truncated: boolean;
};

export function buildPlaybackFailureWaterfall({
  state,
  recentEvents,
  maxRows = 5,
}: {
  readonly state: SessionState;
  readonly recentEvents: readonly DiagnosticEvent[];
  readonly maxRows?: number;
}): PlaybackFailureWaterfallModel | null {
  const event = recentEvents.find(
    (candidate) =>
      candidate.operation === "provider.resolve.timeline" &&
      matchesCurrentPlayback(candidate, state),
  );
  if (!event?.context) return null;

  const sourceRows = sourceRowsFromTimeline(event.context);
  const providerRows = providerRowsFromTimeline(event.context);
  const rows = sourceRows.length > 0 ? sourceRows : providerRows;
  if (!rows.length) return null;

  return {
    title: sourceRows.length > 0 ? "Source attempts" : "Provider attempts",
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows || event.context.truncated === true,
  };
}

function matchesCurrentPlayback(event: DiagnosticEvent, state: SessionState): boolean {
  const titleId = state.currentTitle?.id;
  const episode = state.currentEpisode;
  if (titleId && event.titleId && event.titleId !== titleId) return false;
  if (episode?.season && event.season && event.season !== episode.season) return false;
  if (episode?.episode && event.episode && event.episode !== episode.episode) return false;
  return true;
}

function sourceRowsFromTimeline(context: Record<string, unknown>): PlaybackFailureWaterfallRow[] {
  const attempts = Array.isArray(context.sourceAttempts) ? context.sourceAttempts : [];
  const rowsByKey = new Map<string, PlaybackFailureWaterfallRow>();

  for (const attempt of attempts) {
    const row = sourceRowFromAttempt(attempt);
    if (!row) continue;
    const key = sourceAttemptKey(attempt);
    rowsByKey.set(key, mergeSourceRow(rowsByKey.get(key), row));
  }

  const lastTraceRow = sourceRowFromAttempt(context.lastTraceEvent);
  if (lastTraceRow) {
    const key = sourceAttemptKey(context.lastTraceEvent);
    rowsByKey.set(key, mergeSourceRow(rowsByKey.get(key), lastTraceRow));
  }

  return [...rowsByKey.values()];
}

function sourceRowFromAttempt(attempt: unknown): PlaybackFailureWaterfallRow | null {
  if (!attempt || typeof attempt !== "object") return null;
  const record = attempt as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  if (type !== "source:start" && type !== "source:failed" && type !== "source:success") {
    return null;
  }
  const label = sourceLabel(record);
  const failureClass = stringify(record.failureClass);
  const stage = stringify(record.stage);
  const message = stringify(record.message);
  if (type === "source:failed") {
    return {
      label,
      status: "failed",
      detail:
        [stage, failureClass ?? trimProviderMessage(message)].filter(Boolean).join(" · ") || null,
    };
  }
  if (type === "source:success") {
    return {
      label,
      status: "succeeded",
      detail: "playable",
    };
  }
  return {
    label,
    status: "running",
    detail: stage ? `${stage} · tried` : "tried",
  };
}

function mergeSourceRow(
  previous: PlaybackFailureWaterfallRow | undefined,
  next: PlaybackFailureWaterfallRow,
): PlaybackFailureWaterfallRow {
  if (!previous) return next;
  if (previous.status === "succeeded" || next.status === "succeeded") {
    return next.status === "succeeded" ? next : previous;
  }
  if (next.status === "failed") return next;
  return previous;
}

function sourceAttemptKey(attempt: unknown): string {
  if (!attempt || typeof attempt !== "object") return "source:unknown";
  const record = attempt as Record<string, unknown>;
  return [
    stringify(record.serverId) ??
      stringify(record.sourceId) ??
      stringify(record.message) ??
      "source",
    stringify(record.stage),
  ]
    .filter(Boolean)
    .join("|");
}

function sourceLabel(record: Record<string, unknown>): string {
  const serverId = stringify(record.serverId);
  const stage = stringify(record.stage);
  if (serverId) return [serverId, stage].filter(Boolean).join(" · ");
  const sourceId = stringify(record.sourceId);
  if (sourceId) return [sourceId.split(":").at(-1) ?? sourceId, stage].filter(Boolean).join(" · ");
  return trimProviderMessage(stringify(record.message)) ?? "source";
}

function providerRowsFromTimeline(context: Record<string, unknown>): PlaybackFailureWaterfallRow[] {
  const attempts = Array.isArray(context.attemptTimeline) ? context.attemptTimeline : [];
  return attempts
    .map((attempt): PlaybackFailureWaterfallRow | null => {
      if (!attempt || typeof attempt !== "object") return null;
      const record = attempt as Record<string, unknown>;
      const providerId = stringify(record.providerId) ?? "provider";
      const status = stringify(record.status);
      const failureClass = stringify(record.failureClass);
      const summary = stringify(record.summary);
      return {
        label: providerId,
        status: status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "running",
        detail: failureClass ?? trimProviderMessage(summary),
      };
    })
    .filter((row): row is PlaybackFailureWaterfallRow => Boolean(row));
}

function stringify(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function trimProviderMessage(value: string | null): string | null {
  if (!value) return null;
  return (
    value
      .replace(/^Videasy\s+/i, "")
      .replace(/^Server\s+/i, "")
      .trim() || null
  );
}
