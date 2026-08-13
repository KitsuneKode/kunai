import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";

import {
  DEFAULT_SYNC_CLAIM_LEASE_MS,
  openKunaiDatabase,
  runMigrations,
  SYNC_OUTBOX_RETRY_BASE_MS,
  SYNC_OUTBOX_RETRY_MAX_MS,
  SyncOutboxRepository,
} from "../src/index";
import type { KunaiDatabase } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

const T0 = new Date("2026-08-11T10:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

const progressA = {
  trackerId: "anilist",
  dedupeKey: "anilist:media:1535",
  payload: { kind: "progress", version: 1, episode: 3 },
} as const;

const progressB = {
  trackerId: "anilist",
  dedupeKey: "anilist:media:1535",
  payload: { kind: "progress", version: 1, episode: 4 },
} as const;

const tmdbRating = {
  trackerId: "tmdb",
  dedupeKey: "tmdb:movie:438631",
  payload: { kind: "rating", version: 1, value: 9 },
} as const;

interface RawOutboxRow {
  readonly id: string;
  readonly tracker_id: string;
  readonly dedupe_key: string;
  readonly payload_json: string;
  readonly generation: number;
  readonly claim_token: string | null;
  readonly claimed_at: string | null;
  readonly attempts: number;
  readonly state: string;
  readonly next_attempt_at: string;
  readonly last_error_code: string | null;
  readonly last_error_detail: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function readRow(db: KunaiDatabase, id: string): RawOutboxRow {
  const row = db.query<RawOutboxRow, [string]>("SELECT * FROM sync_outbox WHERE id = ?").get(id);
  if (!row) throw new Error(`sync_outbox row not found: ${id}`);
  return row;
}

function rowCount(db: KunaiDatabase, id: string): number {
  const row = db
    .query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM sync_outbox WHERE id = ?")
    .get(id);
  return row?.total ?? 0;
}

/**
 * Close a handle the way teardown does, so the reopened database sees exactly
 * what a killed process would have left behind on disk.
 */
function simulateProcessExit(db: KunaiDatabase): void {
  Bun.gc(true);
  (db as unknown as { clearQueryCache?: () => void }).clearQueryCache?.();
  db.close(true);
}

test("sync outbox migration creates claim columns, the dedupe constraint, and scan indexes", () => {
  const db = stores.store("sync-outbox-schema");

  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(sync_outbox)")
    .all()
    .map((row) => row.name);

  expect(columns).toContain("generation");
  expect(columns).toContain("claim_token");
  expect(columns).toContain("claimed_at");
  expect(columns).toContain("attempts");
  expect(columns).toContain("state");
  expect(columns).toContain("next_attempt_at");
  expect(columns).toContain("last_error_code");
  expect(columns).toContain("last_error_detail");

  const indexes = db
    .query<{ name: string; unique: number }, []>("PRAGMA index_list(sync_outbox)")
    .all();
  const byName = new Map(indexes.map((index) => [index.name, index.unique]));

  // Due-row scan and expired-claim scan each need their own index.
  expect(byName.has("idx_sync_outbox_due")).toBe(true);
  expect(byName.has("idx_sync_outbox_claimed")).toBe(true);
  expect(byName.get("idx_sync_outbox_tracker_dedupe")).toBe(1);

  const insertDuplicate = (): void => {
    db.query(
      `INSERT INTO sync_outbox (
         id, tracker_id, dedupe_key, payload_json, generation, claim_token, claimed_at,
         attempts, state, next_attempt_at, last_error_code, last_error_detail, created_at, updated_at
       ) VALUES (?, 'anilist', 'anilist:media:1', '{}', 1, NULL, NULL, 0, 'pending', ?, NULL, NULL, ?, ?)`,
    ).run(crypto.randomUUID(), T0.toISOString(), T0.toISOString(), T0.toISOString());
  };

  insertDuplicate();
  expect(insertDuplicate).toThrow();
});

test("enqueue starts at generation 1 and supersedes the payload in place", () => {
  const db = stores.store("sync-outbox-enqueue");
  const repo = new SyncOutboxRepository(db);

  const first = repo.enqueue(progressA, T0);
  expect(first.generation).toBe(1);
  expect(first.state).toBe("pending");
  expect(first.attempts).toBe(0);
  expect(first.payload).toEqual(progressA.payload);
  expect(first.nextAttemptAt).toBe(T0.toISOString());
  expect(first.createdAt).toBe(T0.toISOString());
  expect(first.claimToken).toBeUndefined();
  expect(first.claimedAt).toBeUndefined();

  const [claimed] = repo.claimDue(5, T0);
  expect(claimed).toBeDefined();

  const replacement = repo.enqueue(progressB, at(60_000));
  expect(replacement.id).toBe(first.id);
  expect(replacement.generation).toBe(2);
  expect(replacement.payload).toEqual(progressB.payload);
  expect(replacement.state).toBe("pending");
  expect(replacement.attempts).toBe(0);
  expect(replacement.claimToken).toBeUndefined();
  expect(replacement.claimedAt).toBeUndefined();
  expect(replacement.nextAttemptAt).toBe(at(60_000).toISOString());
  expect(replacement.createdAt).toBe(T0.toISOString());
  expect(replacement.updatedAt).toBe(at(60_000).toISOString());

  const other = repo.enqueue(tmdbRating, at(60_000));
  expect(other.id).not.toBe(first.id);
  expect(other.generation).toBe(1);
  expect(repo.counts().pending).toBe(2);
});

test("claims are exclusive, carry a unique token, and only cover due pending rows", () => {
  const db = stores.store("sync-outbox-claim");
  const repo = new SyncOutboxRepository(db);

  const first = repo.enqueue(progressA, T0);
  const second = repo.enqueue(tmdbRating, at(1_000));

  const batch = repo.claimDue(1, at(2_000));
  expect(batch).toHaveLength(1);
  const claim = batch[0]!;
  expect(claim.id).toBe(first.id);
  expect(claim.state).toBe("claimed");
  expect(claim.claimToken.length).toBeGreaterThan(0);
  expect(claim.claimedAt).toBe(at(2_000).toISOString());
  expect(repo.counts()).toEqual({ pending: 1, claimed: 1, needsReauth: 0, deadLetter: 0 });

  // A second worker sees only the row nobody holds.
  const secondBatch = repo.claimDue(5, at(3_000));
  expect(secondBatch.map((item) => item.id)).toEqual([second.id]);
  expect(secondBatch[0]!.claimToken).not.toBe(claim.claimToken);

  // Nothing is left to claim while both leases are live.
  expect(repo.claimDue(5, at(4_000))).toHaveLength(0);

  // A backed-off row is not due yet.
  expect(repo.retry({ item: claim, errorCode: "network", now: at(4_000) })).toBe("applied");
  expect(repo.claimDue(5, at(4_000))).toHaveLength(0);
});

test("release accepts only the matching generation and token", () => {
  const db = stores.store("sync-outbox-release");
  const repo = new SyncOutboxRepository(db);

  repo.enqueue(progressA, T0);
  const claim = repo.claimDue(1, T0)[0]!;

  expect(release(repo, { ...claim, claimToken: crypto.randomUUID() })).toBe("not-claimed");
  expect(release(repo, { ...claim, generation: claim.generation + 1 })).toBe("not-claimed");
  expect(readRow(db, claim.id).state).toBe("claimed");

  expect(repo.release(claim)).toBe("applied");
  const released = readRow(db, claim.id);
  expect(released.state).toBe("pending");
  expect(released.claim_token).toBeNull();
  expect(released.claimed_at).toBeNull();
  expect(repo.claimDue(1, T0)).toHaveLength(1);
});

test("an expired claim is reclaimed at the lease deadline with a new token", () => {
  const db = stores.store("sync-outbox-lease");
  const repo = new SyncOutboxRepository(db, { claimLeaseMs: 1_000 });

  repo.enqueue(progressA, T0);
  const first = repo.claimDue(1, T0)[0]!;

  expect(repo.claimDue(1, at(999))).toHaveLength(0);

  const reclaimed = repo.claimDue(1, at(1_000));
  expect(reclaimed).toHaveLength(1);
  expect(reclaimed[0]!.id).toBe(first.id);
  expect(reclaimed[0]!.generation).toBe(first.generation);
  expect(reclaimed[0]!.claimToken).not.toBe(first.claimToken);
  expect(reclaimed[0]!.claimedAt).toBe(at(1_000).toISOString());

  // The abandoned worker no longer owns the row.
  expect(repo.complete(first)).toBe("not-claimed");
  expect(rowCount(db, first.id)).toBe(1);
});

test("a stale completion is superseded and never deletes newer intent", () => {
  const db = stores.store("sync-outbox-supersede");
  const repo = new SyncOutboxRepository(db);

  const first = repo.enqueue(progressA, T0);
  const claimed = repo.claimDue(1, T0)[0]!;

  const replacement = repo.enqueue(progressB, at(60_000));
  expect(replacement.generation).toBe(first.generation + 1);

  expect(repo.complete(claimed)).toBe("superseded");
  expect(repo.claimDue(1, at(60_000))).toMatchObject([
    { generation: replacement.generation, payload: progressB.payload },
  ]);
});

test("a reopened database keeps the claim until the lease expires", () => {
  const dir = stores.dir("sync-outbox-crash");
  const first = stores.db(dir);
  const firstRepo = new SyncOutboxRepository(first, { claimLeaseMs: 1_000 });

  const item = firstRepo.enqueue(progressA, T0);
  const claim = firstRepo.claimDue(1, T0)[0]!;
  simulateProcessExit(first);

  const second = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(second, "data");
  const secondRepo = new SyncOutboxRepository(second, { claimLeaseMs: 1_000 });

  expect(secondRepo.counts()).toEqual({ pending: 0, claimed: 1, needsReauth: 0, deadLetter: 0 });
  expect(secondRepo.claimDue(1, at(999))).toHaveLength(0);

  const recovered = secondRepo.claimDue(1, at(1_000));
  expect(recovered).toHaveLength(1);
  expect(recovered[0]!.id).toBe(item.id);
  expect(recovered[0]!.generation).toBe(claim.generation);
  expect(recovered[0]!.claimToken).not.toBe(claim.claimToken);
  expect(recovered[0]!.payload).toEqual(progressA.payload);

  expect(secondRepo.complete(recovered[0]!)).toBe("applied");
  expect(secondRepo.counts()).toEqual({ pending: 0, claimed: 0, needsReauth: 0, deadLetter: 0 });
  simulateProcessExit(second);
});

test("crash recovery never restores an abandoned payload over newer intent", () => {
  const dir = stores.dir("sync-outbox-crash-supersede");
  const first = stores.db(dir);
  const firstRepo = new SyncOutboxRepository(first, { claimLeaseMs: 1_000 });

  firstRepo.enqueue(progressA, T0);
  const abandoned = firstRepo.claimDue(1, T0)[0]!;
  expect(abandoned.generation).toBe(1);
  simulateProcessExit(first);

  const second = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(second, "data");
  const secondRepo = new SyncOutboxRepository(second, { claimLeaseMs: 1_000 });

  const replacement = secondRepo.enqueue(progressB, at(500));
  expect(replacement.generation).toBe(2);

  // The dead process reports success for work the user already replaced.
  expect(secondRepo.complete(abandoned)).toBe("superseded");
  expect(secondRepo.retry({ item: abandoned, errorCode: "network", now: at(600) })).toBe(
    "superseded",
  );
  expect(secondRepo.deadLetter({ item: abandoned, errorCode: "gave-up", now: at(600) })).toBe(
    "superseded",
  );

  const survivor = secondRepo.claimDue(1, at(700))[0]!;
  expect(survivor.generation).toBe(2);
  expect(survivor.payload).toEqual(progressB.payload);
  expect(secondRepo.complete(survivor)).toBe("applied");
  expect(rowCount(second, replacement.id)).toBe(0);
  simulateProcessExit(second);
});

test("retry clears claim ownership and applies bounded exponential backoff", () => {
  const db = stores.store("sync-outbox-backoff");
  const repo = new SyncOutboxRepository(db);

  const item = repo.enqueue(progressA, T0);
  const claim = repo.claimDue(1, T0)[0]!;

  expect(repo.retry({ item: claim, errorCode: "network", errorDetail: "timeout", now: T0 })).toBe(
    "applied",
  );
  const afterFirst = readRow(db, item.id);
  expect(afterFirst.state).toBe("pending");
  expect(afterFirst.claim_token).toBeNull();
  expect(afterFirst.claimed_at).toBeNull();
  expect(afterFirst.last_error_code).toBe("network");
  expect(afterFirst.last_error_detail).toBe("timeout");
  expect(Date.parse(afterFirst.next_attempt_at) - T0.getTime()).toBe(SYNC_OUTBOX_RETRY_BASE_MS);

  const delays: number[] = [SYNC_OUTBOX_RETRY_BASE_MS];
  let cursor = new Date(Date.parse(afterFirst.next_attempt_at));
  for (let index = 0; index < 12; index += 1) {
    const next = repo.claimDue(1, cursor)[0];
    expect(next).toBeDefined();
    expect(repo.retry({ item: next!, errorCode: "network", now: cursor })).toBe("applied");
    const row = readRow(db, item.id);
    delays.push(Date.parse(row.next_attempt_at) - cursor.getTime());
    cursor = new Date(Date.parse(row.next_attempt_at));
  }

  expect(delays[1]).toBe(SYNC_OUTBOX_RETRY_BASE_MS * 2);
  expect(delays[2]).toBe(SYNC_OUTBOX_RETRY_BASE_MS * 4);
  expect(Math.max(...delays)).toBe(SYNC_OUTBOX_RETRY_MAX_MS);
  expect(delays.at(-1)).toBe(SYNC_OUTBOX_RETRY_MAX_MS);
});

test("diagnostics are bounded and never carry payload, bearer, or session values", () => {
  const db = stores.store("sync-outbox-diagnostics");
  const repo = new SyncOutboxRepository(db);

  const secret = "Bearer super-secret-token-9f3a";
  const item = repo.enqueue(
    {
      trackerId: "anilist",
      dedupeKey: "anilist:media:1535",
      payload: { kind: "progress", version: 1, episode: 3, authorization: secret },
    },
    T0,
  );
  const claim = repo.claimDue(1, T0)[0]!;

  expect(
    repo.retry({
      item: claim,
      errorCode: "e".repeat(200),
      errorDetail: "d".repeat(1_000),
      now: T0,
    }),
  ).toBe("applied");

  const row = readRow(db, item.id);
  expect(row.last_error_code).toHaveLength(64);
  expect(row.last_error_detail).toHaveLength(256);
  expect(row.last_error_code).not.toContain(secret);
  expect(row.last_error_detail).not.toContain(secret);
  expect(row.last_error_detail).not.toContain("progress");
  expect(row.payload_json).toContain(secret);
});

test("needs-reauth and dead-letter rows are never claimed or reclaimed", () => {
  const db = stores.store("sync-outbox-terminal");
  const repo = new SyncOutboxRepository(db, { claimLeaseMs: 1_000 });

  const reauth = repo.enqueue(progressA, T0);
  const dead = repo.enqueue(tmdbRating, T0);
  const claims = repo.claimDue(5, T0);
  expect(claims).toHaveLength(2);

  const reauthClaim = claims.find((claim) => claim.id === reauth.id)!;
  const deadClaim = claims.find((claim) => claim.id === dead.id)!;

  expect(repo.requireReauth({ item: reauthClaim, errorCode: "unauthorized", now: at(10) })).toBe(
    "applied",
  );
  expect(repo.deadLetter({ item: deadClaim, errorCode: "permanent", now: at(10) })).toBe("applied");

  const reauthRow = readRow(db, reauth.id);
  expect(reauthRow.state).toBe("needs-reauth");
  expect(reauthRow.claim_token).toBeNull();
  expect(reauthRow.claimed_at).toBeNull();
  const deadRow = readRow(db, dead.id);
  expect(deadRow.state).toBe("dead-letter");
  expect(deadRow.claim_token).toBeNull();
  expect(deadRow.claimed_at).toBeNull();

  // Far past every lease deadline: neither terminal state re-enters delivery.
  expect(repo.claimDue(5, at(3_600_000))).toHaveLength(0);
  expect(repo.counts()).toEqual({ pending: 0, claimed: 0, needsReauth: 1, deadLetter: 1 });
});

test("resetNeedsReauth reopens only the matching tracker without altering generation", () => {
  const db = stores.store("sync-outbox-reset");
  const repo = new SyncOutboxRepository(db);

  const anilist = repo.enqueue(progressA, T0);
  const tmdb = repo.enqueue(tmdbRating, T0);
  for (const claim of repo.claimDue(5, T0)) {
    expect(repo.requireReauth({ item: claim, errorCode: "unauthorized", now: T0 })).toBe("applied");
  }
  const generationBefore = readRow(db, anilist.id).generation;

  expect(repo.resetNeedsReauth("anilist", at(1_000))).toBe(1);

  const reopened = readRow(db, anilist.id);
  expect(reopened.state).toBe("pending");
  expect(reopened.generation).toBe(generationBefore);
  expect(reopened.attempts).toBe(0);
  expect(reopened.last_error_code).toBeNull();
  expect(reopened.next_attempt_at).toBe(at(1_000).toISOString());
  expect(readRow(db, tmdb.id).state).toBe("needs-reauth");

  expect(repo.claimDue(5, at(1_000)).map((claim) => claim.id)).toEqual([anilist.id]);
  expect(repo.resetNeedsReauth("anilist", at(2_000))).toBe(0);
});

test("the default claim lease is five minutes", () => {
  const db = stores.store("sync-outbox-default-lease");
  const repo = new SyncOutboxRepository(db);

  expect(DEFAULT_SYNC_CLAIM_LEASE_MS).toBe(5 * 60 * 1000);

  repo.enqueue(progressA, T0);
  repo.claimDue(1, T0);
  expect(repo.claimDue(1, at(DEFAULT_SYNC_CLAIM_LEASE_MS - 1))).toHaveLength(0);
  expect(repo.claimDue(1, at(DEFAULT_SYNC_CLAIM_LEASE_MS))).toHaveLength(1);
});

function release(
  repo: SyncOutboxRepository,
  item: { readonly id: string; readonly generation: number; readonly claimToken: string },
): string {
  return repo.release(item);
}
