---
status: current
lastReviewed: "2026-09-19"
---

# 0003 — Concurrent-instance state ownership

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Status: accepted
Date: 2026-09-19

## Context

Two audit findings reasoned about what happens when a second `kunai` process
runs alongside the first, and both reached wrong conclusions because nothing
states what concurrent instances may share:

- A claim that concurrent instances trigger a false-positive database
  quarantine and destroy watch history was **disproven empirically** — WAL
  readers do not block writers, and a held `BEGIN IMMEDIATE` write transaction
  measured 0 ms of contention with history intact.
- A claim that version-lock contention lets background cleanup delete a running
  binary was **largely prevented** — `cleanup-versions.ts` carries five layers
  of path protection plus POSIX inode semantics — but it exposed a real gap:
  an instance that fails to acquire the version lock silently runs
  unprotected, and nothing logged it.

Without a stated ownership rule, every concurrent-access finding is
re-litigated from scratch.

## Decision

**A second instance is supported, but degraded** — and the degraded paths are
the ones listed here, not a general "it should be fine". Per-state ownership:

| Shared state                               | Ownership                                                            | On contention                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kunai-data.sqlite` / `kunai-cache.sqlite` | **Safely shared**                                                    | WAL: readers never block writers; writers serialize. Corruption quarantine is keyed on corruption errors, not contention.                                              |
| Version lock (`version-lock.ts`)           | **Must not be shared**                                               | Single-holder by construction. A second instance that fails to acquire runs _unprotected_ — degraded — and now logs that it did (`main.ts` startup).                   |
| mpv IPC sockets                            | **Per-process**                                                      | Crypto-random session ids in private dirs; two instances' players cannot collide.                                                                                      |
| Download queue                             | **Safely shared** (durable) — but `claimedJobIds` is **per-process** | Two instances can claim the same durable job; the in-memory claim set is not shared state. The asymmetry is tracked as #116 — this ADR names it, it does not close it. |
| Sync outbox                                | **Safely shared**                                                    | Rows are transactional inside the SQLite writer contract.                                                                                                              |
| `config.json`                              | **Safely shared, last-writer-wins**                                  | Atomic writes; concurrent writers race but cannot corrupt the file.                                                                                                    |

The version lock is deliberately single-holder: the lock guards the installed
binary's lifetime (cleanup, activation), not the user session. A second
unlocked instance is a supported degradation, not a defect — but it is now
_visible_ (logged at startup) rather than silent.

## Consequences

- Findings about concurrent access are adjudicated against the table above —
  cite the row, not a fresh investigation.
- New shared state gets classified at authoring time: per-process, safely
  shared, or must-not-be-shared, with the contention behavior written down.
- The `claimedJobIds` asymmetry (#116) remains open — a durable queue with a
  per-process claim set is the known gap, not a resolved one.

See [.docs/architecture.md](../architecture.md) for the persistence flow this
state lives under.
