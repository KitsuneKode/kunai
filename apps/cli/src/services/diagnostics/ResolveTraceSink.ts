import type { ResolveTraceRepository } from "@kunai/storage";
import type { ResolveTrace } from "@kunai/types";

/** The slice of `ResolveTraceRepository` the sink depends on. */
export type ResolveTraceStore = Pick<ResolveTraceRepository, "add" | "listRecent">;

export interface ResolveTraceSinkOptions {
  readonly onFailure?: (failure: { readonly operation: string; readonly message: string }) => void;
}

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
  private readonly failuresReported = new Set<string>();

  constructor(
    private readonly repository: ResolveTraceStore,
    private readonly options: ResolveTraceSinkOptions = {},
  ) {}

  record(trace: ResolveTrace): void {
    try {
      this.repository.add(trace);
    } catch (error) {
      // Playback already succeeded or failed on its own merits and must not
      // inherit a storage fault or a schema regression in the trace itself.
      this.reportOnce("record", error);
    }
  }

  listRecent(limit = 20): readonly ResolveTrace[] {
    try {
      return this.repository.listRecent(limit);
    } catch (error) {
      this.reportOnce("listRecent", error);
      return [];
    }
  }

  private reportOnce(operation: string, error: unknown): void {
    // A broken schema reports once per operation, not on every resolve — the
    // swallow keeps playback safe but the drift stays visible in the log.
    if (this.failuresReported.has(operation)) return;
    this.failuresReported.add(operation);
    try {
      this.options.onFailure?.({
        operation,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Failure callbacks must never break diagnostics.
    }
  }
}
