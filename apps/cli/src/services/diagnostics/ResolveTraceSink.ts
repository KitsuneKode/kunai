import type { ResolveTraceRepository } from "@kunai/storage";
import type { ResolveTrace } from "@kunai/types";

/** The slice of `ResolveTraceRepository` the sink depends on. */
export type ResolveTraceStore = Pick<ResolveTraceRepository, "add" | "listRecent">;

/**
 * Local-only resolve diagnostics.
 *
 * Traces carry title ids, endpoints, and failure detail — everything needed to
 * explain a slow or failed resolve, and everything the opt-in analytics wire
 * format deliberately cannot represent. They are written to the cache database
 * and **never leave the machine**.
 *
 * Retention is owned by the repository and `packages/storage/src/maintenance.ts`;
 * this class adds no second policy. Every call is best-effort: trace persistence must
 * never be able to fail a playback.
 */
export class ResolveTraceSink {
  constructor(private readonly repository: ResolveTraceStore) {}

  record(trace: ResolveTrace): void {
    try {
      this.repository.add(trace);
    } catch {
      // Playback already succeeded or failed on its own merits and must not
      // inherit a storage fault or a schema regression in the trace itself.
    }
  }

  listRecent(limit = 20): readonly ResolveTrace[] {
    try {
      return this.repository.listRecent(limit);
    } catch {
      return [];
    }
  }
}
