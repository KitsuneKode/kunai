import type { HistoryProgress } from "@kunai/storage";

import type { SyncCapabilities, TrackerId } from "./types";

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
  isConnected(): boolean;
  getConnectedUsername(): string | undefined;
  ensureConnectedUsername?(): Promise<void>;
  connect(signal: AbortSignal): Promise<SyncResult>;
  disconnect(): Promise<void>;
  pushWatched(entry: HistoryProgress): Promise<SyncResult>;
}
