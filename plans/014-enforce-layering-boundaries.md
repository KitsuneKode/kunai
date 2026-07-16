# Plan 014: Make the documented layer order real and enforce it with a boundary test

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/domain apps/cli/src/infra apps/cli/src/services apps/cli/test/unit/architecture/boundary-imports.test.ts`
> Mismatch → re-verify the inversions below still exist before acting.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (but low-level type moves are easier after 011–013 shrink the shell files)
- **Category**: tech-debt
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

`.docs/runtime-boundary-map.md` documents a layer order — app-shell → app → services → infra/providers/storage → domain/core — but the code inverts it at every layer, so the "layers" don't actually constrain change propagation:

- **domain → app/services**: `apps/cli/src/domain/session/command-registry.ts:1-2` imports `@/app/playback/playback-source-ui` and `@/app/session/mode-switch` (domain is the lowest layer; it should import nothing upward).
- **infra → app**: `apps/cli/src/infra/player/PersistentMpvSession.ts:4` imports `@/app/bootstrap/copy-share-link`.
- **services → app**: `apps/cli/src/services/download/DownloadService.ts:5` imports `@/app/bootstrap/title-info`.
- Plus ~12 app → app-shell edges and others.

The existing boundary test enforces legacy-quarantine and provider seams but **not** intra-app downward-only direction, so these accrete silently. Making the edges point downward (or moving shared types to a low layer) plus a guard test turns the boundary map from aspiration into an enforced invariant — which is what makes the codebase self-explanatory and safe to change.

## Current state

- Boundary test: `apps/cli/test/unit/architecture/boundary-imports.test.ts` — already has the machinery (`collectImports`, per-layer regexes, `describe("runtime boundary imports")` at `:161`, tests for legacy imports, app-shell provider/player bans, Ink-not-in-lower-layers at `:197`, app-phase provider bans at `:213`). It does NOT yet forbid domain/infra/services importing upward.
- Inversions to fix (verify each with `head`/`grep` before changing):
  - `apps/cli/src/domain/session/command-registry.ts:1-2` → `@/app/...`
  - `apps/cli/src/infra/player/PersistentMpvSession.ts:4` → `@/app/bootstrap/copy-share-link`
  - `apps/cli/src/services/download/DownloadService.ts:5` → `@/app/bootstrap/title-info`

Repo conventions: shared types belong in `@/domain/types`, `@kunai/types`, or `@kunai/core`; behavioral upward edges get inverted via callbacks/ports (the DI container already passes dependencies in). Conventional commits.

## Commands you will need

| Purpose           | Command                       | Expected |
| ----------------- | ----------------------------- | -------- |
| Typecheck         | `bun run typecheck`           | exit 0   |
| Lint              | `bun run lint`                | exit 0   |
| CLI tests         | `bun run --cwd apps/cli test` | pass     |
| Find upward edges | see Step 1 grep               | list     |

## Scope

**In scope**:

- `apps/cli/test/unit/architecture/boundary-imports.test.ts` (add downward-only rules)
- The specific inverting files above, plus any others the new test flags: `apps/cli/src/domain/**`, `apps/cli/src/infra/**`, `apps/cli/src/services/**`
- New low-layer type/port modules as needed (`@/domain/types` additions, small port interfaces)

**Out of scope**:

- app → app-shell edges (many, and app-shell is being restructured in 013) — this plan fixes the _lower_ layers (domain/infra/services → app) which are the clearest violations; note app→app-shell as a follow-up.
- Behavior changes — moves and dependency-inversion only.

## Git workflow

- Branch: `advisor/014-enforce-layering`
- Commit per layer fixed (`refactor(domain): remove upward imports from command-registry`, …), then the guard test last.

## Steps

### Step 1: Enumerate the upward edges to fix

Run:

```
grep -rn 'from "@/app/\|from "@/app-shell/\|from "@/services/' apps/cli/src/domain
grep -rn 'from "@/app/\|from "@/app-shell/' apps/cli/src/infra
grep -rn 'from "@/app/\|from "@/app-shell/' apps/cli/src/services
```

List every hit. Classify each as **type-only** (cheap: move the type down to `@/domain/types`/`@kunai/types`) or **behavioral** (invert: pass the function in via the DI container / a port interface, or move the shared logic down).

### Step 2: Fix type-only edges by moving the type down

For each type-only import, relocate the type to a low layer and re-point both the definer and the upward importer. Type moves don't change behavior.

**Verify** after each: `bun run typecheck` → exit 0.

### Step 3: Invert behavioral edges

For each behavioral upward import (e.g. `PersistentMpvSession` importing `copy-share-link`, `DownloadService` importing `title-info`, `command-registry` importing `playback-source-ui`/`mode-switch`): move the shared pure logic to a low layer, OR invert the dependency so the lower layer receives a callback/port from the container instead of reaching up. The DI container (`apps/cli/src/container/*`) is where the wiring goes.

**Verify** after each: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass.

### Step 4: Add the downward-only guard test

Extend `boundary-imports.test.ts` with rules: files under `domain/` must not import `@/app/`, `@/app-shell/`, or `@/services/`; files under `infra/` must not import `@/app/` or `@/app-shell/`; files under `services/` must not import `@/app/` or `@/app-shell/`. Reuse the existing `collectImports` + regex pattern (see the app-shell rules at `:170-219` as the template). The test must pass only once Steps 2–3 are complete.

**Verify**: `cd apps/cli && bun run test:file test/unit/architecture/boundary-imports.test.ts` → pass.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `grep -rn 'from "@/app/\|from "@/app-shell/' apps/cli/src/domain apps/cli/src/infra apps/cli/src/services` returns no behavioral upward imports (type-only moved down)
- [ ] `boundary-imports.test.ts` enforces downward-only for domain/infra/services and passes
- [ ] `bun run typecheck`, `bun run lint` exit 0; all tests pass
- [ ] No behavior changed (existing tests green); `plans/README.md` row updated

## STOP conditions

- An upward edge encodes real shared behavior that has no clean low-layer home — report it as a design question rather than forcing a port that obscures intent.
- Inverting an edge requires touching the DI container in a way that ripples into many call sites — land the type-only fixes + guard test scoped to what's clean, and report the behavioral remainder.
- The new guard test flags dozens of additional files beyond the three named — scope the test to the layers you fully cleaned and note the rest as a follow-up (don't ship a failing test).

## Maintenance notes

- The guard test is the durable win: once green, new upward edges fail CI. Reviewer should confirm it actually fails on a deliberately-added upward import (add one, watch it fail, remove it).
- Follow-up: app → app-shell edges (deferred here) once plan 013 stabilizes the shell layout.
