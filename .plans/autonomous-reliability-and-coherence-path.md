# Autonomous Reliability And Coherence Path

Status: Reliability and coherence passes implemented
Created: 2026-05-17

Use this as the completed execution path for the reliability and coherence passes.
It remains useful as a record of the risk split and as the handoff point for the
next architecture sweep.

## Execution Order

### Pass 1: Reliability Core

Plan:

- [.plans/reliability-core-autonomous-sweep.md](./reliability-core-autonomous-sweep.md)

Purpose:

- harden playback, provider, presence, diagnostics, and background async paths
- add deterministic tests around sensitive runtime seams
- keep live provider and Discord checks opt-in

Completion requirements:

- implementation complete on 2026-05-17
- required deterministic verification passes completed
- one commit created for the reliability sweep
- final report includes remaining coherence follow-ups

### Pass 2: Codebase Coherence

Plan:

- [.plans/codebase-coherence-and-redundancy-sweep.md](./codebase-coherence-and-redundancy-sweep.md)

Purpose:

- reconcile README, AGENTS.md, `.docs`, `.plans`, package metadata, and low-risk redundant code with current implementation
- reduce duplicated agent context
- mark stale plans historical or superseded
- produce a durable report of remaining architecture debt

Completion requirements:

- implementation complete on 2026-05-17
- report created at `.plans/codebase-coherence-and-redundancy-report.md`
- required deterministic verification passes completed
- one commit created for the coherence sweep
- final report lists deferred architecture work

## Agent Rules

- Start each pass by checking `git status --short`.
- Preserve unrelated user edits.
- Do not use destructive git commands.
- Prefer `rg` for searches.
- Use `bun run` scripts, not direct `bun test`, for repo checks.
- Do not run live provider or Discord checks unless explicitly requested.
- Commit only the files changed by the current pass.
- After each pass, report the commit hash, tests run, live checks skipped, and next recommended action.

## Recommended Final Decision Point

After both passes, decide whether to start a third architecture sweep. That sweep should be based on the coherence report and should focus on only one high-risk area at a time, such as:

- deeper `PersistentMpvSession` extraction
- provider package migration and capability contracts
- unified trace/event correlation
- shell content-tree convergence
- storage/cache boundary cleanup

Do not start that third sweep automatically.
