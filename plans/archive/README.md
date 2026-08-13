# `plans/archive/` — completed numbered plans

Plans whose status board row reached **DONE**. Kept because they record why a
change was made and what the executor found, not because they still describe
work to do.

**Do not execute a plan from this folder.** Its drift check is anchored to a
commit that is now far behind, and its "Current state" excerpts describe code
that has since changed.

Archived so far: 001–005, 007, 009, 017, 018, 019, 020, 024, 026, 039–042, 044, 045.

## Notes worth carrying forward

- **024 (distribution and update experience)** landed, but plans 026–030 were
  written from a later audit and supersede its implementation assumptions.
  Read 026+ for the current distribution contract, not 024.
- **017 (doc/plan surface cleanup)** is the plan that produced the current
  `.docs/archive/`, `.plans/archive/`, and this folder, plus
  `bun run verify:doc-paths`.

## Rule

A plan moves here when its row in [`../README.md`](../README.md) reads DONE.
Update the row and move the file in the same change set. Anything still TODO,
PARTIAL, IN PROGRESS, or BLOCKED stays in `plans/`.
