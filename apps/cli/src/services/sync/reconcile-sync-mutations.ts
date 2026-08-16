import type { CatalogIdentityService } from "@/services/catalog/CatalogIdentityService";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import { SyncAdmissionAbortedError, type SyncService } from "@/services/sync/SyncService";
import type {
  HistoryRepository,
  SyncReconciliationRecord,
  SyncReconciliationRepository,
} from "@kunai/storage";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

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
  readonly wallNow?: () => Date;
  readonly yieldToEventLoop?: () => Promise<void>;
  readonly scheduleContinuation?: (task: () => Promise<void>, delayMs?: number) => void;
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
  const wallNow = options.wallNow ?? (() => new Date());
  const signal = options.signal
    ? AbortSignal.any([deps.syncService.lifetimeSignal, options.signal])
    : deps.syncService.lifetimeSignal;
  const startedAt = now();
  const snapshot = deps.syncReconciliationRepository.listDue(wallNow(), maxRows + 1);
  const records = snapshot.slice(0, maxRows);
  let needsContinuation = snapshot.length > maxRows;
  let processed = 0;
  let queued = 0;
  let retained = 0;
  let attempted = 0;
  for (const record of records) {
    if (signal.aborted || now() - startedAt >= timeBudgetMs) {
      needsContinuation = !signal.aborted;
      break;
    }
    let current: SyncReconciliationRecord | undefined = record;
    try {
      // A local write may supersede this generation while identity/config is
      // awaited. Compare-and-delete refuses the stale completion; immediately
      // reread the same durable fact so callers never need another keypress.
      for (let generationAttempt = 0; current && generationAttempt < 8; generationAttempt += 1) {
        const projection = await projectRecord(deps, current, signal);
        if (projection.status === "retained") {
          if (deps.syncReconciliationRepository.defer(current, wallNow())) {
            retained += 1;
            deps.diagnosticsService?.record({
              category: "sync",
              message: "Local sync reconciliation retained for retry",
              context: { kind: current.kind, reason: projection.reason },
            });
            current = undefined;
            break;
          }
          current = deps.syncReconciliationRepository.getById(current.id);
          continue;
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
      if (current && !deps.syncReconciliationRepository.defer(current, wallNow())) {
        needsContinuation = true;
      }
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

  let continuationDelayMs = 0;
  if (!signal.aborted) {
    const currentWallTime = wallNow();
    const due = deps.syncReconciliationRepository.listDue(currentWallTime, 1);
    if (due.length > 0) {
      needsContinuation = true;
    } else {
      const nextAttemptAt = deps.syncReconciliationRepository.nextAttemptAt();
      if (nextAttemptAt) {
        needsContinuation = true;
        continuationDelayMs = Math.max(1, Date.parse(nextAttemptAt) - currentWallTime.getTime());
      }
    }
  }
  if (needsContinuation && !signal.aborted) {
    const schedule =
      options.scheduleContinuation ??
      ((task: () => Promise<void>, delayMs = 0) => {
        const timer = setTimeout(() => void task(), delayMs);
        timer.unref();
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
    }, continuationDelayMs);
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
    const admission = await deps.syncService.checkAutomaticAdmission(
      { tracker: "anilist", capability: "progress" },
      signal ? { signal } : undefined,
    );
    if (admission === "aborted") {
      return { status: "retained", reason: "caller-aborted" };
    }
    if (admission === "disabled") return { status: "settled", queued: 0 };
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
    return enqueueWithAdmissionSignal(() =>
      deps.syncService.enqueueProgressIfEnabled(
        {
          ...history,
          externalIds: {
            ...history.externalIds,
            anilistId: String(anilist.anilistId),
          },
        },
        signal ? { signal } : undefined,
      ),
    );
  }

  const capability = payload.list === "watchlist" ? "watchlist" : "favorite";
  const admission = await checkListAdmission(deps.syncService, payload.item, capability, signal);
  if (admission === "aborted") {
    return { status: "retained", reason: "caller-aborted" };
  }
  if (admission === "disabled") return { status: "settled", queued: 0 };
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
    return enqueueWithAdmissionSignal(() =>
      deps.syncService.enqueueListMembershipIfEnabled(
        {
          identities: targets.identities,
          list: "watchlist",
          present: payload.present,
        },
        signal ? { signal } : undefined,
      ),
    );
  }
  return enqueueWithAdmissionSignal(() =>
    deps.syncService.enqueueFavoriteMembershipIfEnabled(
      {
        identities: targets.identities,
        present: payload.present,
      },
      signal ? { signal } : undefined,
    ),
  );
}

async function checkListAdmission(
  syncService: SyncService,
  item: {
    readonly titleId: string;
    readonly mediaKind: MediaKind;
    readonly externalIds?: ProviderExternalIds;
  },
  capability: "watchlist" | "favorite",
  signal?: AbortSignal,
): Promise<"allowed" | "disabled" | "aborted"> {
  const trackers: Array<"anilist" | "tmdb"> = ["anilist"];
  if (
    item.mediaKind !== "anime" &&
    !item.titleId.startsWith("anilist:") &&
    !item.externalIds?.anilistId &&
    !item.externalIds?.malId
  ) {
    trackers.push("tmdb");
  }
  for (const tracker of trackers) {
    const admission = await syncService.checkAutomaticAdmission(
      { tracker, capability },
      signal ? { signal } : undefined,
    );
    if (admission !== "disabled") return admission;
  }
  return "disabled";
}

async function enqueueWithAdmissionSignal(
  enqueue: () => Promise<number>,
): Promise<
  | { readonly status: "settled"; readonly queued: number }
  | { readonly status: "retained"; readonly reason: "caller-aborted" }
> {
  try {
    return { status: "settled", queued: await enqueue() };
  } catch (error) {
    if (error instanceof SyncAdmissionAbortedError) {
      return { status: "retained", reason: "caller-aborted" };
    }
    throw error;
  }
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
