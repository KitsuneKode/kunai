import type { KunaiDatabase } from "../sqlite";

/** How long a claim stays the claimer's before another worker may take it back. */
export const DEFAULT_SYNC_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const SYNC_OUTBOX_RETRY_BASE_MS = 30 * 1000;
export const SYNC_OUTBOX_RETRY_MAX_MS = 60 * 60 * 1000;

/** Diagnostics are bounded so a provider error body can never become storage. */
const MAX_ERROR_CODE_LENGTH = 64;
const MAX_ERROR_DETAIL_LENGTH = 256;

export type SyncTrackerId = "anilist" | "tmdb";
export type SyncOutboxState = "pending" | "claimed" | "needs-reauth" | "dead-letter";

export interface SyncOutboxItem {
  readonly id: string;
  readonly trackerId: SyncTrackerId;
  readonly dedupeKey: string;
  readonly payload: unknown;
  readonly generation: number;
  readonly claimToken?: string;
  readonly claimedAt?: string;
  readonly attempts: number;
  readonly state: SyncOutboxState;
  readonly nextAttemptAt: string;
  readonly lastErrorCode?: string;
  readonly lastErrorDetail?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SyncOutboxClaim = SyncOutboxItem & {
  readonly state: "claimed";
  readonly claimToken: string;
  readonly claimedAt: string;
};

export interface SyncOutboxEnqueueInput {
  readonly trackerId: SyncTrackerId;
  readonly dedupeKey: string;
  readonly payload: unknown;
}

/**
 * `applied` — the caller still owned the row and the transition landed.
 * `superseded` — a newer generation replaced the payload; the caller's result
 * describes work the user already overwrote, so it must be discarded.
 * `not-claimed` — same generation, but the lease moved on (expired, released,
 * or already finished elsewhere).
 */
export type SyncOutboxMutationResult = "applied" | "superseded" | "not-claimed";

export type SyncOutboxClaimRef = Pick<SyncOutboxClaim, "id" | "generation" | "claimToken">;

export interface SyncOutboxFailureInput {
  readonly item: SyncOutboxClaimRef;
  readonly errorCode: string;
  readonly errorDetail?: string;
  readonly now?: Date;
}

export interface SyncOutboxCounts {
  readonly pending: number;
  readonly claimed: number;
  readonly needsReauth: number;
  readonly deadLetter: number;
}

interface SyncOutboxRow {
  readonly id: string;
  readonly tracker_id: SyncTrackerId;
  readonly dedupe_key: string;
  readonly payload_json: string;
  readonly generation: number;
  readonly claim_token: string | null;
  readonly claimed_at: string | null;
  readonly attempts: number;
  readonly state: SyncOutboxState;
  readonly next_attempt_at: string;
  readonly last_error_code: string | null;
  readonly last_error_detail: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * The durable hand-off between "the user changed something" and "the tracker
 * agrees". Two failure modes drive the design:
 *
 *  - **Stale success.** A worker claims a payload, the user changes their mind,
 *    and the slow tracker call finally returns. Every terminal mutation is
 *    guarded on `(generation, claim_token, state = 'claimed')`, so the late
 *    completion reports `superseded` instead of deleting the newer intent.
 *  - **Death mid-flight.** A killed process leaves a row `claimed` forever.
 *    `claimDue()` reclaims leases older than `claimLeaseMs` inside the same
 *    transaction that hands out the next batch, keeping the generation and
 *    minting a new token so the dead worker cannot come back and win.
 *
 * `needs-reauth` and `dead-letter` are parked states: they are never due and
 * never reclaimed. Only `resetNeedsReauth()` (after the user reconnects an
 * account) or a fresh `enqueue()` returns them to delivery.
 */
export class SyncOutboxRepository {
  private readonly claimLeaseMs: number;

  constructor(
    private readonly db: KunaiDatabase,
    options: { readonly claimLeaseMs?: number } = {},
  ) {
    this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_SYNC_CLAIM_LEASE_MS;
  }

