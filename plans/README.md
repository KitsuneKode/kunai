# Production-readiness plans — current board

Last reconciled against `origin/main` on 2026-08-14.

This directory contains numbered external-audit plans that still have verified
residue. Completed, superseded, and one-shot plans live in
[`archive/`](archive/README.md) and carry **no authority**.

This board is separate from [`.plans/roadmap.md`](../.plans/roadmap.md). Code is
the behavior source of truth; a stale plan is a documentation bug.

## Open plans

| Plan | Remaining work                                              | Status                                              |
| ---- | ----------------------------------------------------------- | --------------------------------------------------- |
| 006  | Startup provider loading residue                            | BLOCKED (engine registry is intentionally fixed)    |
| 008  | Download-alert root coupling                                | BLOCKED (other timer/poster slices landed)          |
| 010  | Characterization net for private `AppRoot`                  | BLOCKED (needs a full-container harness)            |
| 011  | Split `shell-workflows.ts`                                  | BLOCKED by 010                                      |
| 012  | Extract `PlaybackPhase` transition core                     | BLOCKED by 010                                      |
| 013  | Split Ink host/surface/overlay winner                       | BLOCKED by 010                                      |
| 014  | Retire remaining baselined layer inversions                 | BLOCKED (boundary ratchet is active)                |
| 015  | Retire legacy flat root modules                             | BLOCKED by 011 and 012                              |
| 021  | Enforce or remove unread provider/relay contracts           | PARTIAL; K-04/K-08 are the release slice            |
| 022  | Destructive confirms, filter capture, errors, Esc semantics | PARTIAL; 022.1 landed                               |
| 023  | CLI surface honesty                                         | TODO; narrow misleading global `--dry-run` for K-16 |
| 030  | Distribution documentation truth                            | TODO after release behavior settles                 |
| 032  | Sync identity and capability truth                          | TODO; execute after the reliability train           |
| 043  | Transactional legacy history-key migration                  | TODO; independent data-migration PR                 |
| 046  | Provider episode routing truth                              | TODO; K-17                                          |
| 047  | Playback/session/queue/one-shot lifecycle                   | TODO; K-06/K-11/K-13                                |

Status values: TODO · PARTIAL · BLOCKED (with reason) · IN PROGRESS.

## K-01–K-17 reconciliation

The local `docs/agents/kunai-audit-handoff.html` is an audit snapshot, not a
current authority. It is deliberately ignored by Git and agent indexes. This
table replaces its status claims.

| Finding | Current status | Evidence / owner                                                                                                                                                       |
| ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-01    | FIXED          | Exact Bun connect strings remain covered by network/TMDB regression tests.                                                                                             |
| K-02    | FIXED          | PR #48 exports every diagnostic category in support bundles.                                                                                                           |
| K-03    | FIXED          | PR #42 preserves sticky offline truth and search failure copy.                                                                                                         |
| K-04    | OPEN           | `providerRelay.videoFallback` persists, but `rewriteStreamUrlForRelay` has no production reader. Remove the unused promise in plan 021; do not add shared video relay. |
| K-05    | FIXED          | PR #46 preserves the working Windows launcher across activation failure.                                                                                               |
| K-06    | OPEN           | `PlaybackPhase` still marks the session playing before `playStream()`; plan 047.                                                                                       |
| K-07    | FIXED          | PR #27 restores playing after progress resumes and rejects stale mpv work.                                                                                             |
| K-08    | OPEN           | Contract conformance still baselines two known orphaned relay contracts; plan 021 with K-04.                                                                           |
| K-09    | FIXED          | PR #45 preserves the last-known-good atomic JSON target on Windows.                                                                                                    |
| K-10    | FIXED          | This reconciliation removes stale top-level TODO/checklist authorities, archives landed plans, and corrects provider/poster docs.                                      |
| K-11    | OPEN           | Catalog auto-next still runs before the real interrupting queue head is consulted; plan 047.                                                                           |
| K-12    | FIXED          | PR #47 adds download claim CAS, state-safe publication, and crash recovery.                                                                                            |
| K-13    | OPEN           | One-shot IPC bootstrap ownership still needs a child-termination regression; plan 047.                                                                                 |
| K-14    | FIXED          | PR #37 gives slow installer suites an explicit reachable timeout budget.                                                                                               |
| K-15    | FIXED          | PR #44 structurally contains recursive staging cleanup.                                                                                                                |
| K-16    | OPEN           | Global help still promises `--dry-run` changes nothing while the reader only guards protocol install/rollback; plan 023.                                               |
| K-17    | OPEN           | AllManga and Miruro still prefer `absoluteEpisode`; plan 046.                                                                                                          |

Current count after this reconciliation: **10 fixed, 7 open**.

## Release-focused train

1. Merge this docs/truth PR after docs, format, and path gates pass.
2. Execute plan 047 as one playback-lifecycle PR (K-06/K-11/K-13).
3. Execute the release-truth slices together only if the diff stays reviewable:
   plan 021 K-04/K-08 removal, plan 023 K-16 narrowing, and plan 046 K-17
   routing. Keep separate commits so any provider change can be reverted alone.
4. Execute plan 043 as its own migration PR.
5. Rebase and re-audit the existing `fix/tracker-sync-correctness` worktree,
   then execute plan 032. Do not merge that stale branch as-is.
6. Run the deterministic release gate, provider signoff, real mpv playback,
   and poster-protocol smokes. Only then merge version PR #31.

The release PR is intentionally last: Changesets will keep updating it while
stability fixes merge, and merging it early would version an incomplete
candidate.

## Archive rule

Move a plan to `archive/` in the same change set that finishes or supersedes its
core. Transfer verified residue to one open row; never leave a landed checklist
active merely because unchecked boxes remain.
