import { resolveTraceSchema } from "@kunai/schemas";
import type { ResolveTrace } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

interface ResolveTraceRow {
  readonly trace_json: string;
}

function parseStoredTrace(traceJson: string): ResolveTrace | undefined {
  try {
    const parsed = resolveTraceSchema.safeParse(JSON.parse(traceJson));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export class ResolveTraceRepository {
  constructor(private readonly db: KunaiDatabase) {}

  add(trace: ResolveTrace, maxEntries = 200): void {
    const parsed = resolveTraceSchema.parse(trace);
    const now = new Date().toISOString();

    const addAndPrune = this.db.transaction(() => {
      this.db
        .query(
          `
            INSERT INTO resolve_traces (trace_id, trace_json, started_at, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(trace_id) DO UPDATE SET
              trace_json = excluded.trace_json,
              started_at = excluded.started_at
          `,
        )
        .run(parsed.id, JSON.stringify(parsed), parsed.startedAt, now);

      this.db
        .query(
          `
            DELETE FROM resolve_traces
            WHERE trace_id IN (
              SELECT trace_id
              FROM resolve_traces
              ORDER BY started_at DESC
              LIMIT -1 OFFSET ?
            )
          `,
        )
        .run(maxEntries);
    });

    addAndPrune();
  }

  get(traceId: string): ResolveTrace | undefined {
    const row = this.db
      .query<ResolveTraceRow, [string]>("SELECT trace_json FROM resolve_traces WHERE trace_id = ?")
      .get(traceId);

    if (row === null) return undefined;
    return parseStoredTrace(row.trace_json);
  }

  listRecent(limit = 20): readonly ResolveTrace[] {
    const traces: ResolveTrace[] = [];
    for (const row of this.db
      .query<ResolveTraceRow, [number]>(
        "SELECT trace_json FROM resolve_traces ORDER BY started_at DESC LIMIT ?",
      )
      .all(limit)) {
      // One poisoned row (downgrade, hand-edit, torn write) must not blank the
      // whole diagnostics list — skip it, keep the rest.
      const parsed = parseStoredTrace(row.trace_json);
      if (parsed) traces.push(parsed);
    }
    return traces;
  }
}
