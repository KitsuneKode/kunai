---
status: current
lastReviewed: "2026-09-19"
---

# 0005 — What makes a gate trustworthy

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Status: accepted
Date: 2026-09-19

## Context

Architecture and policy tests in this repo are load-bearing: they enforce the
layering boundary, filename conventions, consent flows, and doc routing. Four
audit passes found that a green gate does not, by itself, prove the gate tests
anything:

- **Two fake gates shipped green.** `filename-convention.test.ts` populated its
  allowlist by walking the same tree it then checked — asserting `A ⊆ A`,
  green under every violation (fixed in #104). The `install.sh` consent test
  never detached the controlling terminal, so it passed in CI only because CI
  has no TTY; the `sudo` consent path it guarded was never exercised (#95).
- **Three gates have holes.** `contract-conformance.test.ts` missed #100, #103,
  and #88. `boundary-imports.test.ts` cannot see the ~5k lines of flat root
  modules (#109). `verify:doc-coverage` checks feature-map routing but not
  command/flag/config coverage (#105).
- **Skips are invisible.** `bun run test` reports `N skip` without naming what
  skipped; the pwsh-gated installer tests land in that count, so a green local
  run says nothing about whether they ran (AGENTS.md hazard #2).

Without a stated bar, the next gate gets written the same way and launders the
same false confidence.

## Decision

Three rules, applied to every architecture/policy test and repo verifier:

1. **A gate ships with evidence of a deliberate red run.** The author breaks
   the thing being guarded on purpose, records the observed failure (in the
   commit message or PR body), then fixes it. A gate that has never been seen
   to fail is not yet a gate — it is a hypothesis. This is cheap: the red run
   happens once, at authoring time, and costs a single intentional break.
2. **Allowlists are static and shrink-only.** A list of permitted exceptions is
   written by a human in the test file, never populated by walking the tree
   under test. Entries may be removed; new entries require a deliberate edit —
   they are never inferred from the system being checked.
3. **Skips must name themselves.** A test runner or gate that can skip work is
   responsible for surfacing _what_ was skipped — the file, the gate that
   skipped it, and why. An aggregate `N skip` count is a hole, not a summary.

## Consequences

- New architecture/policy tests are reviewed against all three rules; citing
  this ADR in review is the expected way to push back on a gate that asserts
  nothing.
- The known holes stay open under their own issues (#105, #109) — this ADR
  records the standard they must meet, it does not close them.
- Skip-surfacing for the pwsh-gated installer tests is a follow-up; the rule
  exists now so the next gated test cannot repeat the pattern.

See [.docs/agents/audit-findings-bar.md](../agents/audit-findings-bar.md) for
the bar a finding must clear before it becomes a gate at all.
