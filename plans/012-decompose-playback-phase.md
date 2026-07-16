# Plan 012: Extract a pure transition core and orchestration slices out of `PlaybackPhase.ts`

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/app/playback/`
> If `PlaybackPhase.ts` changed substantially, re-read it before extracting.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: 010 (characterization tests green first)
- **Category**: tech-debt
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

`apps/cli/src/app/playback/PlaybackPhase.ts` is 3,635 lines and 185 commits/3mo — the single most safety-critical file (playback is the product's core path) fuses the playback state machine with at least eight orchestration responsibilities: prefetch, mpv session lifecycle, dead-stream ledger, provider fallback/switch, resume-from-history, post-play menu, catalog/playlist auto-advance, and navigation. The repo's `.docs/runtime-boundary-map.md` says it "is still the playback state machine plus too much surrounding orchestration. Extract only tested transition slices from it." This plan does exactly that: pull out a pure transition core and the already-sibling-shaped orchestration helpers, so the file becomes readable and each concern is testable.

## Current state

`PlaybackPhase.ts` already _delegates_ to many sibling modules (its import block `:8-60` references `episode-prefetch`, `mpv-playback-event-copy`, `mpv-session-lifecycle`, `playback-catalog-autoadvance`, `playback-dead-stream-ledger`, `playback-episode-navigation`, `playback-provider-fallback`, `playback-post-play-*`, etc.). The problem is the remaining in-file glue: the big loop that sequences these, plus event→copy mapping still reachable only by reflection in the current test.

Notably, `apps/cli/test/unit/app/playback-phase-events.test.ts` reaches `describePlayerEvent` via `phase as unknown as { describePlayerEvent: … }` reflection casts — a symptom that pure logic is trapped inside the class.

Repo conventions: pure policy/helper modules live beside `PlaybackPhase` under `app/playback/*` (e.g. `playback-postplay-policy.ts`, `mpv-playback-event-copy.ts`) and are unit-tested directly; conventional commits.

## Commands you will need

| Purpose   | Command                                   | Expected                      |
| --------- | ----------------------------------------- | ----------------------------- |
| Typecheck | `bun run typecheck`                       | exit 0                        |
| Lint      | `bun run lint`                            | exit 0                        |
| CLI tests | `bun run --cwd apps/cli test`             | pass (incl. characterization) |
| One file  | `cd apps/cli && bun run test:file <path>` | pass                          |

## Scope

**In scope**:

- `apps/cli/src/app/playback/PlaybackPhase.ts` (shrink)
- New pure modules under `apps/cli/src/app/playback/` (e.g. `playback-transition.ts` for the intent→next-state reducer; move any remaining in-file pure logic like the event-copy mapping into its existing sibling if one exists, or a new `player-event-copy.ts`)
- `apps/cli/test/unit/app/playback/*` (new direct unit tests for extracted pure modules)
- `apps/cli/test/unit/app/playback-phase-events.test.ts` (rewrite to test the extracted pure function directly, dropping reflection casts)

**Out of scope**:

- The already-extracted sibling modules' internals (reuse them).
- Behavior changes — this is extraction; the characterization tests (plan 010) must stay green unchanged.
- mpv/provider/service layers.

## Git workflow

- Branch: `advisor/012-decompose-playback-phase`
- Commit per extraction (`refactor(playback): extract transition reducer`, `refactor(playback): move player-event copy to a pure module`, …).

## Steps

### Step 1: Confirm the safety net

**Verify**: `bun run --cwd apps/cli test` → pass, including `playback-phase-characterization.test.ts`. If plan 010 isn't done, STOP.

### Step 2: Extract the event-copy pure function (kills the reflection test)

Move `describePlayerEvent` (and the stream-slow copy logic the current test also reaches) out of the class into a pure module. Update `playback-phase-events.test.ts` to import and test that function directly. Delete the `as unknown as` casts.

**Verify**: `cd apps/cli && bun run test:file test/unit/app/playback-phase-events.test.ts` → pass, no reflection casts (`grep -n "as unknown as" apps/cli/test/unit/app/playback-phase-events.test.ts` → empty).

### Step 3: Extract a pure transition core

Identify the state-machine decisions currently inline in the big loop (what to do given an outcome: play next, fall back, resume, go to post-play, return to search). Extract them into a pure `playback-transition.ts` that takes the current state + an event/intent and returns the next action, with no I/O. The class keeps the effectful shell (call mpv, call resolve) but asks the reducer _what_ to do. Extract in small slices, each with a direct unit test.

**Verify** after each slice: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass (characterization stays green — proves behavior preserved).

### Step 4: Peel orchestration into coordinators (optional within this plan's budget)

If budget remains, move the prefetch-sequencing and fallback-controller glue into small coordinator modules the class composes. Only do this for slices you can cover with a direct test. If time-boxed, stop after Step 3 and note the remainder as deferred — do NOT leave a half-extracted coordinator.

**Verify**: `bun run --cwd apps/cli test` → pass.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `describePlayerEvent`/event-copy logic is a pure module tested directly; no reflection casts remain in its test
- [ ] A pure `playback-transition` module exists with direct unit tests
- [ ] `PlaybackPhase.ts` is smaller (target: a meaningful reduction, e.g. under ~2,500 lines; exact number secondary to the pure core existing)
- [ ] Characterization tests (plan 010) pass unchanged — behavior preserved
- [ ] `bun run typecheck`, `bun run lint` exit 0; all tests pass
- [ ] `plans/README.md` row updated

## STOP conditions

- Plan 010's characterization tests are not green — do not start.
- An extraction changes a characterization test's result — you altered behavior; revert that slice and report.
- The transition logic is too entangled with effects to extract purely — extract what you can, report the rest; do not force a leaky "pure" module that still does I/O.

## Maintenance notes

- New playback decisions go through the pure transition core, tested directly — not as new inline branches in the class.
- Reviewer: characterization tests unchanged + green is the acceptance signal; scrutinize any slice where they had to change.
- Deferred coordinators (prefetch, fallback) can be follow-up plans once the transition core is in place.
