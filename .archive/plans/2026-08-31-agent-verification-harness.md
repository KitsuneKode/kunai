# Agent verification harness: drive the shell like a human, assert the backend in the same run

> **LANDED.** `test/agent/` carries the L2 driver, the tmux L3 driver, the
> real-mpv tier, and the wiring/onboarding scenarios; `verify-kunai` documents
> the loop. Residue lives on the roadmap row. Note the FileStorage claim below
> is the _pre-fix_ hazard this plan discovered — `FileStorage` now resolves
> `getKunaiPaths()` at call time.

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `./roadmap.md` when done. **v2 (2026-09-22):** revised
> after cross-review — the `script`-transcript Layer B was replaced by a tmux
> driver (`capture-pane` reads the rendered pane, so the real binary _can_ be
> screen-asserted), seeding became first-class, and the evidence bundle +
> DB-diff oracle were added. Layer A adds test code plus one export. The tmux
> layer is Linux/macOS only — gate it like the pwsh installer tests.

## Status

- **Priority**: P2
- **Effort**: M (L2 driver: S. tmux driver: S. Real-mpv tier: S, gated)
- **Risk**: LOW (test code; one 1-line production export; two new env seams)
- **Depends on**: none
- **Blocks**: [010](./010-characterization-tests-for-giants.md) — and through it
  [011](./011-split-shell-workflows.md), [012](./012-decompose-playback-phase.md)
- **Category**: tests

## Why this matters

Plan 010 Step 1 ends with a STOP condition: _"If no render-capture or container
fake exists, STOP and report — building that harness from scratch is a separate
plan."_ Half of what it needs exists (`test/harness/render-capture.ts`), half
does not: nothing in this repo has ever mounted the **root** shell against a
**real** container. That is why 010 sits at `BLOCKED (needs a full-container
harness)` on the roadmap, and why 011 and 012 sit behind it. This plan is the
unblocker — and, with the tmux layer, the start of verification that does what
a user does instead of what a test says.

The failure class it targets is the one `AGENTS.md` calls the house failure
mode: **the silent no-op** — a flag parsed and dropped, a setting persisted and
ignored, a capability declared and never read. Each half works in isolation, so
no unit test can see it. Only a run that presses a key and then reads SQLite can.

**Non-goal, stated to prevent scope creep.** This harness is _not_ the way to
catch pure-function bugs (episode-cursor season:0, Windows reserved filenames,
local-vs-UTC day keys). Those are five-line unit tests. Driving a terminal UI to
reach them is slower, flakier, and trains everyone to distrust a red run. Write
the unit tests; do not route them through here.

## Current state (verified at HEAD, 2026-09-22)

| Piece                                                            | Where                                                          | State                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame capture + keystroke injection at 72/100/140                | `apps/cli/test/harness/render-capture.ts`                      | Done. `render()` returns `stdin.enqueue`, `lastFrame()`, `frames`                                                                                                                               |
| Real container on a throwaway profile                            | `apps/cli/test/integration/helpers/isolated-container.ts`      | Done. `createIsolatedContainer(label)` — label only; driver uses `createIsolatedCliProfile` + `applyStorageRootEnv` (which **returns an undo**)                                                 |
| Cross-platform storage sandbox + undo                            | `apps/cli/test/helpers/storage-env.ts`                         | Done                                                                                                                                                                                            |
| Compiled binary + fake mpv + fixture providers + SQLite readback | `apps/cli/test/integration/helpers/compiled-binary-harness.ts` | Done, except it never types (`stdin: "ignore"`)                                                                                                                                                 |
| **Seeded onboarded profile + fake-mpv shim**                     | `createCompiledSmokeProfile` (same file)                       | Done — writes `onboardingVersion: 2` config, `shimDir/mpv`, evidence path                                                                                                                       |
| Fixture provider modules                                         | `src/app/compiled-smoke/fixture-provider.ts`                   | Done. Loaded by `main.ts:790` via `loadCompiledSmokeProviderOverride` when `KUNAI_COMPILED_SMOKE=1` + `KUNAI_COMPILED_SMOKE_FIXTURE` — **works for `bun src/main.ts` too**, not just the binary |
| Headless scenario runner                                         | `main.ts:810`                                                  | Only when `KUNAI_COMPILED_SMOKE_SCENARIO` is set — leave it unset and the **real TUI** boots with fixture providers                                                                             |
| PTY wrapper (`script`/`expect`)                                  | `apps/cli/test/helpers/pty-command.ts`                         | Launch-only; superseded by tmux for the typing layer                                                                                                                                            |
| Host-poll-free waiting                                           | `apps/cli/test/support/wait-until.ts`                          | Done                                                                                                                                                                                            |
| tmux                                                             | host `3.7c`                                                    | `send-keys` types, `capture-pane -p` reads the **rendered pane** — dissolves the no-echo boundary on Linux/macOS                                                                                |

