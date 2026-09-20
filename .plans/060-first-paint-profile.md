# Plan 060: Profile first paint before reordering startup

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/main.ts apps/cli/src/infra/diagnostics/ apps/cli/src/app/session/`
> Mismatch → re-read the startup ordering; someone may have deferred work already.

Closes #275 (the measurement half; a fix plan follows the data).

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW — measurement only, no behavior change
- **Depends on:** none — but plan `006-startup-defer-network-and-providers` is
  BLOCKED on a provider/engine registry seam; this profile is the evidence
  that will tell 006 where the real cost is. Do not implement its conclusions
  here.
- **Category:** perf / investigation
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

First paint waits on graphics capability probing, dependency probing,
container creation, and analytics init before anything renders — matching the
reported slow open. But `.docs/` already records that sync `bun:sqlite` work
on the startup path starves awaited dynamic imports, so the obvious suspect
may not be the dominant cost. Reordering on suspicion wastes the effort and
risks the hard guarantees (analytics must stay incapable of self-enabling;
the capability probe must precede the first poster render). Measure first.

## Current state (verified ordering in `main.ts`)

- `:782-783` — `initTerminalGraphicsProbe()` is **awaited** before the shell mounts
- `:1057` — `recordCliStartupMilestone(container.diagnosticsService, "shell-mounted")`
  marks mount; everything above it is pre-render cost
- `:1072` — comment notes an import/render delay
- Instrumentation already exists: `KUNAI_LOOP_MONITOR=1` (logs main-thread
  jams to `./loop-monitor.log`, `main.ts:1239`) and an opt-in heap profiler
  (`infra/diagnostics/heap-profiler.ts`, `main.ts:1244`).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Instrumented cold run | `KUNAI_LOOP_MONITOR=1 <sandboxed-env> bun run dev` | loop-monitor.log written |
| Warm run | same, second launch in same sandbox | comparative numbers |
| Verify no regression risk | `bun run --cwd apps/cli typecheck` | 0 (no code change expected) |

Sandbox rule: use `storageRootEnv`-style isolation (sandboxed HOME/XDG/
APPDATA) for any run that creates config/state — never your live profile.

## Steps

### Step 1: Find the timing harness

Look for existing startup timing: `recordCliStartupMilestone` callsites,
`diagnosticsService` startup trace, the `bun:sqlite` import-blocking note in
`.docs/`. If a milestone/span log already exists, use it — don't build a
second one. If not, the cheapest instrumentation is timestamped
`console.error`-style lines at the named seams (probe start/end, container
start/end, analytics init, first render) behind the existing debug env var —
or a one-off local-only patch you do not commit.

### Step 2: Capture cold + warm profiles

Cold = fresh sandboxed profile dir (first-run path: setup wizard may gate —
use a minimal pre-seeded config to get past it). Warm = second launch. Run
each 3× and take medians. Attribute: graphics probe / dependency probe /
container bootstrap / analytics init / first Ink render.

### Step 3: Write the finding

Record numbers + the attribution table in the issue (or a `.docs/research/`
note if it becomes a reference doc). The output is *which of the four costs
dominates* — that answer decides whether plan 006 unblocks, whether a
different defer wins, or whether the cost is somewhere nobody suspected
(e.g. sqlite import per the `.docs/` warning).

## Test plan

- None — measurement plan. The deliverable is a repeatable measurement
  procedure and its results.

## Done criteria

- [ ] Per-stage startup attribution exists for cold and warm launches
- [ ] Findings recorded on #275 (or `.docs/research/`), citing medians
- [ ] No startup code was reordered — measurement only
- [ ] Plan 006's blocker annotation updated if the data resolves it

## STOP conditions

- `KUNAI_LOOP_MONITOR` output turns out not to exist/be wired — check
  `main.ts:1239` first; if it bit-rotted, fixing the monitor is in scope
  (it's the instrument).
- The sandboxed run can't reach first paint (provider gate, network) — use
  `-y`/youtube lane or a mode that mounts without provider contact.

## Maintenance notes

- Whatever the data says, the two invariants are load-bearing: analytics
  never enables itself, capability probe precedes poster render. Any
  follow-up plan that violates either is a regression, not a win.