  /**
   * Record the latest intent for `(trackerId, dedupeKey)`. An existing row is
   * superseded in place: the payload is replaced, the generation advances, and
   * claim ownership, attempts, backoff, and diagnostics all reset. `created_at`
   * survives so the age of the intent stays readable.
   */
  enqueue(input: SyncOutboxEnqueueInput, now = new Date()): SyncOutboxItem {
    const nowIso = now.toISOString();
    const payloadJson = JSON.stringify(input.payload) ?? "null";

    this.db
      .query(
        `INSERT INTO sync_outbox (
           id, tracker_id, dedupe_key, payload_json, generation, claim_token, claimed_at,
           attempts, state, next_attempt_at, last_error_code, last_error_detail, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, NULL, NULL, 0, 'pending', ?, NULL, NULL, ?, ?)
         ON CONFLICT(tracker_id, dedupe_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           generation = sync_outbox.generation + 1,
           claim_token = NULL,
           claimed_at = NULL,
           attempts = 0,
           state = 'pending',
           next_attempt_at = excluded.next_attempt_at,
           last_error_code = NULL,
           last_error_detail = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        crypto.randomUUID(),
        input.trackerId,
        input.dedupeKey,
        payloadJson,
        nowIso,
        nowIso,
        nowIso,
      );

    const stored = this.getByDedupe(input.trackerId, input.dedupeKey);
    if (!stored) {
      throw new Error(
        `Sync outbox row not found after enqueue: ${input.trackerId}/${input.dedupeKey}`,
      );
    }
    return stored;
  }

  /**
   * Reclaim dead leases and hand out the next due batch, in one transaction so
   * no worker can observe a row that is neither claimed nor claimable.
   */
  claimDue(limit: number, now = new Date()): readonly SyncOutboxClaim[] {
    if (limit <= 0) return [];

    const nowIso = now.toISOString();
    const leaseCutoff = new Date(now.getTime() - this.claimLeaseMs).toISOString();

    const claim = this.db.transaction((): readonly SyncOutboxClaim[] => {
      this.db
        .query(
          `UPDATE sync_outbox
           SET state = 'pending', claim_token = NULL, claimed_at = NULL, updated_at = ?
           WHERE state = 'claimed'
             AND claimed_at IS NOT NULL
             AND claimed_at <= ?`,
        )
        .run(nowIso, leaseCutoff);

      const due = this.db
        .query<SyncOutboxRow, [string, number]>(
          `SELECT * FROM sync_outbox
           WHERE state = 'pending'
             AND next_attempt_at <= ?
           ORDER BY next_attempt_at ASC, created_at ASC
           LIMIT ?`,
        )
        .all(nowIso, limit);

      const claimed: SyncOutboxClaim[] = [];
      for (const row of due) {
        const claimToken = crypto.randomUUID();
        const changes = this.db
          .query(
            `UPDATE sync_outbox
             SET state = 'claimed',
                 claim_token = ?,
                 claimed_at = ?,
                 attempts = attempts + 1,
                 updated_at = ?
             WHERE id = ?
               AND generation = ?
               AND state = 'pending'`,
          )
          .run(claimToken, nowIso, nowIso, row.id, row.generation).changes;
        if (changes === 0) continue;

        claimed.push({
          ...mapRow(row),
          state: "claimed",
          claimToken,
          claimedAt: nowIso,
          // `attempts` counts deliveries started, so a crash loop is visible to
          // the caller even though the dead worker never reported a failure.
          attempts: row.attempts + 1,
          updatedAt: nowIso,
        });
      }
      return claimed;
    });

    return claim();
  }

  /** Delivery succeeded: drop the row, unless newer intent replaced it. */
  complete(item: SyncOutboxClaimRef): SyncOutboxMutationResult {
    const changes = this.db
      .query(
        `DELETE FROM sync_outbox
         WHERE id = ?
           AND generation = ?
           AND claim_token = ?
           AND state = 'claimed'`,
      )
      .run(item.id, item.generation, item.claimToken).changes;
    return changes > 0 ? "applied" : this.classifyMiss(item);
  }

  /** Delivery failed but is worth another try: back off and release the lease. */
  retry(input: SyncOutboxFailureInput): SyncOutboxMutationResult {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();

    const apply = this.db.transaction((): SyncOutboxMutationResult => {
      const attempts = this.readOwnedAttempts(input.item) ?? 1;
      const nextAttemptAt = new Date(now.getTime() + backoffMs(attempts)).toISOString();
      return this.transition(
        input.item,
        `state = 'pending',
         claim_token = NULL,
         claimed_at = NULL,
         next_attempt_at = ?,
         last_error_code = ?,
         last_error_detail = ?,
         updated_at = ?`,
        [
          nextAttemptAt,
          clamp(input.errorCode, MAX_ERROR_CODE_LENGTH),
          clampOptional(input.errorDetail, MAX_ERROR_DETAIL_LENGTH),
          nowIso,
        ],
      );
    });

    return apply();
  }

  /** Hand the row back untouched — shutdown, not failure. */
  release(item: SyncOutboxClaimRef, now = new Date()): SyncOutboxMutationResult {
    return this.transition(
      item,
      `state = 'pending',
       claim_token = NULL,
       claimed_at = NULL,
       updated_at = ?`,
      [now.toISOString()],
    );
  }

  /** Park the row until the user reconnects the account. */
  requireReauth(input: SyncOutboxFailureInput): SyncOutboxMutationResult {
    return this.park(input, "needs-reauth");
  }

  /** Park the row permanently; only a fresh enqueue revives it. */
  deadLetter(input: SyncOutboxFailureInput): SyncOutboxMutationResult {
    return this.park(input, "dead-letter");
  }

  counts(): SyncOutboxCounts {
    const rows = this.db
      .query<{ state: SyncOutboxState; total: number }, []>(
        "SELECT state, COUNT(*) AS total FROM sync_outbox GROUP BY state",
      )
      .all();
    const byState = new Map(rows.map((row) => [row.state, row.total]));
    return {
      pending: byState.get("pending") ?? 0,
      claimed: byState.get("claimed") ?? 0,
      needsReauth: byState.get("needs-reauth") ?? 0,
      deadLetter: byState.get("dead-letter") ?? 0,
    };
  }

  /**
   * The user reconnected `trackerId`: make its parked rows deliverable again
   * with a fresh attempt budget. The generation never moves — the intent is
   * unchanged, only the credential that blocked it.
   */
  resetNeedsReauth(trackerId: SyncTrackerId, now = new Date()): number {
    const nowIso = now.toISOString();
    return this.db
      .query(
        `UPDATE sync_outbox
         SET state = 'pending',
             claim_token = NULL,
             claimed_at = NULL,
             attempts = 0,
             next_attempt_at = ?,
             last_error_code = NULL,
             last_error_detail = NULL,
             updated_at = ?
         WHERE tracker_id = ?
           AND state = 'needs-reauth'`,
      )
      .run(nowIso, nowIso, trackerId).changes;
  }

  private park(input: SyncOutboxFailureInput, state: SyncOutboxState): SyncOutboxMutationResult {
    const nowIso = (input.now ?? new Date()).toISOString();
    return this.transition(
      input.item,
      `state = ?,
       claim_token = NULL,
       claimed_at = NULL,
       last_error_code = ?,
       last_error_detail = ?,
       updated_at = ?`,
      [
        state,
        clamp(input.errorCode, MAX_ERROR_CODE_LENGTH),
        clampOptional(input.errorDetail, MAX_ERROR_DETAIL_LENGTH),
        nowIso,
      ],
    );
  }

  /**
   * Every terminal mutation carries the same compare-and-set guard. Anything
   * that changes zero rows is classified by re-reading, never assumed.
   */
  private transition(
    item: SyncOutboxClaimRef,
    assignments: string,
    params: readonly unknown[],
  ): SyncOutboxMutationResult {
    const changes = this.db
      .query(
        `UPDATE sync_outbox
         SET ${assignments}
         WHERE id = ?
           AND generation = ?
           AND claim_token = ?
           AND state = 'claimed'`,
      )
      .run(...(params as never[]), item.id, item.generation, item.claimToken).changes;
    return changes > 0 ? "applied" : this.classifyMiss(item);
  }

  private classifyMiss(item: SyncOutboxClaimRef): SyncOutboxMutationResult {
    const row = this.db
      .query<{ generation: number }, [string]>("SELECT generation FROM sync_outbox WHERE id = ?")
      .get(item.id);
    // A missing row was already completed by whoever owned it last: the caller
    // no longer holds a claim, and nothing newer is waiting to be protected.
    if (!row) return "not-claimed";
    return row.generation > item.generation ? "superseded" : "not-claimed";
  }

  private readOwnedAttempts(item: SyncOutboxClaimRef): number | undefined {
    const row = this.db
      .query<{ attempts: number }, [string, number, string]>(
        `SELECT attempts FROM sync_outbox
         WHERE id = ? AND generation = ? AND claim_token = ? AND state = 'claimed'`,
      )
      .get(item.id, item.generation, item.claimToken);
    return row?.attempts;
  }

  private getByDedupe(trackerId: SyncTrackerId, dedupeKey: string): SyncOutboxItem | undefined {
    const row = this.db
      .query<SyncOutboxRow, [string, string]>(
        "SELECT * FROM sync_outbox WHERE tracker_id = ? AND dedupe_key = ?",
      )
      .get(trackerId, dedupeKey);
    return row ? mapRow(row) : undefined;
  }
}

/** Bounded exponential backoff: 30s, 60s, 120s … capped at one hour. */
function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const scaled = SYNC_OUTBOX_RETRY_BASE_MS * 2 ** Math.min(exponent, 32);
  return Math.min(scaled, SYNC_OUTBOX_RETRY_MAX_MS);
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function clampOptional(value: string | undefined, max: number): string | null {
  return value === undefined ? null : clamp(value, max);
}

function mapRow(row: SyncOutboxRow): SyncOutboxItem {
  return {
    id: row.id,
    trackerId: row.tracker_id,
    dedupeKey: row.dedupe_key,
    payload: JSON.parse(row.payload_json) as unknown,
    generation: row.generation,
    claimToken: row.claim_token ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    attempts: row.attempts,
    state: row.state,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorDetail: row.last_error_detail ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