Three facts that shape the design:

1. **One screen tree.** `openListShell`, `openBrowseShell`, `openStatsShell`
   swap content into the root via `mountRootContent`. Mounting `AppRoot`
   reaches every surface **by typing**, with no per-surface wiring.
2. **Test seams here are env vars, not constructor options.** Extend the
   `compiled-smoke-provider-override.ts` pattern (explicit flag, hard
   validation, throws on malformed, no-op when unset). Two new seams:
   `KUNAI_SMOKE_MEDIA_BASE` (fixture stream origin → local media server, for
   the real-mpv tier) and `KUNAI_REAL_MPV` (tier gate).
3. **`script` transcripts cannot screen-read Ink** (`readme-command-harness.ts`
   records it), **but tmux can** — `capture-pane` reads the pane buffer, not the
   output stream. That is why the v1 `script`-based Layer B is replaced.

## Architecture

Two drivers, one spine. They answer different questions: **L2 asks "is it
wired?"** — a keystroke reaches a reader that writes SQLite. **L3 asks "does it
work for a user?"** — real `main.ts` boot, gates, PTY, alt screen, shutdown.

```
             scenario file  (id, keys[], expectFrame?, expectDelta?)
                   |                    |
        +----------+                    +----------+
        |                                          |
   L2: in-process                          L3: tmux session
   render(<AppRoot container/>)            tmux new-session → bun src/main.ts
   frames  +  DB                           send-keys / capture-pane / DB
        |                                          |
        +----------+  profile-inspector  +---------+
                   (storage paths → history/queue/config/tables/snapshot)
                   |
        createIsolatedCliProfile / applyStorageRootEnv / seeded config
```

|                                                                           | L2 (in-process)              | L3 (tmux)                               |
| ------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- |
| Types keystrokes                                                          | `stdin.enqueue`              | `tmux send-keys`                        |
| Asserts frames                                                            | yes (Ink debug whole-frames) | yes (`capture-pane -p`, real rendering) |
| Asserts SQLite                                                            | yes                          | yes                                     |
| Real `main.ts`, raw mode, alt screen, setup gate, shutdown path, real mpv | **no**                       | yes                                     |
| Speed / platform                                                          | ~1–3s, all OS                | ~3–10s, Linux/macOS only                |

**One scenario format, two driver backends.** A scenario declares
`layers: ["L2"] | ["L3"] | ["L2","L3"]`; wiring regressions default to L2,
user journeys (search→play→history, first-run wizard, quit-and-relaunch) to L3.

### The agent's hands

- `bun run agent:drive -- --keys '/' 'history\r' --show frame,history,queue`
  — **stateless replay** over L2: fresh sandbox, replay keys, print frame +
  backend tables, exit. 1–3s, deterministic; exploration and assertion run the
  same path.
- `bun run agent:session -- start|see|do|inspect|relaunch|report|stop`
  — a **named tmux session** on the real entrypoint. The tmux session _is_ the
  held session: `send-keys` per step, `capture-pane` per read, `kill-session`
  for cleanup. No socket, no daemon to leak.

### Evidence loop (v2 addition)

Every drive run can emit an **evidence bundle**: `transcript.md` (narrated
steps: keys → frame → DB delta), `frames/*.txt`, `db/*.json`. Verification
output is a reviewable QA report, not a bare exit code — and agents that
"verify" must **cite** frame lines and DB rows the bundle actually contains.

**DB-diff oracle**: `inspect().snapshot()` dumps every table in both SQLite
files as canonical row JSON; `expectDelta` asserts the _shape of the change_
("exactly one insert into `history_progress`, nothing else"), catching noisy
writers as well as silent no-ops.

**Universal invariants on every session dispose**: `installId` absent/empty and
`analytics !== "enabled"` in the seeded config — the harness enforces the
analytics contract on itself (hazard 3).

## Isolation contract (non-negotiable)

`applyStorageRootEnv` mutates `process.env` process-wide, and `FileStorage`
bakes its paths at module-load time — env must be set before the dynamic
`import("@/container")`. `root-content-state.ts` holds module-level session
globals.

Therefore: **one agent session per process/file, enforced by a throwing
guard**, and `dispose()` must, in order: unmount Ink → `clearRootContentSession()`
→ close `container.dataDb`/`cacheDb` → run the env undo → delete the profile.
Skipping the undo leaks the sandbox root into the next file in the worker.

**Seeding is first-class.** `seed: "onboarded"` (default) writes
`{ onboardingVersion: ONBOARDING_VERSION, downloadOnboardingDismissed: true,
provider, animeProvider, analytics: "disabled", installId: "" }` — imported
`ONBOARDING_VERSION` so the seed can't drift. `seed: "fresh"` writes nothing:
on a TTY that lands in the setup wizard, which is itself one explicit scenario.
An unseeded L3 run is not "type /history"; it is stuck in setup.

