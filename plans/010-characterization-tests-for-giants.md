# Plan 010: Pin the high-churn orchestration giants with characterization tests (prerequisite for splits)

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done. This plan adds tests only —
> it must not change runtime behavior.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/app/playback/PlaybackPhase.ts apps/cli/src/app-shell/workflows/shell-workflows.ts apps/cli/src/app-shell/ink-shell.tsx apps/cli/src/app-shell/root-overlay-shell.tsx`
> Large drift here is fine (behavior may have moved); it just means the characterization tests capture current behavior at HEAD.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW (tests only)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `4b351cb0`, 2026-07-16
- **Blocks**: 011, 012, 013 (do these first)

## Why this matters

The four highest-churn files in the repo — `PlaybackPhase.ts` (3,635 lines, 185 commits/3mo), `shell-workflows.ts` (3,080), `ink-shell.tsx` (2,102, 214 commits), `root-overlay-shell.tsx` (1,945) — carry the most change and the least _direct_ behavioral coverage. `PlaybackPhase` is exercised only by a 187-line test of one private method; `shell-workflows` by a 32-line test of one function; `ink-shell` only by an import-boundary lint. Splitting these files (plans 011–013) with no safety net is how regressions ship. This plan pins current end-to-end behavior with characterization tests so the later refactors can prove they preserved it. It changes no runtime code.

## Current state

- Test harness support already exists: `apps/cli/test/support/` and `apps/cli/test/harness/` (confirm with `ls apps/cli/test/support apps/cli/test/harness`), including container fakes and a render-capture helper (`test/harness/render-capture.ts` per the audit — verify path). Existing good patterns: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`, `apps/cli/test/unit/app-shell/input-router.useinput.test.tsx`, `apps/cli/test/unit/app/mpv-session-lifecycle.test.ts`.
- Runner: `bun run --cwd apps/cli test` (turbo → bun:test). Never `bun test` directly (CLAUDE.md).

## Commands you will need

| Purpose   | Command                                   | Expected |
| --------- | ----------------------------------------- | -------- |
| One file  | `cd apps/cli && bun run test:file <path>` | pass     |
| CLI tests | `bun run --cwd apps/cli test`             | pass     |
| Typecheck | `bun run typecheck`                       | exit 0   |

## Scope

**In scope** (create test files only):

- `apps/cli/test/unit/app/playback/playback-phase-characterization.test.ts`
- `apps/cli/test/unit/app-shell/shell-workflows-characterization.test.ts`
- `apps/cli/test/unit/app-shell/ink-shell-characterization.test.tsx`
- `apps/cli/test/unit/app-shell/root-overlay-characterization.test.tsx`
- Small additions to `apps/cli/test/support/` or `apps/cli/test/harness/` **only if** a reusable fake is missing (prefer reusing what's there).

**Out of scope**:

- Any change to the four source files (this is a characterization pass — behavior must be observed, not altered).
- Extracting logic (that's 011–013).

## Git workflow

- Branch: `advisor/010-characterization-tests`
- Commit: `test(shell,playback): characterize high-churn orchestration before split`

## Steps

### Step 1: Inventory the existing harness

Read `apps/cli/test/support/` and `apps/cli/test/harness/` and one exemplar test each for playback and shell. Identify: how a `Container` fake is built, how the Ink shell is rendered and its frames captured, how input is dispatched, how dispatched events/state are asserted. Write down (in the test file header comments) the seams you'll use. If no render-capture or container fake exists, STOP and report — building that harness from scratch is a separate plan.

**Verify**: you can run one existing shell test: `cd apps/cli && bun run test:file test/unit/app-shell/input-router.useinput.test.tsx` → pass.

### Step 2: Characterize `PlaybackPhase` transitions

Drive the _observable_ behavior, not internals: given a title + episode selection and a fake provider/mpv, assert the sequence of high-level outcomes (resolve → play → post-play), auto-advance decisions (next episode chosen), dead-stream fallback (switches provider), and cancel-before-play (returns to prior surface). Assert on emitted events / returned `PlaybackOutcome` / dispatched state — never on private method names (the existing `playback-phase-events.test.ts` uses reflection casts; do NOT copy that; see plan 012 for extracting that logic). Cover 5–8 whole-flow scenarios.

**Verify**: `cd apps/cli && bun run test:file test/unit/app/playback/playback-phase-characterization.test.ts` → pass.

### Step 3: Characterize `shell-workflows` flows

Pick the workflows most likely to move in a split: provider picker selection, offline-library launch, share-ref build/copy, diagnostics event assembly, queue planning. For each, call the workflow with a fake context and assert the observable result (clipboard content, dispatched command, returned model). 6–10 scenarios.

**Verify**: `cd apps/cli && bun run test:file test/unit/app-shell/shell-workflows-characterization.test.ts` → pass.

### Step 4: Characterize `ink-shell` + `root-overlay-shell` surface behavior

Render the shell with a fake container, dispatch representative keypresses, and assert frames/overlay-stack state: opening/closing an overlay, back-stack (`Esc`) behavior, the transient status row priority (there is already a pure `selectTransientRow` — assert the shell honors it), and that a timer tick updates only the status line region. Assert on captured frame text and overlay-stack model, not component internals. 6–10 scenarios across the two files.

**Verify**: `cd apps/cli && bun run test:file test/unit/app-shell/ink-shell-characterization.test.tsx test/unit/app-shell/root-overlay-characterization.test.tsx` → pass.

### Step 5: Full suite

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → all exit 0, with the new tests included and passing.

## Done criteria

- [ ] `bun run typecheck` exits 0; `bun run --cwd apps/cli test` passes including the 4 new files
- [ ] Each of the four giants has a characterization test asserting ≥5 observable whole-flow behaviors
- [ ] No source file under `apps/cli/src` was modified (`git status` shows only test files, and possibly test/support additions)
- [ ] No test uses private-method reflection casts (grep the new files for `as unknown as` — should be absent or justified)
- [ ] `plans/README.md` row updated; plans 011–013 noted as unblocked

## STOP conditions

- No render-capture / container-fake harness exists and building one is non-trivial — report; that harness is a prerequisite sub-plan.
- A "characterization" test reveals what looks like an actual current bug — record it as a finding and pin the _current_ (buggy) behavior with a `// TODO(regression)` note rather than fixing it here (fixing changes behavior; this plan must not).
- A giant cannot be driven at any level with the existing seams — report which one and why.

## Maintenance notes

- These tests are the contract the splits (011–013) must keep green. A reviewer of any split PR should see these tests unchanged and passing.
- If a characterization test is brittle (asserts incidental formatting), tighten it to the load-bearing behavior before relying on it as a refactor guard.
- Deferred: converting characterization tests into proper unit tests happens naturally as logic is extracted in 011–013.
