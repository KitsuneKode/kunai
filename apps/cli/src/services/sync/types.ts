import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export type TrackerId = "anilist" | "tmdb";

/**
 * A tracker-native address. Each variant carries the id in the catalogue that
 * owns it, so a value can never be handed to the wrong tracker: there is no
 * shared `id: number` field to pass along by accident.
 */
export type SyncIdentity =
  | {
      readonly tracker: "anilist";
      readonly anilistId: number;
      readonly mediaKind: "anime";
    }
  | {
      readonly tracker: "tmdb";
      readonly tmdbId: number;
      readonly mediaKind: "movie" | "series";
    };

/** What a Kunai title knows about itself, before any tracker interprets it. */
export interface TrackerIdSource {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
}

/**
 * What a tracker can actually do, as declared by the adapter that implements
 * it. Settings and operation gating read these rather than restating them, so
 * a capability cannot be advertised in one place and unimplemented in another.
 */
export interface SyncCapabilities {
  readonly episodeProgress: boolean;
  readonly watchlistMembership: boolean;
  readonly favoriteMembership: boolean;
  readonly pullLists: boolean;
  readonly rating: boolean;
}

/**
 * Whether a tracker is usable, as three distinct states rather than a boolean.
 * "Connected" and "needs reauth" both hold a username but mean opposite things
 * for delivery, and collapsing them is what makes a queue spin against a token
 * the server has already rejected.
 */
export type ConnectionState =
  | { readonly state: "disconnected" }
  | {
      readonly state: "connected";
      readonly username?: string;
      readonly expiresAt?: string;
    }
  | {
      readonly state: "needs-reauth";
      readonly username?: string;
      readonly reason: string;
    };

export const disconnectedConnection = (): Extract<ConnectionState, { state: "disconnected" }> => ({
  state: "disconnected",
});

export const connectedConnection = (
  username?: string,
  expiresAt?: string,
): Extract<ConnectionState, { state: "connected" }> => ({
  state: "connected",
  ...(username ? { username } : {}),
  ...(expiresAt ? { expiresAt } : {}),
});

export const needsReauthConnection = (
  reason: string,
  username?: string,
): Extract<ConnectionState, { state: "needs-reauth" }> => ({
  state: "needs-reauth",
  reason,
  ...(username ? { username } : {}),
});

export type SyncFailureKind = "network" | "remote" | "mapping" | "invalid";

/**
 * The result of one attempted tracker mutation. The outbox maps this directly
 * onto a row transition, so the shape encodes the decision rather than leaving
 * it to the caller: `retryable` is part of the failure variant, not a flag
 * anyone may set.
 */
export type SyncOutcome =
  | { readonly status: "ok"; readonly detail?: string }
  | { readonly status: "skipped"; readonly reason: string }
  | {
      readonly status: "cancelled";
      readonly reason: "caller-aborted" | "shutdown";
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly kind: "network" | "remote";
      readonly retryable: true;
      readonly detail?: string;
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly kind: "mapping" | "invalid";
      readonly retryable: false;
      readonly detail?: string;
    }
  | {
      readonly status: "needs-reauth";
      readonly code: string;
      readonly detail?: string;
    };

export const syncOk = (detail?: string): SyncOutcome => ({
  status: "ok",
  ...(detail ? { detail } : {}),
});

export const syncSkipped = (reason: string): SyncOutcome => ({ status: "skipped", reason });

export const syncCancelled = (reason: "caller-aborted" | "shutdown"): SyncOutcome => ({
  status: "cancelled",
  reason,
});

/**
 * Only transport-shaped failures retry. A `mapping` or `invalid` result means
 * the payload can never succeed, so retrying it burns attempts and delays every
 * row behind it — those are dead-lettered instead.
 */
export function syncFailed(
  code: string,
  kind: SyncFailureKind,
  detail?: string,
): Extract<SyncOutcome, { status: "failed" }> {
  if (kind === "network" || kind === "remote") {
    return { status: "failed", code, kind, retryable: true, ...(detail ? { detail } : {}) };
  }
  return { status: "failed", code, kind, retryable: false, ...(detail ? { detail } : {}) };
}

export const syncNeedsReauth = (
  code: string,
  detail?: string,
): Extract<SyncOutcome, { status: "needs-reauth" }> => ({
  status: "needs-reauth",
  code,
  ...(detail ? { detail } : {}),
});

/** Every adapter mutation is cancellable; there is no uninterruptible path. */
export type SyncMutationOptions = {
  readonly signal: AbortSignal;
};

/**
 * Connect additionally needs to say things to the user. It reports through
 * `onPrompt` so the Ink shell owns rendering — an adapter writing to stdout
 * corrupts the frame.
 */
export type SyncConnectOptions = SyncMutationOptions & {
  readonly onPrompt: (message: string) => void;
};
