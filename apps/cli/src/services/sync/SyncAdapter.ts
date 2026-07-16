import type { HistoryProgress } from "@kunai/storage";

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface SyncAdapter {
  readonly id: string;
  readonly displayName: string;
  isConnected(): boolean;
  getConnectedUsername(): string | undefined;
  ensureConnectedUsername?(): Promise<void>;
  connect(signal: AbortSignal): Promise<SyncResult>;
  disconnect(): Promise<void>;
  pushWatched(entry: HistoryProgress): Promise<SyncResult>;
}
