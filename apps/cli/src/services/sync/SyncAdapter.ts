import type { TrackerOperation } from "./operations";
import type {
  ConnectionState,
  SyncCapabilities,
  SyncMutationOptions,
  SyncOutcome,
  TrackerId,
} from "./types";

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface SyncConnectOptions {
  readonly signal: AbortSignal;
  /**
   * Where an out-of-band instruction goes — TMDB's "approve in the browser,
   * then continue" step has one. An adapter that writes it to stdout itself
   * paints over the Ink frame, so the surface that owns the screen is handed
   * the text and decides how to show it.
   */
  readonly onPrompt?: (message: string) => void;
}

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
  /**
   * The whole connection, not a username.
   *
   * "Connected" and "the credential has been refused" are different states and
   * need different copy — a boolean plus an optional name cannot say the second
   * one, so surfaces used to render a revoked token as a healthy connection.
   */
  getConnection(): ConnectionState;
  /** Re-read the remote identity. Presentational: failures must not throw. */
  refreshIdentity(options?: SyncMutationOptions): Promise<void>;
  connect(options: SyncConnectOptions): Promise<SyncResult>;
  disconnect(options?: SyncMutationOptions): Promise<void>;
}
