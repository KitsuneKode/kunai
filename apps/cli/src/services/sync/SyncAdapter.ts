import type {
  ConnectionState,
  PulledTrackerItem,
  SyncCapabilities,
  SyncOutcome,
  TrackerListItem,
  TrackerProgress,
} from "./types";

export type { SyncOutcome } from "./types";

/**
 * A tracker integration (AniList, TMDB, …).
 *
 * Adapters are deliberately narrow: they translate a `TrackerProgress` into one
 * remote call and report a typed `SyncOutcome`. They own no retry logic and no
 * scheduling — `SyncService` owns the durable outbox and the backoff, so every
 * adapter retries identically and a failure is never silently dropped.
 *
 * Adapters must distinguish *skipped* (this tracker structurally cannot record
 * that write) from *failed* (it should have worked). Reporting a structural
 * limitation as a failure is what made TMDB look permanently broken.
 */
export interface SyncAdapter {
  readonly id: "anilist" | "tmdb";
  readonly displayName: string;
  readonly capabilities: SyncCapabilities;

  /** Load persisted credentials. Never throws; a bad token store means disconnected. */
  init(): Promise<void>;

  /** Verify credentials against the tracker and cache the account identity. */
  refreshIdentity(): Promise<void>;

  getConnection(): ConnectionState;
  isConnected(): boolean;
  getConnectedUsername(): string | undefined;

  /**
   * Run the interactive auth flow. `onPrompt` receives user-facing instructions
   * — adapters must not write to stdout/stdin directly, since the Ink shell owns
   * the terminal and stray writes corrupt the render.
   */
  connect(options: {
    readonly signal: AbortSignal;
    readonly onPrompt: (message: string) => void;
  }): Promise<SyncOutcome>;

  disconnect(): Promise<void>;

  /** Record watch progress. Trackers without episode progress return `skipped`. */
  pushProgress(progress: TrackerProgress): Promise<SyncOutcome>;

  /** Mirror a Kunai list membership upstream. */
  pushListItem?(item: TrackerListItem): Promise<SyncOutcome>;

  /** Read the remote list back so Kunai can reconcile against it. */
  pullList?(options?: { readonly signal?: AbortSignal }): Promise<PulledTrackerItem[]>;
}
