# Plan 011: Break `shell-workflows.ts` into feature-family files

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/app-shell/workflows/`
> If `shell-workflows.ts` changed substantially, re-read it before splitting.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: 010 (characterization tests must be green first)
- **Category**: tech-debt
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

`apps/cli/src/app-shell/workflows/shell-workflows.ts` is 3,080 lines and 149 commits in 3 months — a cross-layer junk drawer. Its imports alone span `node:fs/promises`, offline-library engine construction, share-ref building, diagnostics event assembly, provider-picker selection, queue planning, and clipboard/filesystem writes. The repo's own `.docs/runtime-boundary-map.md` already flags it as a migration bucket that should split into feature-family files — and the split has been _started_ (`history-workflows.ts` 11 lines, `picker-workflows.ts` 241, `setup-workflows.ts` 131 exist) but `shell-workflows.ts` kept absorbing everything. Finishing the split shrinks the blast radius of every shell-flow change and makes the code self-explanatory by feature.

## Current state

`apps/cli/src/app-shell/workflows/` contents:

```
history-workflows.ts    11
picker-workflows.ts    241
playlist-add-workflow.ts 72
playlist-name-prompt.ts  43
setup-workflows.ts     131
shell-workflows.ts    3080   <-- the junk drawer
index.ts                29   <-- barrel
```

`shell-workflows.ts` imports (partial, from `:1-72`) show the mixed responsibilities:

```
@/app/offline/offline-playback-launch          @/domain/offline/OfflineLibraryEngine
@/app/bootstrap/resolve-share-target            @/domain/share/playback-target-ref
@/app/bootstrap/share-ref-from-context          @/infra/clipboard
@/app-shell/diagnostics-panel-source            @/services/diagnostics/IssueReportBuilder
@/app/discover/anime-provider-mapping           @/domain/queue/QueuePlanner
@/domain/continuation/ContinuationEngine        node:fs/promises
```

`index.ts` re-exports the workflow API that `PlaybackPhase.ts` and others import (e.g. `PlaybackPhase.ts:9-13` imports `openTracksPanel, buildPickerActionContext, openSubtitlePicker` from `@/app-shell/workflows`).

Repo conventions: feature-family workflow files already established (`picker-workflows.ts`, `setup-workflows.ts`); consumers import from the `workflows` barrel, not deep paths; conventional commits.

## Commands you will need

| Purpose        | Command                                         | Expected                               |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| Typecheck      | `bun run typecheck`                             | exit 0                                 |
| Lint           | `bun run lint`                                  | exit 0                                 |
| CLI tests      | `bun run --cwd apps/cli test`                   | pass (incl. plan-010 characterization) |
| Find importers | `grep -rn "@/app-shell/workflows" apps/cli/src` | list of consumers                      |

## Scope

**In scope**:

- `apps/cli/src/app-shell/workflows/shell-workflows.ts` (shrink)
- New files: `offline-workflows.ts`, `share-workflows.ts`, `diagnostics-workflows.ts`, `queue-workflows.ts` (create the ones that match the actual clusters you find)
- `apps/cli/src/app-shell/workflows/index.ts` (barrel — keep the public API stable)
- Move any co-located tests accordingly

**Out of scope**:

- Changing any workflow's behavior or signature — this is a move-only refactor. Consumers must not need edits beyond (ideally) nothing, because the barrel keeps exports stable.
- The domain/service modules the workflows call.
- `PlaybackPhase.ts` and other consumers (they import from the barrel).

## Git workflow

- Branch: `advisor/011-split-shell-workflows`
- Commit per family moved (`refactor(shell): extract offline workflows`, `…share workflows`, …) so each is independently revertable.

## Steps

### Step 1: Confirm the safety net is green

**Verify**: `bun run --cwd apps/cli test` → pass, including `shell-workflows-characterization.test.ts` from plan 010. If plan 010 isn't done, STOP.

### Step 2: Map the clusters

Read `shell-workflows.ts` and group its exported functions by feature: offline-library, share, diagnostics, queue, and whatever else. List each function → target file. Keep functions that are genuinely shell-generic (small, used across families) where they are or in a `shell-workflows-common.ts`.

### Step 3: Move one family at a time, barrel-first

For each family: create the new file, move its functions verbatim (adjust relative imports), re-export from `index.ts` so the public API is unchanged, delete the moved code from `shell-workflows.ts`. After each family:

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass. The codebase must be green after every family move (that's why barrel-first).

### Step 4: Confirm consumers untouched

**Verify**: `git diff --name-only` shows changes only under `apps/cli/src/app-shell/workflows/` (and moved tests). If a consumer file changed, you altered the public API — reconcile so the barrel absorbs it.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `shell-workflows.ts` is materially smaller (target: under ~800 lines; the exact number is less important than each remaining function being genuinely shell-generic)
- [ ] New feature-family files exist and hold the moved logic
- [ ] `index.ts` public exports unchanged — no consumer file outside `workflows/` modified
- [ ] `bun run typecheck`, `bun run lint` exit 0; all tests (incl. characterization) pass
- [ ] `plans/README.md` row updated

## STOP conditions

- Plan 010's characterization tests are not green — do not start.
- A function resists clean family assignment because it truly spans concerns — that's a design smell to report, not to force; leave it and note it.
- Moving a family requires changing a consumer's import (public API drift) and you can't keep it stable via the barrel — report.

## Maintenance notes

- New shell workflows go into the matching family file, never back into `shell-workflows.ts`.
- Reviewer: confirm this is move-only (diff should be relocations, not logic changes) and the barrel API is identical.
- This unblocks clearer ownership for the offline/share/diagnostics flows the audit flagged as tangled.
