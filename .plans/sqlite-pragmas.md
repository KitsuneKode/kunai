# SQLite pragmas — `synchronous = NORMAL` (the one left)

Status: TODO — written for audit-4 follow-up. Small change; needs a benchmark
note so the trade-off is chosen, not defaulted.

## Current state (verified, `packages/storage/src/sqlite.ts:55-86`)

`openKunaiDatabase` already sets, for writable handles:

- `PRAGMA foreign_keys = ON` (line 67)
- `PRAGMA busy_timeout = <opts.busyTimeoutMs ?? 5000>` (line 68)
- `PRAGMA journal_mode = WAL` unless `wal === false` (line 71)

`kunai-data.sqlite` (data dir) and `kunai-cache.sqlite` (cache dir) both go
through this opener. What is missing: **`PRAGMA synchronous`** — SQLite's WAL
default is `FULL` (fsync every commit), which is the safest and slowest setting.

## Scope

1. Add `PRAGMA synchronous = NORMAL` for both databases — in WAL mode NORMAL
   still checkpoints safely; a crash can lose the last transactions, never
   corrupt the database. For the cache DB that is free; for the data DB it
   means at most losing the last committed watch-history write on a power
   failure — the same durability level most SQLite apps ship.
2. Keep it behind the opener (`options.synchronous`?) so tests and the
   corruption-recovery path can opt back to FULL.
3. **Benchmark note required** — measure history append + cache write latency
   before/after on a rotational-disk profile if available (otherwise state the
   environment honestly); the win is commit latency under contention, not
   throughput. Write the numbers into the PR/commit that flips it.
4. If the data DB's write classes turn out to matter (history claims, queue
   CAS), consider per-database policy: NORMAL for cache, FULL for data — that
   is a valid conclusion of the benchmark, not a failure.

## Evidence

- `packages/storage/src/sqlite.ts:66-75` — pragma block; no `synchronous`.
- grep: no `synchronous` pragma anywhere under `packages/storage/src`.
