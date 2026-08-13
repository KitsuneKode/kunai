import type { HistoryProgress } from "@kunai/storage";

import type { TrackerOperation } from "./operations";
import type { SyncCapabilities, SyncMutationOptions, SyncOutcome, TrackerId } from "./types";

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface SyncAdapter {
  readonly id: TrackerId;
  readonly displayName: string;
  /**
   * What this adapter actually implements. Callers gate on these rather than
   * hardcoding per-tracker knowledge, so a capability cannot be offered in the
   * UI while no code path delivers it.
   */
  readonly capabilities: SyncCapabilities;
  /**
   * Apply one desired-state operation. Implementations converge on the
   * requested state rather than moving relative to it, because the outbox may
   * redeliver a row whose response was lost after the remote applied it.
   */
  apply(operation: TrackerOperation, options: SyncMutationOptions): Promise<SyncOutcome>;
  isConnected(): boolean;
  getConnectedUsername(): string | undefined;
  ensureConnectedUsername?(): Promise<void>;
  connect(signal: AbortSignal): Promise<SyncResult>;
  disconnect(): Promise<void>;
  pushWatched(entry: HistoryProgress): Promise<SyncResult>;
}
