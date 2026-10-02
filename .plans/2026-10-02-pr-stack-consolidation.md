# Plan: Unblock the PR stacks so reliability fixes ship

> **Drift check (run first):** `gh pr list --state open --json number,baseRefName,mergeable,reviewDecision` — the table below is a snapshot and goes stale within days. Re-derive it before acting.

## Status

- **Status:** PROPOSED — nothing executed. Planning only.
- **Priority:** P1 (everything the audits fixed is stuck behind this)
- **Effort:** M (mostly rebasing and review, little new code)
- **Risk:** MED — re-stacking can drop a change; verify each replacement PR against its original patch, and the composed replacement stack against the old tip (step 4)
- **Depends on:** none
- **Category:** delivery / process
- **Snapshot:** 2026-10-02, 29 open PRs, `origin/main` unchanged since #338

## Why this matters

The audit fixes (A01–A22) and the PR review's repairs live in open PRs, not in `main`. A user installing today gets none of them. The queue has grown to 29 PRs in two stacks, and the base of each stack is blocked, so nothing above it can merge.

| Stack | Base PR                | State                                    | Depth | Rough size (changed files)                                 |
| ----- | ---------------------- | ---------------------------------------- | ----- | ---------------------------------------------------------- |
| A     | #501                   | CONFLICTING, changes requested           | 6     | #501–#506: about 205 files                                 |
| A'    | #500/#507              | #500 changes requested; #507 CONFLICTING | 2     | #507 alone: 263 files                                      |
| B     | #508                   | CONFLICTING, changes requested           | 17    | #508–#528: about 316 (sum of per-PR counts; files overlap) |
| —     | #499                   | APPROVED but CONFLICTING (3 files)       | 1     | docs only                                                  |
| —     | #255, #287, #306, #327 | old, conflicting or release PR           | 4     | parked / last                                              |

Stack B is 17 deep, and its newest PR (#528) is still being added to the top. A deep stack is a queue with one lane: the fix at the bottom blocks every fix above it, and each rebase re-runs review on everything beneath the change.

## The plan

1. **Stop adding to the tops.** No new PR is based on #528 or #506. New work branches from `main`.
2. **Clear the two blocked bases.** Rebase #508 and #501 onto current `main`, resolve conflicts by reading behaviour (not by picking a side), and answer their changes-requested comments. #499 is approved and 3 files: rebase and merge it first, it is a free win.
3. **Choose one backbone for stack A** exactly as `.plans/2026-10-01-pr-review.md` recommends: #501 → #502 → #503 → #505 → #504 → #506, with #500's gate repairs first. Land bottom-up, one PR per merge, each green standing alone.
4. **Split stack B by risk, not by order.** The reliability and security PRs (#508, #509, #510, #511, #516, #520, #522, #523, #525, #526, #527, #528) are what users need. The refactors (#513, #515, #517, #519: `useCommandPalette`, `useIdleSurface`, `useResultNarrow`, `useBrowseOverlay`) and the mouse-input feature (#521, +1262 lines) sit in the middle of the chain and block the fixes above them. Re-stack them onto `main` as a separate, later stack. Method: partition the changed files by theme and check the partition is complete and disjoint, rebuild each branch with `git checkout <old-tip> -- <paths>` from the final state of its paths, then compare each replacement PR with its original patch. A single replacement branch is not expected to equal the old tip, because the refactors and #521 are deliberately left out of the reliability and security stack. The empty-diff proof applies to the composed result: the replacement branches applied in order must reproduce the old tip, so `git diff <composed-tip> <old-tip>` is empty. Keep the old branches until every re-stacked PR merges.
5. **Then #507's unique residue**, per the review: only the hunks #501–#506 do not already carry.
6. **Close or park deliberately:** #255 (anti-slop wiring), #287 (Android runtime), #306 (Cast) get a written decision, not silence. #327 (version packages) lands last.

## Acceptance

- Open PRs: 8 or fewer, none CONFLICTING, no stack deeper than 3.
- `main` moves at least weekly.
- After each landing: forced per-package typecheck/lint/format and the CLI + providers test suites on the merge commit (not a turbo cache replay).
- Before the release PR: the cumulative gate from `.plans/2026-10-01-execution-runbook.md`.

## Stop conditions

- A rebase changes behaviour of a PR the review marked "no blocking defect": stop and re-review that PR.
- Once the replacement branches are composed, a non-empty `git diff old-tip composed-tip`: stop, the split lost something.
- CI red on a merged base: stop landing, fix forward on `main` first.
