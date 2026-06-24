import type { KunaiDatabase } from "../sqlite";

export type StoredDiagnosticLevel = "debug" | "info" | "warn" | "error";

export type StoredDiagnosticCategory =
  | "session"
  | "search"
  | "provider"
  | "subtitle"
  | "playback"
  | "cache"
  | "ui"
  | "network"
  | "runtime"
  | "presence"
  | "download"
  | "offline"
  | "update";

export interface StoredDiagnosticEvent {
  readonly timestamp: number;
  readonly level: StoredDiagnosticLevel;
  readonly category: StoredDiagnosticCategory;
  readonly operation: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly titleId?: string;
  readonly providerId?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly context?: Record<string, unknown>;
}

export interface DiagnosticEventPruneOptions {
  readonly now: Date;
  readonly maxEvents: number;
  readonly retentionDays: number;
}

export interface DiagnosticEventPruneResult {
  readonly deleted: number;
}

interface DiagnosticEventRow {
  readonly timestamp: number;
  readonly level: StoredDiagnosticLevel;
  readonly category: StoredDiagnosticCategory;
  readonly operation: string;
  readonly message: string;
  readonly session_id: string | null;
  readonly playback_cycle_id: string | null;
  readonly provider_attempt_id: string | null;
  readonly trace_id: string | null;
  readonly span_id: string | null;
  readonly title_id: string | null;
  readonly provider_id: string | null;
  readonly season: number | null;
  readonly episode: number | null;
  readonly context_json: string | null;
}

const DEFAULT_MAX_EVENTS = 10_000;
const DEFAULT_RETENTION_DAYS = 14;

export class DiagnosticEventsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  insert(event: StoredDiagnosticEvent): void {
    this.db
      .query(
        `
          INSERT INTO diagnostic_events (
            timestamp, level, category, operation, message,
            session_id, playback_cycle_id, provider_attempt_id, trace_id, span_id,
            title_id, provider_id, season, episode, context_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.timestamp,
        event.level,
        event.category,
        event.operation,
        event.message,
        event.sessionId ?? null,
        event.playbackCycleId ?? null,
        event.providerAttemptId ?? null,
        event.traceId ?? null,
        event.spanId ?? null,
        event.titleId ?? null,
        event.providerId ?? null,
        event.season ?? null,
        event.episode ?? null,
        event.context === undefined ? null : JSON.stringify(event.context),
        new Date(event.timestamp).toISOString(),
      );
  }

  listRecent(limit = 100): readonly StoredDiagnosticEvent[] {
    return this.db
      .query<DiagnosticEventRow, [number]>(
        `
          SELECT
            timestamp, level, category, operation, message,
            session_id, playback_cycle_id, provider_attempt_id, trace_id, span_id,
            title_id, provider_id, season, episode, context_json
          FROM diagnostic_events
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `,
      )
      .all(limit)
      .map(rowToEvent);
  }

  listBySession(sessionId: string, limit = 500): readonly StoredDiagnosticEvent[] {
    return this.db
      .query<DiagnosticEventRow, [string, number]>(
        `
          SELECT
            timestamp, level, category, operation, message,
            session_id, playback_cycle_id, provider_attempt_id, trace_id, span_id,
            title_id, provider_id, season, episode, context_json
          FROM diagnostic_events
          WHERE session_id = ?
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `,
      )
      .all(sessionId, limit)
      .map(rowToEvent);
  }

  getSnapshot(limit = 500): readonly StoredDiagnosticEvent[] {
    return [...this.listRecent(limit)].reverse();
  }

  prune(options: Partial<DiagnosticEventPruneOptions> = {}): DiagnosticEventPruneResult {
    const now = options.now ?? new Date();
    const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoffTimestamp = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

    const prune = this.db.transaction(() => {
      const stale = this.db
        .query("DELETE FROM diagnostic_events WHERE timestamp < ?")
        .run(cutoffTimestamp).changes;
      const overflow = this.db
        .query(
          `
            DELETE FROM diagnostic_events
            WHERE id IN (
              SELECT id
              FROM diagnostic_events
              ORDER BY timestamp DESC, id DESC
              LIMIT -1 OFFSET ?
            )
          `,
        )
        .run(maxEvents).changes;

      return stale + overflow;
    });

    return { deleted: prune() };
  }

  clear(): void {
    this.db.query("DELETE FROM diagnostic_events").run();
  }
}

function rowToEvent(row: DiagnosticEventRow): StoredDiagnosticEvent {
  return {
    timestamp: row.timestamp,
    level: row.level,
    category: row.category,
    operation: row.operation,
    message: row.message,
    sessionId: row.session_id ?? undefined,
    playbackCycleId: row.playback_cycle_id ?? undefined,
    providerAttemptId: row.provider_attempt_id ?? undefined,
    traceId: row.trace_id ?? undefined,
    spanId: row.span_id ?? undefined,
    titleId: row.title_id ?? undefined,
    providerId: row.provider_id ?? undefined,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    context: row.context_json ? parseContext(row.context_json) : undefined,
  };
}

function parseContext(value: string): Record<string, unknown> | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}
