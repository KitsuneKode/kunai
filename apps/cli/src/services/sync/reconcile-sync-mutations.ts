import type { CatalogIdentityService } from "@/services/catalog/CatalogIdentityService";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { SyncService } from "@/services/sync/SyncService";
import type {
  HistoryRepository,
  SyncReconciliationRecord,
  SyncReconciliationRepository,
} from "@kunai/storage";

import { resolveMirrorTargetsStrict } from "./mirror-targets";

export interface SyncReconciliationDeps {
  readonly syncReconciliationRepository: SyncReconciliationRepository;
  readonly historyRepository: HistoryRepository;
  readonly syncService: SyncService;
  readonly catalogIdentityService: Pick<CatalogIdentityService, "enrich">;
  readonly diagnosticsService?: Pick<DiagnosticsService, "record">;
}

export interface SyncReconciliationSummary {
  readonly processed: number;
  readonly queued: number;
  readonly retained: number;
}

export interface SyncReconciliationOptions {
  /** Compatibility alias for the total row budget. */
  readonly limit?: number;
  readonly batchSize?: number;
  readonly maxRows?: number;
  readonly timeBudgetMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly yieldToEventLoop?: () => Promise<void>;
  readonly scheduleContinuation?: (task: () => Promise<void>) => void;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ROWS = 250;
const DEFAULT_TIME_BUDGET_MS = 250;

/**
 * Project tracker-neutral local mutation facts into consent-gated outbox rows.
 * A row is removed only after projection finishes; an exception leaves it for
 * startup/retry, which is the hard-kill recovery contract.
 */
export async function reconcileSyncMutations(
  deps: SyncReconciliationDeps,
  options: SyncReconciliationOptions = {},
): Promise<SyncReconciliationSummary> {
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 50);
  const maxRows = boundedInteger(options.maxRows ?? options.limit, DEFAULT_MAX_ROWS, 1, 500);
  const timeBudgetMs = boundedInteger(options.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 10, 2_000);
  const yieldToEventLoop =
    options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const snapshot = deps.syncReconciliationRepository.listPending(maxRows + 1);
  const records = snapshot.slice(0, maxRows);
  const retainedRefs = new Set<string>();
  let needsContinuation = snapshot.length > maxRows;
  let processed = 0;
  let queued = 0;
  let retained = 0;
  let attempted = 0;
  for (const record of records) {
    if (options.signal?.aborted || now() - startedAt >= timeBudgetMs) {
      needsContinuation = !options.signal?.aborted;
      break;
    }
    let current: SyncReconciliationRecord | undefined = record;
    try {
      // A local write may supersede this generation while identity/config is
      // awaited. Compare-and-delete refuses the stale completion; immediately
      // reread the same durable fact so callers never need another keypress.
      for (let generationAttempt = 0; current && generationAttempt < 8; generationAttempt += 1) {
        const projection = await projectRecord(deps, current, options.signal);
        if (projection.status === "retained") {
          retained += 1;
          retainedRefs.add(reconciliationRef(current));
          deps.diagnosticsService?.record({
            category: "sync",
            message: "Local sync reconciliation retained for retry",
            context: { kind: current.kind, reason: projection.reason },
          });
          current = undefined;
          break;
        }
        queued += projection.queued;
        if (projection.reason === "no-mapping") {
          deps.diagnosticsService?.record({
            category: "sync",
            message: "Local sync reconciliation settled without a proven tracker identity",
            context: { kind: current.kind, reason: projection.reason },
          });
        }
        if (deps.syncReconciliationRepository.complete(current)) {
          processed += 1;
          current = undefined;
          break;
        }
        current = deps.syncReconciliationRepository.getById(current.id);
      }
      if (current) needsContinuation = true;
    } catch (error) {
      retained += 1;
      if (current) retainedRefs.add(reconciliationRef(current));
      deps.diagnosticsService?.record({
        category: "sync",
        message: "Local sync reconciliation retained for retry",
        context: {
          kind: current?.kind ?? record.kind,
          error: error instanceof Error ? error.name : "unknown",
        },
      });
    }
    attempted += 1;
    if (attempted % batchSize === 0 && attempted < records.length) {
      await yieldToEventLoop();
    }
  }

