import type { SyncIdentity } from "./types";

/**
 * A tracker operation records *desired state*, never a delta: "progress is 3",
 * "this is on the watchlist". That is what makes redelivery safe — replaying a
 * desired state converges, whereas replaying "toggle favourite" flips it back.
 * The outbox may deliver a row more than once (a response can be lost after the
 * remote applied it), so every operation here must be idempotent by design.
 *
 * `version` is explicit because these rows are persisted in SQLite and re-read
 * by later builds. An unknown version is dead-lettered rather than guessed.
 */
export type TrackerOperationV1 =
  | {
      readonly version: 1;
      readonly kind: "progress:set";
      /** AniList only — TMDB v3 has no episode-progress endpoint. */
      readonly target: Extract<SyncIdentity, { tracker: "anilist" }>;
      readonly progress: number;
      readonly status: "watching" | "completed";
      readonly watchedAt?: string;
    }
  | {
      readonly version: 1;
      readonly kind: "list-membership:set";
      readonly target: SyncIdentity;
      readonly list: "watchlist";
      readonly present: boolean;
    }
  | {
      readonly version: 1;
      readonly kind: "favorite-membership:set";
      readonly target: SyncIdentity;
      readonly present: boolean;
    };

export type TrackerOperation = TrackerOperationV1;

export type TrackerOperationParseResult =
  | { readonly ok: true; readonly operation: TrackerOperation }
  | {
      readonly ok: false;
      readonly code:
        | "payload-not-object"
        | "unsupported-version"
        | "unsupported-kind"
        | "invalid-target"
        | "invalid-progress"
        | "invalid-state";
    };

function fail(code: Extract<TrackerOperationParseResult, { ok: false }>["code"]) {
  return { ok: false, code } as const;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validate a persisted target back into a `SyncIdentity`.
 *
 * The tracker discriminant decides which id field is read, so a TMDB id can
 * never be revived as an AniList id however the row was corrupted.
 */
function parseTarget(value: unknown): SyncIdentity | null {
  if (typeof value !== "object" || value === null) return null;
  const target = value as Record<string, unknown>;
  if (target.tracker === "anilist") {
    if (!isPositiveInteger(target.anilistId) || target.mediaKind !== "anime") return null;
    return { tracker: "anilist", anilistId: target.anilistId, mediaKind: "anime" };
  }
  if (target.tracker === "tmdb") {
    if (!isPositiveInteger(target.tmdbId)) return null;
    if (target.mediaKind !== "movie" && target.mediaKind !== "series") return null;
    return { tracker: "tmdb", tmdbId: target.tmdbId, mediaKind: target.mediaKind };
  }
  return null;
}

/**
 * Parse an untrusted persisted payload.
 *
 * Failure codes are deliberately coarse and carry no payload: they are written
 * to the outbox's diagnostic columns, and a row that failed to parse is exactly
 * the row most likely to contain something that should not be logged.
 */
export function parseTrackerOperation(value: unknown): TrackerOperationParseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("payload-not-object");
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1) return fail("unsupported-version");

  const { kind } = payload;
  if (
    kind !== "progress:set" &&
    kind !== "list-membership:set" &&
    kind !== "favorite-membership:set"
  ) {
    return fail("unsupported-kind");
  }

  const target = parseTarget(payload.target);
  if (!target) return fail("invalid-target");

  if (kind === "progress:set") {
    if (target.tracker !== "anilist") return fail("invalid-target");
    if (!isPositiveInteger(payload.progress)) return fail("invalid-progress");
    if (payload.status !== "watching" && payload.status !== "completed") {
      return fail("invalid-state");
    }
    if (payload.watchedAt !== undefined && typeof payload.watchedAt !== "string") {
      return fail("invalid-state");
    }
    return {
      ok: true,
      operation: {
        version: 1,
        kind,
        target,
        progress: payload.progress,
        status: payload.status,
        ...(payload.watchedAt === undefined ? {} : { watchedAt: payload.watchedAt }),
      },
    };
  }

  if (typeof payload.present !== "boolean") return fail("invalid-state");

  if (kind === "list-membership:set") {
    if (payload.list !== "watchlist") return fail("invalid-state");
    return {
      ok: true,
      operation: { version: 1, kind, target, list: "watchlist", present: payload.present },
    };
  }

  return { ok: true, operation: { version: 1, kind, target, present: payload.present } };
}

/**
 * The outbox's uniqueness key: one pending row per target per operation kind.
 *
 * Media kind is part of the key because TMDB numbers movies and series
 * independently — movie 550 and series 550 are different titles.
 */
export function trackerOperationDedupeKey(operation: TrackerOperation): string {
  const target =
    operation.target.tracker === "tmdb"
      ? `tmdb:${operation.target.mediaKind}:${operation.target.tmdbId}`
      : `anilist:anime:${operation.target.anilistId}`;
  return `${target}|${operation.kind}`;
}

/**
 * Whether `replacement` fully supersedes `current`, so the queued row can be
 * overwritten instead of delivered.
 *
 * True only when both address the same field of the same target: last-write-wins
 * is correct for "progress is 3, no — 4", and silently lossy for anything else.
 */
export function canCoalesceTrackerOperations(
  current: TrackerOperation,
  replacement: TrackerOperation,
): boolean {
  if (trackerOperationDedupeKey(current) !== trackerOperationDedupeKey(replacement)) return false;
  if (current.kind === "list-membership:set" && replacement.kind === "list-membership:set") {
    return current.list === replacement.list;
  }
  return true;
}
