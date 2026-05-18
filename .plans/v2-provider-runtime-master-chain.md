# Provider Runtime V2 Implementation Chain

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider resolution richer, more deterministic, easier to debug, and less dependent on redundant metadata/network hops without breaking playback.

**Architecture:** This is a chained plan index. Each linked slice must land independently with tests and a small commit. The provider contract expands additively first, then provider-local cycling is centralized, then providers fill evidence into the shared model, and only then do CLI surfaces consume it.

**Tech Stack:** Bun, TypeScript, `@kunai/types`, `@kunai/core`, `@kunai/providers`, `@kunai/storage`, `apps/cli`.

---

## Agent Tracking Header

Update this block as work proceeds. Keep commits scoped to one slice unless a test-only follow-up is needed.

```text
TRACKER_STATUS: planned
TRACKER_OWNER: unassigned
TRACKER_LAST_UPDATED: 2026-05-18
TRACKER_CURRENT_SLICE: P0-plan-hardening
TRACKER_NEXT_SLICE: P1-provider-cycle-types
TRACKER_BLOCKERS: none
```

Status values:

- `planned`: not started
- `in-progress`: actively being implemented
- `blocked`: cannot proceed without user or research input
- `implemented`: code landed and deterministic checks passed
- `deferred`: deliberately moved out of this chain

## Execution Protocol For Delegated Agents

1. Read this file first, then read only the slice plan for the current slice.
2. Update the tracker block in this file and the slice file before code changes.
3. Use test-first where the slice changes behavior.
4. Commit after each slice using the commit message listed in the slice plan.
5. Do not run live provider smoke tests unless explicitly instructed.
6. Do not overwrite unrelated dirty files. Check `git status --short` before staging.
7. Stage only files touched by the current slice.
8. After a slice lands, update the slice status and the `TRACKER_CURRENT_SLICE`.

## Slice IDs

| ID  | Plan                                                                        | Status  | Commit Scope                                           |
| --- | --------------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| P0  | this file + all `.plans/provider-*` hardening docs                          | planned | `docs: harden provider runtime v2 implementation plan` |
| P1  | [Provider Fallback Resolver Engine](./provider-fallback-resolver-engine.md) | planned | types/core only before provider migration              |
| P2  | [Provider Contract V2](./provider-contract-v2.md)                           | planned | additive contracts and schemas                         |
| P3  | [Provider Evidence Fixtures](./provider-evidence-fixtures.md)               | planned | fixture tests, no runtime behavior change              |
| P4  | [Provider UI Projection Contract](./provider-ui-projection-contract.md)     | planned | pure projection types/mapper first                     |
| P5  | [Download Artifact Recovery](./download-artifact-recovery.md)               | planned | storage/service sidecar status                         |
| P6  | [Search Filter State](./search-filter-state.md)                             | planned | search intent/filter domain                            |
| P7  | [Cache and MPV Runtime Policy](./cache-and-mpv-runtime.md)                  | planned | cache identity/diagnostics                             |
| P8  | [Post-Playback Fast Path](./post-playback-fast-path.md)                     | planned | UX latency fix, no provider contract dependency        |
| P9  | [Diagnostics and Debuggability V2](./diagnostics-and-debuggability-v2.md)   | planned | diagnostics export/trace summaries                     |
| P10 | [Docs and Release Gate V2](./docs-and-release-gate-v2.md)                   | planned | docs and plan truth index                              |

## Implementation Order

1. [Provider Fallback Resolver Engine](./provider-fallback-resolver-engine.md)
2. [Provider Contract V2](./provider-contract-v2.md)
3. [Provider Evidence Fixtures](./provider-evidence-fixtures.md)
4. [Provider UI Projection Contract](./provider-ui-projection-contract.md)
5. [Download Artifact Recovery](./download-artifact-recovery.md)
6. [Search Filter State](./search-filter-state.md)
7. [Cache and MPV Runtime Policy](./cache-and-mpv-runtime.md)
8. [Post-Playback Fast Path](./post-playback-fast-path.md)
9. [Diagnostics and Debuggability V2](./diagnostics-and-debuggability-v2.md)
10. [Docs and Release Gate V2](./docs-and-release-gate-v2.md)

## Recommended Execution Batches

### Batch A: Resolver Backbone

- P1 Task 1: cycle types
- P1 Task 2: core cycle engine
- P1 Task 3: core cycle tests

Run after Batch A:

```sh
bun run --cwd packages/types test
bun run --cwd packages/core test
bun run --cwd packages/types typecheck
bun run --cwd packages/core typecheck
```

### Batch B: Evidence And Additive Metadata

- P2: additive contract fields
- P3: provider fixtures

Run after Batch B:

```sh
bun run --cwd packages/types test
bun run --cwd packages/schemas test
bun run --cwd packages/providers test
bun run --cwd packages/providers typecheck
```

### Batch C: UI Projection Boundary

- P4 Task 1: projection types
- P4 Task 2: pure mapper

Run after Batch C:

```sh
bun run --cwd apps/cli test:unit
bun run --cwd apps/cli typecheck
```

### Batch D: First Runtime Migration

- P1 Task 4: AllManga through cycle engine
- P7: cache identity changes that are required by the migration
- P9: trace summaries required to debug the migration

Run after Batch D:

```sh
bun run --cwd packages/providers test
bun run --cwd apps/cli test:unit
bun run --cwd apps/cli build
```

### Batch E: Product Surfaces

- P5: download artifact recovery
- P6: search filter state
- P8: post-playback fast path
- P10: docs and release gate

Run after Batch E:

```sh
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli lint
bun run --cwd apps/cli fmt:check
bun run --cwd apps/cli test:unit
bun run --cwd apps/cli build
```

## Non-Negotiable Constraints

- Preserve user data. Use additive migrations or compatibility readers; do not wipe SQLite or JSON data.
- Preserve provider-native evidence in metadata and diagnostics even when normalized fields are added.
- Normalize languages for logic and cache identity, but do not destroy labels such as source names, server names, or provider aliases.
- Do not increase live provider traffic in CI. Keep live provider checks opt-in.
- Do not globally lengthen stream URL TTLs. Keep stream URLs short-lived; lengthen only stable metadata caches.
- The CLI must keep working when optional polish data is missing.

## Hard Stop Conditions

Stop and report instead of guessing if any of these happen:

- A provider contract change requires deleting or rewriting existing history/cache rows.
- A provider fixture contradicts a provider dossier in a byte-affecting way.
- A language/source field cannot be normalized without losing provider-native evidence.
- A cycle engine migration changes successful stream URLs for an existing fixture without a documented reason.
- A live provider check is needed to prove correctness.
- A UI change requires reading raw provider payloads inside app-shell components.

## Evidence Required Before Contract Changes

For each provider field that becomes first-class, capture:

- endpoint or source of the value
- sample raw payload
- normalized output
- whether the value affects stream bytes, cache identity, UI copy, diagnostics, or only polish
- whether it is stable enough to persist

## Completion Criteria

- `bun run --cwd apps/cli typecheck`
- `bun run --cwd apps/cli lint`
- `bun run --cwd apps/cli fmt:check`
- `bun run --cwd apps/cli test:unit`
- `bun run --cwd apps/cli build`
- Plan truth index updated for any completed or superseded plan items.

## Final Report Template

```text
Completed slices:
- P#: commit <hash>, checks <commands>

Behavior preserved:
- ...

Behavior changed intentionally:
- ...

Deferred / needs user decision:
- ...

Live smoke still needed:
- ...
```
