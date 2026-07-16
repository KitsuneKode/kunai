# Plan 015: Retire the legacy flat modules at `apps/cli/src` root into their proper layers

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/tmdb.ts apps/cli/src/search.ts apps/cli/src/session-flow.ts apps/cli/src/menu.ts apps/cli/src/introdb.ts apps/cli/src/aniskip.ts`
> Mismatch → re-check importers before moving.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: 011 and 012 (soft but real) — re-pointing `tmdb.ts`/`session-flow` importers edits `shell-workflows.ts` (plan 011's file) and `PlaybackPhase.ts` (plan 012's file, including dynamic `import("@/session-flow")` sites at `PlaybackPhase.ts:610/:654/:2843`). Run this plan AFTER 011 and 012 land, never in parallel with them.
- **Category**: tech-debt
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

A stratum of flat modules at `apps/cli/src` root (`tmdb.ts`, `search.ts`, `session-flow.ts`, `menu.ts`, `introdb.ts`, `aniskip.ts`, `subtitle.ts`, `mpv.ts`, `ui.ts`, `logger.ts`) is neither dead nor fully migrated — it's a load-bearing middle layer with **bidirectional coupling** to `services/`. `search.ts` imports `@/services/anime-classifier` and `@/services/catalog` while `services/search/SearchRoutingService.ts` imports `search.ts` — a legacy↔services cycle. `tmdb.ts` imports back into `@/services/catalog/*`. Because these can't be deleted and new work keeps importing them, the "legacy" label is misleading and the layering stays muddy. Folding the single-importer files into their one consumer and migrating `tmdb.ts`/`search.ts` bodies into their `services/` counterparts (breaking the cycle) makes the tree self-explanatory.

## Current state

Import fan-in (from the audit; re-verify with `grep -rn 'from "@/tmdb"' apps/cli/src` etc.):

- `tmdb.ts` — 8 importers incl. `app/playback/PlaybackPhase.ts`, `app-shell/workflows/shell-workflows.ts`, `services/search/definitions/index.ts`; imports back into `@/services/catalog/*` (`tmdb.ts:9-12`).
- `search.ts` — 2 importers; imports `@/services/anime-classifier` + `@/services/catalog`; consumed by `services/search/SearchRoutingService.ts` → **cycle**.
- `session-flow.ts` — 4 importers incl. `PlaybackPhase.ts`, `DownloadOnlyPhase.ts`.
- `subtitle.ts` (6), `logger.ts` (6), `mpv.ts` (5), `ui.ts` (5) — widely used; leave in place unless trivially relocatable.
- `menu.ts`, `introdb.ts`, `aniskip.ts` — **1 importer each** → cheap consolidation targets.

Repo conventions: `@/services/catalog/*` and `@/services/search/*` are the modern homes; conventional commits; the boundary test would ideally forbid new root-flat imports (coordinate with plan 014 if both land).

## Commands you will need

| Purpose        | Command                                   | Expected |
| -------------- | ----------------------------------------- | -------- |
| Typecheck      | `bun run typecheck`                       | exit 0   |
| Lint           | `bun run lint`                            | exit 0   |
| CLI tests      | `bun run --cwd apps/cli test`             | pass     |
| Find importers | `grep -rn 'from "@/<name>"' apps/cli/src` | list     |

## Scope

**In scope**:

- `apps/cli/src/menu.ts`, `introdb.ts`, `aniskip.ts` (fold into their single consumer)
- `apps/cli/src/tmdb.ts`, `apps/cli/src/search.ts` (migrate into `services/catalog` / `services/search`, break the cycle)
- The importers of the above (re-point them)
- Co-located tests

**Out of scope**:

- `mpv.ts`, `logger.ts`, `subtitle.ts`, `ui.ts`, `session-flow.ts` — widely imported; leave them this pass (note as follow-up). Touching `mpv.ts` also collides with plans 002/004 — avoid.
- Behavior changes — move + re-point only.

## Git workflow

- Branch: `advisor/015-retire-legacy-flat-modules`
- Commit per module (`refactor(cli): fold aniskip into its consumer`, `refactor(catalog): absorb tmdb.ts`, …).

## Steps

### Step 1: Fold the single-importer modules

For each of `menu.ts`, `introdb.ts`, `aniskip.ts`: confirm exactly one importer (`grep -rn`), move its contents into that consumer (or into the consumer's local module dir), delete the root file, re-point the import.

**Verify** after each: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass.

### Step 2: Break the `search.ts` ↔ SearchRoutingService cycle

Move `search.ts`'s logic into `services/search/*` (it already imports `@/services/*`, so it belongs there). Update its 2 importers and `SearchRoutingService` so imports flow one direction (services owns it; no re-import of a root file). Confirm no cycle remains (`grep -rn 'from "@/search"' apps/cli/src` → empty; and `services/search/*` doesn't import a root `search.ts`).

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass.

### Step 3: Absorb `tmdb.ts` into `services/catalog`

`tmdb.ts` already imports `@/services/catalog/*`; move its episode-data logic into a `services/catalog/*` module and re-point all 9 importers. This is the largest re-point — do it carefully, one importer at a time if needed, keeping the codebase green.

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass; `grep -rn 'from "@/tmdb"' apps/cli/src` → empty.

### Step 4: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `menu.ts`, `introdb.ts`, `aniskip.ts`, `search.ts`, `tmdb.ts` no longer exist at `apps/cli/src` root
- [ ] No legacy↔services import cycle: `grep -rn 'from "@/search"\|from "@/tmdb"' apps/cli/src` returns nothing
- [ ] `bun run typecheck`, `bun run lint` exit 0; all tests pass; no behavior change
- [ ] `plans/README.md` row updated; remaining root files (`mpv`, `logger`, `subtitle`, `ui`, `session-flow`) noted as follow-up

## STOP conditions

- A "single importer" turns out to have more importers than grep first suggested (dynamic import, re-export) — re-scope before deleting.
- Absorbing `tmdb.ts` reveals it and `services/catalog` have genuinely different responsibilities that shouldn't merge — report; relocate rather than merge.
- Any move changes behavior (a test flips) — that means the move wasn't behavior-neutral; revert and report.

## Maintenance notes

- After this, no new module should be added at `apps/cli/src` root — new code goes in a layer. Consider adding a boundary-test rule (coordinate with plan 014) forbidding new root-flat modules.
- Reviewer: confirm move-only diffs and that the search/tmdb cycles are gone.
- Follow-up: relocate the remaining widely-used root files once their consumers stabilize.