## Scope

**In scope**

- `apps/cli/src/app-shell/ink-shell.tsx` — export `AppRoot` (1 line).
- `apps/cli/src/app/compiled-smoke/fixture-provider.ts` — `KUNAI_SMOKE_MEDIA_BASE`
  remap in `pickUrl` (env only ever set by harness runs).
- `apps/cli/test/agent/profile-inspector.ts` — shared; `openDataDb`/`historyRows`/
  `queueRows` **moved** here, re-exported from `compiled-binary-harness.ts`.
- `apps/cli/test/agent/agent-driver.ts` — L2 session.
- `apps/cli/test/agent/evidence.ts` — bundle writer + privacy invariants.
- `apps/cli/test/agent/scenario.ts` — scenario type + shared runner.
- `apps/cli/test/agent/scenarios/*.ts` — wiring-shaped scenarios.
- `apps/cli/test/agent/drive.ts` + `agent:drive` script — L2 replay CLI.
- `apps/cli/test/agent/tmux-session.ts` + `session-cli.ts` + `agent:session`
  script — L3 driver.
- `apps/cli/test/agent/coverage-map.ts` — advertised-key scraper/prober (spike).
- `apps/cli/test/agent/real-mpv.ts` — `KUNAI_REAL_MPV` tier (Linux/macOS).
- `turbo.json` `agent` task (`cache: false`), `apps/cli/package.json` scripts.
- `.docs/testing-strategy.md` — owns the subject.
- `.agents/skills/verify-kunai/SKILL.md` — cold-agent recipe.

**Out of scope**

- Any change to the four giants (that is 010–012; this plan only unblocks them).
- Replacing VHS tapes. They stay the visual oracle, not a gate.
- Provider, network, relay behavior. Docs-site and relay maps wait until the
  CLI loop is boring.
- A YAML/DSL step language; migrating `queue-playback-lifecycle.test.ts`;
  an in-process held session (replay covers L2; tmux owns "held").

## Steps

### Step 1 — Shared inspector

`profile-inspector.ts`: move `openDataDb`/`historyRows`/`queueRows` from
`compiled-binary-harness.ts` (re-export to keep the smoke compiling). Add
`config()` (config.json), `tables()` (name→count over both DBs via
`sqlite_master`), `snapshot()`/`diffSnapshots()` (canonical-row multiset diff).

**Verify**: `test:binary:smoke`-gated test still skips cleanly without
`KUNAI_BINARY_SMOKE`; `bun run typecheck`.

### Step 2 — `KUNAI_SMOKE_MEDIA_BASE` seam

In `fixture-provider.ts`, remap `https://smoke.kunai.test` → the env base at
`pickUrl` time (validated absolute http(s) URL, no-op when unset). Required for
the real-mpv tier; harmless otherwise — the file only loads under
`KUNAI_COMPILED_SMOKE=1`.

**Verify**: unit test — unset = smoke.kunai.test, set = rewritten origin.

### Step 3 — Export `AppRoot`

One line. `launchSessionApp` keeps the production mount (alt screen,
stdinManager, sixel); the harness mounts the component directly.

**Verify**: `boundary-imports.test.ts` passes.

### Step 4 — L2 driver

`createAgentSession({ label, columns?, seed?, providers? }) →
{ press, waitForFrame, waitSettled, frame, frames, inspect, evidenceDir, dispose }`.

- `createIsolatedCliProfile` + `applyStorageRootEnv` (undo!) → seed config →
  `KUNAI_POSTER=0`, `KUNAI_REDUCED_MOTION=1`, `KUNAI_DISABLE_EXTERNAL_URL=1`,
  smoke env when `providers:"smoke"` → dynamic `import("@/container")` →
  `createContainer({ providerModulesOverride })` → `render(<AppRoot/>)`.
- `waitForFrame`/`waitSettled` use `waitUntil` with an `act()`-wrapped tick —
  never a bare sleep.
- Throwing guard on a second concurrent session; `dispose` per the Isolation
  contract, then privacy invariants.

**Verify**: one scenario presses a key, asserts a frame, asserts a SQLite row —
the first test to do both. Run the file twice in one command for the guard.

### Step 5 — Evidence bundle + `agent:drive`

`evidence.ts` (bundle writer, transcript, privacy invariants) and `drive.ts`
(argv → session → replay `--keys` → print `--show` sections → optional
`--evidence dir`). Key decoding: raw strings; `\r`=Enter, `\x1b`=Esc,
`\x1b[A/B/C/D`=arrows, `\t`=Tab.

