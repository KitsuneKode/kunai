import type { KunaiDatabase } from "../sqlite";

export type OfflineMaintenanceOperation =
  | "validate-file"
  | "generate-thumbnail"
  | "repair-subtitle"
  | "cache-poster";
export type OfflineMaintenanceStatus = "queued" | "running" | "completed" | "failed";

export interface OfflineMaintenanceJobRecord {
  readonly id: string;
  readonly assetId: string;
  readonly operation: OfflineMaintenanceOperation;
  readonly status: OfflineMaintenanceStatus;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface OfflineMaintenanceJobRow {
  id: string;
  asset_id: string;
  operation: OfflineMaintenanceOperation;
  status: OfflineMaintenanceStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export class OfflineMaintenanceJobsRepository {
  constructor(private readonly db: KunaiDatabase) {}

  enqueueUnique(input: {
    readonly assetId: string;
    readonly operation: OfflineMaintenanceOperation;
    readonly now: string;
  }): OfflineMaintenanceJobRecord {
    const existing = this.getActive(input.assetId, input.operation);
    if (existing) return existing;
    const id = crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO offline_maintenance_jobs (
           id, asset_id, operation, status, error_message, created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', NULL, ?, ?)`,
      )
      .run(id, input.assetId, input.operation, input.now, input.now);
    const created = this.get(id);
    if (!created) throw new Error(`Offline maintenance job not found after enqueue: ${id}`);
    return created;
  }

  get(id: string): OfflineMaintenanceJobRecord | undefined {
    const row = this.db
      .query<OfflineMaintenanceJobRow, [string]>(
        "SELECT * FROM offline_maintenance_jobs WHERE id = ?",
      )
      .get(id);
    return row ? mapMaintenanceRow(row) : undefined;
  }

  getActive(
    assetId: string,
    operation: OfflineMaintenanceOperation,
  ): OfflineMaintenanceJobRecord | undefined {
    const row = this.db
      .query<OfflineMaintenanceJobRow, [string, OfflineMaintenanceOperation]>(
        `SELECT * FROM offline_maintenance_jobs
         WHERE asset_id = ? AND operation = ? AND status IN ('queued', 'running')
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(assetId, operation);
    return row ? mapMaintenanceRow(row) : undefined;
  }

  listRunnable(limit = 20): readonly OfflineMaintenanceJobRecord[] {
    return this.db
      .query<OfflineMaintenanceJobRow, [number]>(
        "SELECT * FROM offline_maintenance_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
      )
      .all(limit)
      .map(mapMaintenanceRow);
  }

  markRunning(id: string, updatedAt: string): void {
    this.setStatus(id, "running", undefined, updatedAt);
  }

  complete(id: string, updatedAt: string): void {
    this.setStatus(id, "completed", undefined, updatedAt);
  }

  fail(id: string, errorMessage: string, updatedAt: string): void {
    this.setStatus(id, "failed", errorMessage, updatedAt);
  }

  private setStatus(
    id: string,
    status: OfflineMaintenanceStatus,
    errorMessage: string | undefined,
    updatedAt: string,
  ): void {
    this.db
      .query(
        "UPDATE offline_maintenance_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, errorMessage ?? null, updatedAt, id);
  }
}

function mapMaintenanceRow(row: OfflineMaintenanceJobRow): OfflineMaintenanceJobRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    operation: row.operation,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
