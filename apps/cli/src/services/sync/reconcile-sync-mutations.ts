import type { CatalogIdentityService } from "@/services/catalog/CatalogIdentityService";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { SyncService } from "@/services/sync/SyncService";
import type {
  HistoryRepository,
  SyncReconciliationRecord,
  SyncReconciliationRepository,
} from "@kunai/storage";

import { resolveMirrorTargets } from "./mirror-targets";

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

/**
 * Project tracker-neutral local mutation facts into consent-gated outbox rows.
 * A row is removed only after projection finishes; an exception leaves it for
 * startup/retry, which is the hard-kill recovery contract.
 */
export async function reconcileSyncMutations(
  deps: SyncReconciliationDeps,
  options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
): Promise<SyncReconciliationSummary> {
  let processed = 0;
  let queued = 0;
  let retained = 0;
  for (const record of deps.syncReconciliationRepository.listPending(options.limit ?? 100)) {
    if (options.signal?.aborted) break;
    try {
      queued += await projectRecord(deps, record, options.signal);
      deps.syncReconciliationRepository.complete(record.id);
      processed += 1;
    } catch (error) {
      retained += 1;
      deps.diagnosticsService?.record({
        category: "sync",
        message: "Local sync reconciliation retained for retry",
        context: {
          kind: record.kind,
          error: error instanceof Error ? error.name : "unknown",
        },
      });
    }
  }
  return { processed, queued, retained };
}

async function projectRecord(
  deps: SyncReconciliationDeps,
  record: SyncReconciliationRecord,
  signal?: AbortSignal,
): Promise<number> {
  const payload = record.payload;
  if (payload.kind === "history") {
    const history = deps.historyRepository.getProgressByKey(payload.historyKey);
    return history ? deps.syncService.enqueueProgressIfEnabled(history) : 0;
  }

  const targets = await resolveMirrorTargets(deps, payload.item, signal ? { signal } : undefined);
  if (payload.list === "watchlist") {
    return deps.syncService.enqueueListMembershipIfEnabled({
      identities: targets.identities,
      list: "watchlist",
      present: payload.present,
    });
  }
  return deps.syncService.enqueueFavoriteMembershipIfEnabled({
    identities: targets.identities,
    present: payload.present,
  });
}
