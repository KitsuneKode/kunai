# `plans/archive/` — completed and superseded numbered plans

Plans whose core landed or whose premise was superseded. Kept because they
record why a change was made and what the executor found, not because they
still describe work to do.

**Do not execute a plan from this folder.** Its drift check is anchored to a
commit that is now far behind, and its "Current state" excerpts describe code
that has since changed.

Archived so far: 001–005, 007, 009, 016–020, 024–029, 031, 033–042,
044–047, plus the old 2026-07-22 handoff.

## Notes worth carrying forward

- **027–029 (publication, fail-closed installers, release evidence)** landed in
  the current release scripts and workflow. Current operator behavior lives in
  `RELEASING.md` and `.docs/release-reliability-gate.md`; plan 030 retains the
  remaining public-doc reconciliation.
- **017 (doc/plan surface cleanup)** is the plan that produced the current
  `.docs/archive/`, `.plans/archive/`, and this folder, plus
  `bun run verify:doc-paths`.

## Rule

A plan moves here when its core landed or its premise became stale. Update the
board and move the file in the same change set. Verified residue becomes one
new open row; unchecked historical task boxes do not keep a plan active.
