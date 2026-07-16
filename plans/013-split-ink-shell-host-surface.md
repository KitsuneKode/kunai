# Plan 013: Separate host lifecycle from surface rendering in `ink-shell.tsx` (and consolidate overlay mechanisms)

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/app-shell/ink-shell.tsx apps/cli/src/app-shell/root-overlay-shell.tsx`
> These are the highest-churn files; expect drift. Re-read them before extracting.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: 010 (characterization tests green), and best after 008 (timer-state leaves already extracted)
- **Category**: tech-debt
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

`apps/cli/src/app-shell/ink-shell.tsx` (2,102 lines, 214 commits/3mo — the repo's highest-churn file) mixes process/host lifecycle (Ink `render`, exit-handler registration, `markInteractiveShellMounted`, `deleteAllKittyImages` teardown, render diagnostics) with screen rendering, all in one module with 26 root `useState`. `.docs/runtime-boundary-map.md` says it "is still both host and surface code… do not add more policy there." `root-overlay-shell.tsx` (1,945 lines) similarly concentrates a line-editor, provider-picker, favorites, track encoding, and history reconciliation in one overlay surface. The audit also found several competing overlay/picker mechanisms (`root-overlay-shell`, `overlay-panel`, `picker-overlay`, plus `root-workflow-dispatch` vs `command-router`) with no documented winner. Splitting host from surface makes the entry point testable and stops render edits from having to reason about exit handlers.

## Current state

- `ink-shell.tsx:29-45` imports mix host concerns (`registerExitHandler`/`requestHardExit` from graceful-exit, `markInteractiveShellMounted`, `deleteAllKittyImages`, `recordRender` diagnostics, playback telemetry) with rendering.
- 26 `useState` at the root component (grep-verified); timer effects at `:404`, `:619`, `:637`, `:661` (plan 008 addresses the timer-driven ones).
- Overlay mechanisms present: `root-overlay-shell.tsx`, `overlay-panel.tsx`, `picker-overlay.tsx`, `overlay-picker-row.tsx`, `root-overlay-model.ts`, `overlay-back-stack.ts`, `root-workflow-dispatch.ts`, `root-overlay-bridge.ts`, plus `command-router.ts`.

Repo conventions: presentational primitives live under `app-shell/primitives/`; the boundary test (`apps/cli/test/unit/architecture/boundary-imports.test.ts`) enforces app-shell not importing provider/player runtime — keep that green. Conventional commits.

## Commands you will need

| Purpose   | Command                       | Expected                                                            |
| --------- | ----------------------------- | ------------------------------------------------------------------- |
| Typecheck | `bun run typecheck`           | exit 0                                                              |
| Lint      | `bun run lint`                | exit 0                                                              |
| CLI tests | `bun run --cwd apps/cli test` | pass (incl. characterization + boundary)                            |
| Manual    | `bun run dev`                 | shell mounts, overlays open/close, Esc back-stack works, clean exit |

## Scope

**In scope**:

- `apps/cli/src/app-shell/ink-shell.tsx` (extract host)
- New `apps/cli/src/app-shell/shell-host.tsx` (render bootstrap, exit registration, mounted-state, image teardown) and a presentational `shell-surface.tsx` (or keep the surface in `ink-shell.tsx` and pull the host out — whichever is the smaller diff)
- `apps/cli/src/app-shell/root-overlay-shell.tsx` (peel one overlay presenter out as a proof-of-pattern, if budget allows)
- `.docs/ux-architecture.md` (document the canonical overlay mechanism — see Step 5)
- Tests

**Out of scope**:

- Deleting the losing overlay mechanisms in this plan — document the winner and migrate ONE call site as a pattern; a full overlay consolidation is a follow-up.
- The timer-state extraction (plan 008 owns it; if 008 landed, build on it).
- Playback logic (plan 012).

## Git workflow

- Branch: `advisor/013-split-ink-shell`
- Commit per extraction (`refactor(shell): extract ShellHost from ink-shell`, …).

## Steps

### Step 1: Confirm the safety net

**Verify**: `bun run --cwd apps/cli test` → pass, including plan-010 characterization and the boundary-imports test. If plan 010 isn't done, STOP.

### Step 2: Extract `ShellHost`

Move the host lifecycle out of `ink-shell.tsx` into a `ShellHost` module: Ink `render` bootstrap, `registerExitHandler`/`requestHardExit`, `markInteractiveShellMounted`, `deleteAllKittyImages` teardown, and `recordRender` wiring. `ShellHost` mounts the surface component and owns process concerns; the surface becomes a pure(ish) presentational tree fed by props/context. Do it as the smallest diff that cleanly separates the two.

**Verify** after extraction: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass; characterization tests unchanged and green.

### Step 3: Verify clean exit + teardown still work

**Verify**: `bun run dev`, then quit — mpv/download children are killed, Kitty images cleared, terminal restored (no leftover escape sequences). This exercises the host path the split touches.

### Step 4: Peel one overlay presenter (proof of pattern)

From `root-overlay-shell.tsx`, extract one self-contained overlay (e.g. the track-encoding or provider-picker presenter) into its own file, leaving the mega-surface thinner. This demonstrates the split pattern without attempting the whole file.

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → pass; manually open that overlay in `bun run dev`.

### Step 5: Document the canonical overlay mechanism

In `.docs/ux-architecture.md`, add a short section naming which overlay/dispatch stack is canonical (the `root-overlay-*` + `overlay-back-stack` path appears newest — confirm by git recency: `git log -1 --format=%ci` on each candidate file) and mark `overlay-panel`/`picker-overlay` as deprecated-pending-migration. This gives contributors one answer.

**Verify**: the doc names one winner with a one-line rationale.

### Step 6: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] Host lifecycle lives in a `ShellHost` module separate from the surface render tree
- [ ] `ink-shell.tsx` no longer both bootstraps Ink/exit and renders screens (grep shows `render(`/exit-registration moved out)
- [ ] One overlay presenter extracted from `root-overlay-shell.tsx` as the pattern
- [ ] `.docs/ux-architecture.md` names the canonical overlay mechanism
- [ ] Characterization + boundary tests pass unchanged; typecheck/lint exit 0
- [ ] Clean exit verified manually; `plans/README.md` row updated

## STOP conditions

- Plan 010's characterization tests are not green — do not start.
- Extracting the host breaks clean-exit/teardown and you can't restore it — revert and report (terminal-state correctness is non-negotiable per CLAUDE.md).
- The "newest overlay mechanism" is genuinely ambiguous — document the ambiguity and ask the maintainer rather than guessing a winner.

## Maintenance notes

- After this lands, new screens are surface components; new process concerns go in `ShellHost` — never back into a merged mega-file.
- Reviewer: confirm the boundary-imports test still passes (app-shell must not import provider/player runtime) and that clean exit works.
- Deferred: full overlay-mechanism consolidation (migrate all `overlay-panel`/`picker-overlay` call sites onto the canonical stack, then delete the losers) — a dedicated follow-up once the winner is documented here.