  if (!options.signal?.aborted) {
    const pending = deps.syncReconciliationRepository.listPending(maxRows + 1);
    if (pending.some((record) => !retainedRefs.has(reconciliationRef(record)))) {
      needsContinuation = true;
    }
  }
  if (needsContinuation && !options.signal?.aborted) {
    const schedule =
      options.scheduleContinuation ??
      ((task: () => Promise<void>) => {
        setTimeout(() => void task(), 0);
      });
    schedule(async () => {
      try {
        const continuation = await reconcileSyncMutations(deps, options);
        if (continuation.queued > 0) deps.syncService.deliverSoon();
      } catch (error) {
        deps.diagnosticsService?.record({
          category: "sync",
          message: "Deferred local sync reconciliation failed before completing",
          context: { error: error instanceof Error ? error.name : "unknown" },
        });
      }
    });
  }
  return { processed, queued, retained };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function reconciliationRef(record: Pick<SyncReconciliationRecord, "id" | "generation">): string {
  return `${record.id}:${record.generation}`;
}

async function projectRecord(
  deps: SyncReconciliationDeps,
  record: SyncReconciliationRecord,
  signal?: AbortSignal,
): Promise<
  | {
      readonly status: "settled";
      readonly queued: number;
      readonly reason?: "no-mapping";
    }
  | {
      readonly status: "retained";
      readonly reason: "identity-timeout" | "identity-error" | "caller-aborted";
    }
> {
  const payload = record.payload;
  if (payload.kind === "history") {
    const history = deps.historyRepository.getProgressByKey(payload.historyKey);
    if (!history) return { status: "settled", queued: 0 };
    const targets = await resolveMirrorTargetsStrict(
      deps,
      {
        titleId: history.titleId,
        mediaKind: history.mediaKind,
        title: history.title,
        externalIds: history.externalIds,
      },
      { ...(signal ? { signal } : {}), requiredTracker: "anilist" },
    );
    const unresolved = retainedIdentityProjection(targets);
    if (unresolved) return unresolved;
    if (targets.status === "no-mapping") {
      return { status: "settled", queued: 0, reason: "no-mapping" };
    }
    const anilist = targets.identities[0];
    if (!anilist || anilist.tracker !== "anilist") {
      return { status: "settled", queued: 0, reason: "no-mapping" };
    }
    return {
      status: "settled",
      queued: await deps.syncService.enqueueProgressIfEnabled({
        ...history,
        externalIds: {
          ...history.externalIds,
          anilistId: String(anilist.anilistId),
        },
      }),
    };
  }

  const targets = await resolveMirrorTargetsStrict(
    deps,
    payload.item,
    signal ? { signal } : undefined,
  );
  const unresolved = retainedIdentityProjection(targets);
  if (unresolved) return unresolved;
  if (targets.status === "no-mapping") {
    return { status: "settled", queued: 0, reason: "no-mapping" };
  }
  if (payload.list === "watchlist") {
    return {
      status: "settled",
      queued: await deps.syncService.enqueueListMembershipIfEnabled({
        identities: targets.identities,
        list: "watchlist",
        present: payload.present,
      }),
    };
  }
  return {
    status: "settled",
    queued: await deps.syncService.enqueueFavoriteMembershipIfEnabled({
      identities: targets.identities,
      present: payload.present,
    }),
  };
}

function retainedIdentityProjection(
  targets: Awaited<ReturnType<typeof resolveMirrorTargetsStrict>>,
):
  | {
      readonly status: "retained";
      readonly reason: "identity-timeout" | "identity-error" | "caller-aborted";
    }
  | undefined {
  if (targets.status === "transient") {
    return {
      status: "retained",
      reason: targets.reason === "timeout" ? "identity-timeout" : "identity-error",
    };
  }
  if (targets.status === "aborted") {
    return { status: "retained", reason: "caller-aborted" };
  }
  return undefined;
}
