import type { ReleaseProgressCacheRepository, ReleaseProgressProjection } from "@kunai/storage";

type WriterRepo = Pick<ReleaseProgressCacheRepository, "upsert" | "getByTitleIds">;

/**
 * Single write path for release_progress_cache. Authoritative writes (from
 * ReleaseReconciliationService) always win. Optimistic writes (from the calendar)
 * apply only when there is no row, or the existing row is already stale — so an
 * optimistic "+N new" guess never clobbers a fresh authoritative projection. This
 * resolves the calendar/reconciliation writer race.
 */
export class ReleaseProgressWriter {
  constructor(private readonly repo: WriterRepo) {}

  upsertAuthoritative(projection: ReleaseProgressProjection): void {
    this.repo.upsert(projection);
  }

  upsertOptimistic(projection: ReleaseProgressProjection, now: string): void {
    const existing = this.repo.getByTitleIds([projection.titleId]).get(projection.titleId);
    if (existing && existing.staleAfterAt > now) return; // fresh row wins
    this.repo.upsert(projection);
  }
}
