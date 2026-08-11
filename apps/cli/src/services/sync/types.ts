import type { MediaKind, ProviderExternalIds } from "@kunai/types";

/**
 * Shared sync contracts.
 *
 * The central design rule: an adapter never sees a raw Kunai title id. It
 * receives a `TrackerProgress` whose ids were already resolved for *its own*
 * catalog, so no adapter can reinterpret a foreign id namespace as its own.
 */

export type SyncErrorKind =
  /** Transient transport failure — safe and worth retrying. */
  | "network"
  /** Token expired, revoked, or rejected — retrying without reauth is pointless. */
  | "auth"
  /** No confident id for this tracker — retry only if the id graph improves. */
  | "mapping"
  /** Tracker accepted the request and refused it (validation, rate limit, 5xx). */
  | "remote"
  | "unknown";

export type SyncOutcome =
  | { readonly status: "ok"; readonly detail?: string }
  /** Nothing to do — the tracker cannot represent this write, by design. */
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "failed"; readonly error: string; readonly kind: SyncErrorKind };

export const syncOk = (detail?: string): SyncOutcome => ({
  status: "ok",
  ...(detail ? { detail } : {}),
});
export const syncSkipped = (reason: string): SyncOutcome => ({ status: "skipped", reason });
export const syncFailed = (error: string, kind: SyncErrorKind = "unknown"): SyncOutcome => ({
  status: "failed",
  error,
  kind,
});

/** Watch status vocabulary, normalized across trackers. */
export type TrackerStatus =
  | "planning"
  | "watching"
  | "completed"
  | "paused"
  | "dropped"
  | "repeating";

/**
 * One unit of watch progress, expressed in terms a tracker can act on.
 *
 * `episode` is the tracker-facing episode number. For anime this is the number
 * within the AniList entry, which is not always the local season/episode pair —
 * see `resolveTrackerEpisode`.
 */
export interface TrackerProgress {
  /** Local canonical title id, for logging and dedupe only — never sent upstream. */
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  /** True when this episode (or movie) was watched to the completion threshold. */
  readonly completed: boolean;
  readonly watchedAt?: string;
}

export interface TrackerListItem {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
  readonly listKind: "watchlist" | "favorites";
}

/** A remote list entry pulled back down into Kunai. */
export interface PulledTrackerItem {
  readonly remoteId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  readonly externalIds: ProviderExternalIds;
  readonly status: TrackerStatus;
  readonly progress?: number;
  readonly totalEpisodes?: number;
  readonly score?: number;
  readonly updatedAt?: string;
}

export type ConnectionState =
  | { readonly state: "disconnected" }
  | { readonly state: "connected"; readonly username?: string; readonly expiresAt?: string }
  /** Credentials exist but the tracker rejected them; the user must reconnect. */
  | { readonly state: "needs-reauth"; readonly username?: string; readonly reason: string };

export interface SyncCapabilities {
  /** Tracker can record per-episode watch progress. TMDB cannot. */
  readonly episodeProgress: boolean;
  /** Tracker exposes writable watchlist / plan-to-watch semantics. */
  readonly lists: boolean;
  /** Tracker list state can be read back into Kunai. */
  readonly pull: boolean;
  /** Tracker accepts a user score. */
  readonly rating: boolean;
}