**Verify**: drive to a surface by keystroke and read the frame; delete a reader
in `src` and watch frame and table disagree — the disagreement is the point.

### Step 6 — tmux L3 driver

`tmux-session.ts`: `start` (profile via `createCompiledSmokeProfile`-equivalent
for `bun src/main.ts`, `tmux new-session -d -x W -y H`), `see`
(`capture-pane -p`), `do` (`send-keys` + settle-poll), `inspect`, `relaunch`
(`C-c` → wait pane death → respawn same profile), `report`, `stop`.
`session-cli.ts` exposes them as `bun run agent:session -- <cmd>`.
Platform-gated: no tmux → skip line, not a failure.

Settle discipline: poll `capture-pane` until two consecutive identical reads
inside a `waitUntil` budget — a bounded poll, never a fixed sleep. `send-keys`
uses `-l` for literal text and named keys (`Enter`, `Escape`, `Up`, `C-c`) for
control tokens.

**Verify**: boot real `main.ts`, type a command, see it in the pane, read the
SQLite row it wrote; `relaunch` and see the state survive.

### Step 7 — Real-mpv tier (gated)

`KUNAI_REAL_MPV=1` + `Bun.which("mpv")`/`("ffmpeg")` or skip. Shim `mpv` →
`exec <real mpv> --vo=null --ao=null "$@"`; `ffmpeg -f lavfi` mints a 5s
`media.mp4` in the sandbox; `Bun.serve` on an ephemeral port serves it;
`KUNAI_SMOKE_MEDIA_BASE` repoints the fixture stream. Assertions are
two-witnessed: mpv IPC `time-pos` advancing **and** the app's own
`history_progress` write — player says it played, app says it noticed.
Linux/macOS only; CI placement is a main-branch job, not every run.

**Verify**: `agent:session` run with the tier enabled shows `time-pos > 0` and
a history row.

### Step 8 — Three scenarios, wiring-shaped only

Each must be unreachable by a unit test:

1. A settings toggle that persists — frame **and** `config()` changed.
2. Queue enqueue → dequeue — frame and `playlist_queue` both move and reverse.
3. Post-play history — `history_progress` gains the row the frame claims
   (fake-mpv `hold` mode).

**Verify**: each under ~60 lines; each fails if the reader in `src` is deleted.
Then the coverage-map spike: scrape advertised keys from the root frame, press
each in a replayed session, record frame+DB delta per key — output
`coverage.json` and a curated `expected-quiet` list. If the quiet list is long,
the fuzzer stays a tool, not a gate.

### Step 9 — Wire and document

`turbo.json` `agent` task (`"cache": false, "outputs": []`). `test:agent`
script. `.docs/testing-strategy.md` section. `.agents/skills/verify-kunai/
SKILL.md` — Launch/Doctor/Drive/Evidence/Cleanup for a cold agent, written
against `agent:drive` + `agent:session`, screaming `storageRootEnv`/seed rules.
Roadmap: 010 off BLOCKED; residue row for the coverage gate + real-mpv CI job.

**Verify**: `bun run typecheck`, `lint`, `fmt`, `verify:doc-paths`, and
`bun run --cwd apps/cli test:agent` — re-run with `--force`, read the skip line.

## Risks

| Risk                                               | Mitigation                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| tmux absent / Windows                              | Platform gate; L2 carries the wiring suite everywhere                                                       |
| Layer B flakiness from real async                  | Settle predicates via `waitUntil`; evidence bundle makes failures debuggable                                |
| Cross-file env/global leaks                        | Throwing guard + undo + `clearRootContentSession` on dispose                                                |
| Deferred DB writes read as absent                  | `waitForFrame` on the completion frame first; inspector reads post-commit                                   |
| Harness accrues logic tests                        | Non-goal stated; Step 8 requires unit-unreachability                                                        |
| `analyticsDisclosurePending` timer pollutes frames | Seeded `analytics:"disabled"` keeps the flag false; flag itself is settable for the one disclosure scenario |
| A test seam becomes a production backdoor          | Both new seams follow `compiled-smoke-provider-override.ts`: explicit, validated, no-op unset               |
| Coverage fuzzer false positives                    | Spike + curated `expected-quiet`; gate only if the list stays short                                         |

## Definition of done

- 010's Step 1 STOP condition no longer applies; the roadmap row moves off BLOCKED.
- A single L2 run presses keys and asserts both frame and SQLite.
- An L3 run drives real `main.ts` under tmux — types, reads the pane, asserts
  the DB, and survives `relaunch`.
- One inspector, one scenario format, one sandbox helper — no second copy of any.
- `bun run agent:drive` reaches any surface by keystroke and prints frame +
  backend side by side; `bun run agent:session` holds a real session an agent
  can explore incrementally.
- Every session disposes under the privacy invariants: no `installId`, no
  enabled analytics.
