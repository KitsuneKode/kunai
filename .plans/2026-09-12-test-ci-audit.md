# Test, CI, and verification audit

Status: PARTIAL — targeted fixes implemented locally; follow-ups below remain open.
Audited: 2026-09-12. Base: `5cba601f`. This is a bounded audit, not certification
that every test is necessary or every execution path is covered.

## Evidence and conclusions

The historical investigation below supersedes the initial 30-run sample for
prioritization. The initial sample contained 24 successes,
4 failures, and 2 cancellations. These span different commits and overlapping
PRs: **4/30 is not a flake rate**. A flake rate needs repeat attempts of the
same revision and environment, classified by failing test.

- [Run 34647118798](https://github.com/KitsuneKode/kunai/actions/runs/34647118798):
  Windows activation-lock contention worker 7 exited 1; the parent waited 15s,
  reported seven handshakes, and omitted the child's stderr. Linux tests and
  macOS parity passed. Windows setup took about 120s; its CLI tests about 103s.
  The Linux test step took 162s, macOS CLI tests 194s. These are individual
  observations, not medians or projected savings.
- [Run 34617277253](https://github.com/KitsuneKode/kunai/actions/runs/34617277253):
  the same contention test lost worker 0 with exit 1. Several independent
  SQLite-backed tests also exceeded 20s. This supports investigating Windows
  resource pressure; it does not establish the worker's root cause.
- [Run 34513908076](https://github.com/KitsuneKode/kunai/actions/runs/34513908076):
  native mpv TLS assertions split observations using LF only. The corrected
  reliability PR subsequently passed. This was platform-sensitive test logic,
  not evidence that TLS coverage should be removed.
- Main's branch-protection endpoint returned `Branch not protected`; the
  repository rulesets endpoint returned one ruleset, `rules` (20812901), with
  enforcement `disabled`. Both mechanisms were checked before filing this gap.

## Changes in this worktree

1. Removed `fmt:check -> typecheck` from root Turbo configuration. Before/after
   dry runs scheduled 37 versus 12 tasks. The removed tasks include typechecks,
   transit nodes, and docs generation; **25 fewer tasks does not mean 25 costly
   processes or a measured percentage speedup**. The dedicated typecheck job
   remains. No build dependency or test gate was removed.
2. Added the production provider registry to the docs path filter. The generator
   reads `apps/cli/src/container/bootstrap-providers.ts`, while CI only listed
   the old container barrel. A regression test failed on that exact changed
   path before the fix and passed afterward. Manifest and command paths were
   checked to disprove a broader missing-filter claim.
3. Kept the eight-process activation-lock test, but drain both child pipes,
   fail on nonzero worker exit during polling, and kill/reap remaining children
   in `finally` before deleting the temporary profile. Injecting a worker throw
   exposed its exact error and failed the test in about 0.2s. This repairs
   diagnosis and cleanup, **not the unobserved Windows child failure**.
4. Replaced both debounce-test 90ms sleeps with fake-timer advancement inside
   React `act()`. Added the missing staggered-selection case: an older deadline
   must not publish an intermediate preview. Removing timer cancellation made
   it fail with `settled=1` where `settled=0` was required. Production hook is
   unchanged.
5. Corrected test-caching guidance and added a verification-evidence section to
   the PR template. Tests currently have caching disabled; the old guidance
   claiming unchanged tests replayed was inaccurate.

## Prioritized remaining work

### P1 — Make merging depend on actual evidence

Owner: repository settings and `.github/workflows/ci.yml`.

Define one always-running aggregate CI result that fails when any required job
fails or is cancelled, and distinguishes expected path-filter skips from an
upstream failure preventing work. Add fixtures for runtime-only, docs-only,
registry-only, installer-only, shared-config, and root-script diffs. Then enable
an active main ruleset requiring that result and the release guard. Retain a
reviewed emergency bypass policy. Configure settings only after the concrete
check names and bypass policy are agreed; no remote policy was changed here.

Disproof attempted: checked classic branch protection and repository rulesets,
not merely the workflow YAML. GitHub documents that a skipped job can report
success, so requiring a conditional job alone is insufficient evidence:
[status checks](https://docs.github.com/en/pull-requests/reference/status-checks).
If merge queue is adopted later, wire and validate `merge_group` first:
[GitHub rules troubleshooting](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules).

### P1 — Diagnose the Windows worker failure before changing budgets

Owner: activation-lock test and production native-installer lock implementation.

Run the instrumented contention case on Windows, then the whole CLI unit suite
at the same revision. Capture the first child's stderr, exit/signal, Bun version,
runner image, and process count. Reproduce its actual error in a focused test.
No automatic rerun-to-green, quarantine, or larger blanket timeout is proposed.

Disproof attempted: workers already have start/enter/release handshakes, so
replacing another sleep cannot explain exit 1. An acquisition timeout explicitly
exits 2. The failure has no child diagnostic, so calling it a scheduler flake
would be guessing. The existing teardown previously had no failure-path reap.

### P1 — Measure storage teardown and concurrency separately

Owner: `packages/storage/test/helpers/temp-store.ts` and CLI suite scheduling.

The shared registry runs synchronous full GC for every cleanup, on every OS,
then clears statements and closes databases. Windows correctness requires real
handle-release evidence, so do not remove GC speculatively. Benchmark the same
revision with full-suite parallelism versus bounded concurrency, reporting wall
time, CPU time, memory, GC/cleanup time, and failures. Partition slow real-process
and SQLite suites only if measurements justify it. Keep each worker's profile
isolated. Never share live databases or seed state across tests for speed.

Disproof attempted: the helper is shared through `@kunai/storage/testing`; this
is not two duplicate implementations to consolidate. The observed timeout burst
is broader than a single download test. No speedup is claimed yet.

### P2 — Close verification-command and CI-selection coverage gaps

Owner: `apps/cli/scripts/run-default-tests.ts`, Turbo configs, CI filters.

The runner's path detection treats any non-dash argument as a file, including a
value passed after `-t` or `--timeout`. Its extra-argument branch invokes Bun
without the normal scripted timeout baseline or environment override. Existing
`test-timeout-budget.test.ts` checks script strings and the presence of the env
name, not executed argv. Add subprocess contract tests for default suites,
focused paths, equals/separate option values, failure propagation, timeout
precedence, and the `TURBO_HASH` aggregator no-op. Use a throwaway fixture tree
so a parsing failure cannot accidentally discover live tests.

Audit root-file gates next: Turbo workspace lint/format tasks run from package
roots, leaving root scripts/config and `.docs/` outside those directory scopes.
The staged hook helps but does not prove CI catches an unstaged or hook-bypassed
root regression. Mutation-test a root script lint error and a workflow-only
change; add scoped root gates instead of running the whole repository twice.

### P2 — Retain run evidence before optimizing more CI

Owner: workflow jobs and shared setup action.

Upload Turbo `--summarize` output and failed test logs with short retention even
on failure. Record revision, attempt, OS, Bun, selected tasks, skip counts, and
cache status. Use enough runs for p50/p95 job and setup costs. Current workflow
requests summaries but does not retain them as a review artifact.

Docs tests/lint/typechecks appear in the general jobs and again in Docs build.
Consolidate only after mapping which generation/freshness step each requires;
the freshness check must stay before generation. Consider skipping Turbo cache
restore in jobs with no cacheable tasks, after measuring restore/save cost.
Do not re-enable test caching until all external inputs and shared output
ownership are accounted for.

### P2 — Finish platform-specific coverage instead of counting skips as passes

Owner: native-installer rollback tests, native player tests, analytics test job.

Rollback activation/refusal fixtures use POSIX symlinks and skip their behavior
suite on Windows. Add Windows copy/rename equivalents for manifest failure,
restore of prior launcher, contention, and owner replacement. Existing Linux
rollback coverage does not exercise Windows file-lock behavior. The owning
infrastructure doc already tracks this gap; do not create a second independent
implementation plan.

Native mpv tests skip when `mpv` is absent. CI provisions it on Windows/macOS;
retain those native gates and report local skips explicitly. Postgres cases have
a dedicated real-database CI job with a skip check; preserve that distinction.
A local default-suite pass does not qualify Postgres or a released binary.

### P2 — Broaden UI testing at the interaction boundary

Owner: existing render-capture harness and shell integration suites.

Migrate remaining readiness sleeps in overlay/library/calendar tests to
fixture-owned completion signals; use fake timers only when elapsed time is the
behavior. Keep width, input ownership, cancellation, unmount, and reverse-state
assertions. Inventory affected behaviors across browse, palette, hotkey, and
post-play, and both anime/TMDB identities where appropriate.

Avoid starting a new TUI driver from the old plan's premise: PR #359 already
characterizes shell-action routing and corrects plan 010. Inspect that PR before
claiming `AppRoot` exposure or a new harness is necessary. The current harness
already delivers real Ink input and captures frames. A future agent driver
should reuse it and isolated profiles, and prove a displayed change and its
persisted state agree, including the reverse action.

## Existing work: review and integrate, do not duplicate

- [#367](https://github.com/KitsuneKode/kunai/pull/367): deterministic download
  cancellation and injectable polling clock; open with successful CI when checked.
- [#352](https://github.com/KitsuneKode/kunai/pull/352): removes the installer
  activation test's 300ms machine-speed assertion.
- [#355](https://github.com/KitsuneKode/kunai/pull/355): reliability/privacy fixes,
  including the native TLS coverage corrected after Windows feedback.
- [#359](https://github.com/KitsuneKode/kunai/pull/359): shell-action routing
  characterization and correction of plan 010's premise.
- [#354](https://github.com/KitsuneKode/kunai/pull/354): lint-ratchet behavior coverage.

The large number of overlapping open PRs is itself a coordination cost. Review
and test their cumulative head in dependency order; passing each branch against
an older main does not prove the combined tree. No PR was merged or closed here.

## Unnecessary tests: conservative conclusions

No production behavior test was deleted. Small size and similar names do not
establish redundancy. The bootstrap contract suite has two component checks
plus their combined check and a narrower release-specific scan; the aggregate
repeats the component results. Consolidating their scans or replacing repetition
with malformed-workflow fixtures would improve signal, but its runtime is tiny
compared with native setup and process/SQLite work.

The provider tests include elapsed-time upper bounds and fixed sleeps (notably
AllManga and AniDB). These are candidates for controlled completion/cancellation
fixtures, not all confirmed flakes. Timer implementation tests and subprocess
hang deadlines are legitimate real-time boundaries. Do not blanket-ban timers
or delete concurrency, installer, native IPC, and storage tests to cut duration.

## Handoff boundaries

Applied seams: CI declaration to reader (registry filter), reverse states
(timer cancellation), UI input and frames, platform-aware child cleanup, and
owning docs. No provider adapter, catalog identity, analytics consent, relay,
or user-data behavior was changed. Native Windows/macOS execution remains
required before claiming those platforms are verified.

## Source pointers at this audit revision

| Finding                 | Defect or cost                                                                            | Reachability / existing coverage                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Provider docs selection | CI docs filter, `.github/workflows/ci.yml:81` (fixed)                                     | `apps/docs/scripts/sync-code-metadata.ts:117`, called at line 344; new routing regression           |
| Worker diagnostics      | `apps/cli/test/unit/services/update/native-installer/activation-lock.test.ts:364` (fixed) | Eight real child processes and handshake polling in the same test; failed Windows runs linked above |
| Formatter dependency    | `turbo.json:19` (fixed)                                                                   | Format job invokes `turbo run fmt:check`; before/after dry-run task graphs                          |
| Runner argv / timeout   | `apps/cli/scripts/run-default-tests.ts:48`                                                | Package `test` entry; architecture timeout checks inspect strings rather than running this branch   |
| Storage cleanup cost    | `packages/storage/test/helpers/temp-store.ts:68`                                          | `cleanup()` at line 53, shared by CLI/storage tests                                                 |
| Windows rollback gap    | `apps/cli/test/unit/services/update/native-installer/rollback.test.ts:256`                | POSIX-only behavior suite; read-only planning coverage remains at line 144                          |

## Local verification

All commands ran in the isolated audit worktree based on `5cba601f`, including
its uncommitted changes; no hosted CI has run this worktree.

- `bun run test --force`: 23/23 Turbo tasks successful, zero cached, about 94s.
  CLI unit: 5360 pass, 1 skip, zero failures. CLI integration: 268 pass, 25 skip, zero failures. Analytics: 84 pass,
  33 database-gated skips, zero failures. The initial sandboxed run failed to
  bind fixture sockets with EPERM; the successful rerun had loopback permission.
- `bun run typecheck --force`: 14/14 tasks successful, zero cached.
- `bun run lint`, `bun run fmt`, and `bun run fmt:check`: passed.
- `bun run verify:doc-paths`, `bun run verify:doc-frontmatter`, and
  `bun run verify:doc-coverage`: passed. Doc coverage is a real local script in
  this tree; it is not disabled by a CI-only environment guard.
- `bun run build --force`: 10/10 tasks successful, zero cached; Linux host
  artifact built. This is not a native Windows/macOS qualification.
- `bun run pkg:check`: passed; four-file npm launcher package within size limits.
- Final focused rerun: 21 pass, 1 Windows-only skip, zero failures.
- Provider-filter red/green, debounce cancellation mutation, and injected worker
  crash were exercised; mutations were restored. Targeted tests were rerun.

Native Windows/macOS, Postgres, release installer matrix, provider/network
signoff, and real-terminal visual inspection are separate outstanding gates.

## Follow-up implementation

The direct test runner now distinguishes option values from file filters and
retains timeout precedence for focused runs. Ten disposable subprocess cases
cover discovery, argv, failure propagation, and aggregation. The old source-string
override assertion was removed because the executed contract supersedes it.
The format/lint/typecheck/test CI jobs now retain Turbo summaries for seven days;
the Linux test job also records combined output with pipefail. Native job logs,
aggregate merge enforcement, and runtime failure diagnosis remain open.

Follow-up validation: full `bun run test --force` passed with zero cache replays;
CLI unit reported 5369 pass, one Windows-only skip, zero failures. Fresh
workspace typecheck, lint, formatting, doc paths/frontmatter/coverage also passed.
The ten runner subprocess contracts passed, including three repeated executions.
Artifact-upload behavior is configured and YAML-parsed locally; it still needs a
hosted workflow run. No remote ruleset or merge setting was changed.

## Historical CI investigation — 2026-09-13

### Scope and limits

Inventoried all 3,476 workflow runs returned by the repository Actions API,
from May 2 through September 12, 2026. The CI workflow accounts for 1,155 runs:
235 latest conclusions were failure, 111 cancelled, and 46 had multiple attempts.
These are overlapping categories, not a flake rate.

Fetched all-attempt job metadata for 616 runs: failures, timeouts, startup or
approval failures, cancellations, and every multi-attempt run, including those
that eventually succeeded. This yielded 6,865 job records and **580 failed
jobs**. Of those, 28 belong to runs whose final conclusion was cancellation.
Excluding cancelled runs would have hidden those failures.

Recovered **525 failed-job logs**. GitHub returned HTTP 410 for the remaining
55 (43 from May and 12 from June); their metadata remains in the inventory,
but their root causes cannot be established from these logs. Deleted runs and
failures tolerated inside otherwise successful, single-attempt jobs are outside
this inventory. Jobs without a failure conclusion are not counted as failures.

The local evidence bundle is `/tmp/kunai-ci-history-evidence`: a CSV ledger has
one row per failed job, with SHA, attempt, failed step, duration, extracted test
names, later-success indicator, and GitHub job URL. The JSON analysis retains
failure context; raw logs are separate. This is a temporary local artifact,
not a checked-in source or a permanent log archive.

Extraction found Bun `(fail)` records in 253 jobs, covering 215 distinct test
names. Duplicate summary lines within a job count once. A name is a signature,
not a root cause: one shared fixture failure can break several tests, and one
test can fail for different reasons. Remaining logs include setup, lint, build,
release and other failures; absence of a Bun marker does not prove no test ran.
Representative recurring signatures were read against historical changes and
current code. Every job is indexed; not every job has a proven root cause.

Forty failed jobs have a later successful attempt of the same named job in the
same workflow run. These are useful candidates for controlled reproduction,
not forty proven flakes: external services, caches and runner environments can
change between attempts.

### Where the time went

Summing failed-job start/end durations gives 1,022.3 job-minutes. Windows parity
accounts for 673.5 minutes (653.6 blocking plus 19.9 formerly non-blocking),
macOS parity 134.1, and the main Test job 45.5. Parallel jobs accumulate separate
minutes. These figures include setup and useful defect detection; they are
neither billed usage nor an estimate of recoverable savings. Successful-job
cost and p50/p95 critical-path latency have not been measured by this collection.

The failure inventory includes 145 Windows parity jobs, 51 macOS parity jobs,
66 Test jobs, 35 Docs build jobs and 31 Format check jobs. There were 44 failures
at the local setup-action step, 11 during native mpv provisioning, and 95 at
installer matrix scenario steps. A matrix-wide shared failure is one incident
with many failed jobs, not 95 independent flaky tests.

### Recurring signatures and what they actually establish

Counts below are failed jobs containing that exact test name, across revisions
and platforms. They measure recurrence, not present-day defect frequency.

| Signature                                  | Jobs / distinct runs | Evidence and disposition                                                                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PowerShell dry-run dependency plan         | 14 / 5               | [Run 32157441382](https://github.com/KitsuneKode/kunai/actions/runs/32157441382): expected `mpv.net`, received the new `mpv-player.mpv-CI.MSVC` package. Stale expectation; preserve consent and package-selection coverage.                                                |
| Eight-process stale activation lock        | 13 / 13              | Multiple mechanisms across history. Recent [run 34647118798](https://github.com/KitsuneKode/kunai/actions/runs/34647118798) lost a child with exit 1 before readiness. The local diagnostics fix makes that observable; the crash itself remains unresolved.                |
| Sync drain continues past operation budget | 12 / 12              | Windows-heavy disk/teardown cost. Existing changes reduced fixture size by injecting the batch limit while preserving multiple batches. Do not delete yielding/drain coverage or assume every timeout shares one cause.                                                     |
| Three PowerShell consent tests             | 11 / 3 each          | [Run 33676610832](https://github.com/KitsuneKode/kunai/actions/runs/33676610832): source extraction could not find `Confirm-OptionalInstall`. This failed before consent assertions, not because consent was intermittent. Current tests target the revised implementation. |
| Release artifact version census            | 11 / 11              | [Run 33020484310](https://github.com/KitsuneKode/kunai/actions/runs/33020484310): new 0.4.0 invalidated a whole-list assertion. Fixed in #315 by asserting the intended historical interval. Keep release contracts, remove future-hostile enumerations.                    |
| Codegen idempotence                        | 10 / 10              | [Run 32732602327](https://github.com/KitsuneKode/kunai/actions/runs/32732602327) reached a 5s subprocess deadline. Existing budgets changed; retain byte-identity checks and measure subprocess cost. A larger budget alone does not diagnose contention.                   |
| Notification overlay playback result       | 10 / 9               | [Run 29049388761](https://github.com/KitsuneKode/kunai/actions/runs/29049388761) read `playback` from an undefined result. This signature needs contract/history inspection, not automatic timing classification.                                                           |
| Offline legacy/new job grouping            | 10 / 10              | Recent Windows logs exceed suite deadlines alongside unrelated SQLite cases. Keep the legacy compatibility invariant; benchmark full-suite storage cleanup and concurrency separately.                                                                                      |
| Failed quarantine preserves WAL placement  | 9 / 6                | [Run 32507635512](https://github.com/KitsuneKode/kunai/actions/runs/32507635512) expected chmod to block rename on Windows. Current premise probe avoids the false assertion but silently returns when unsupported; remaining coverage work is below.                       |
| Reconciliation exceeds 100 facts           | 8 / 7                | Same behavioral boundary should use a small injected batch limit and enough rows to cross it. Real persistence stays covered; hundreds of writes are not required to prove the algorithm.                                                                                   |
| Reused-PID activation owner                | 8 / 8                | [Run 32698342490](https://github.com/KitsuneKode/kunai/actions/runs/32698342490) tried real process identity lookup inside 100ms. Current tests inject identity outcomes. Retain a separate native probe integration contract.                                              |

Other concrete failures reinforce the distinction: FileStorage path assertions
broke across OS path resolution; TLS observations assumed LF rather than CRLF;
Postgres lifecycle tests collided through shared fixtures; and process shutdown
tests tried to signal a process that had already exited. The latter reported
ESRCH in [run 29704289492](https://github.com/KitsuneKode/kunai/actions/runs/29704289492).
These are not reasons to remove storage, TLS, analytics or shutdown coverage.

### Earlier fixes that must not be undone

- The CLI integration task depends on its build. Commit `d5b7893b` documents
  multiple writers and cache restoration racing over the same dist output;
  `apps/cli/turbo.json` retains the edge. Removing it for nominal parallelism
  would reopen a known race.
- Timezone coverage moved out of unit execution and reduced redundant child
  processes in `36741c4e`. Keep separate timezone processes where runtime TZ
  behavior is the contract; use pure date fixtures elsewhere.
- Poster conversion tests stopped discovering the host's ImageMagick through
  an unmocked seam (`228b975f`). External tools must be explicit fixtures in
  deterministic tests, with actual tools exercised in their own integration lane.
- The aged Windows owner test previously supplied an impossible identity but
  expected retention. A fast real probe correctly reclaimed it; a slow probe
  could return unknown and pass. `406b6ace` injected a matching identity. Raising
  its deadline would not repair this contradictory fixture.
- Release metadata pushes ran the full pre-push suite and could block an
  otherwise published release. [Run 33622026980](https://github.com/KitsuneKode/kunai/actions/runs/33622026980)
  failed in that hook. #315 narrowed this path and fixed the version census;
  retain full verification for source changes and the release candidate.

### Work order and acceptance evidence

1. **Windows diagnostics and resource pressure.** First run the instrumented
   activation case and full unit suite on Windows at the same revision. Record
   child stderr/exit, runner/Bun versions, suite concurrency, cleanup duration
   and process counts. Compare repeated default and bounded-concurrency runs.
   Accept a scheduling change only if correctness holds and measured wall time
   or failure recurrence improves. Do not remove synchronous SQLite GC until
   real Windows handle-release tests prove an alternative.
2. **Make coverage honest at OS/process seams.** In
   `packages/storage/test/sqlite-recovery.test.ts`, the rename premise branch
   returns before all recovery assertions. Add deterministic failure injection
   for the database/WAL ordering contract and explicit reporting of unsupported
   native premises. In `apps/cli/test/integration/process-shutdown.test.ts`,
   `spawnAndSignal` checks PID/database existence and liveness, then still sleeps
   1.5s for handler registration. Replace that readiness assumption with an
   observable handler-ready signal; keep a bounded real-process deadline and
   transcript on failure. These are verified code observations, not a claimed
   reproduction of the latest native failures.
3. **Guard the PR decision, not only individual jobs.** Implement the aggregate
   gate and changed-path fixtures described above, then validate hosted check
   behavior before changing remote enforcement. Report skips explicitly,
   especially PowerShell, Postgres, native rollback and live-provider gates.
4. **Measure duplication before removing work.** Retain inexpensive local
   checks and genuine per-OS behavior; identify duplicate typecheck/build/setup
   work from hosted timing artifacts. Separate scheduler interference from slow
   tests. Compare same-revision job critical paths rather than task-node counts.
5. **Improve the agent verification contract.** Every fix records the failing
   signature, smallest reproduction, prerequisite state, regression or mutation
   evidence, full-suite result and unrun platform gates. UI tests should drive
   visible state and readiness rather than arbitrary microtask counts, sleeps,
   ANSI byte lengths or internal function names. Real terminal rendering and
   playback remain separate qualification, not implied by snapshots.

Existing installer timing PRs #352 and #385 overlap this territory; inspect and
consolidate their changes before implementing another timing patch. Their open
status was checked during this audit, but can change. No blanket retries,
quarantines, test deletion, remote policy changes or claims of zero future
flakes follow from this inventory.

## Recovery and shutdown follow-up — 2026-09-16

Implemented two remaining test corrections, with production behavior unchanged:

- Replaced the chmod-dependent recovery premise and silent early return with a
  scoped filesystem failure at the main database rename. Real SQLite still
  detects the corrupt file; actual sibling files must remain in place with
  their contents intact, and no successful-recovery message may be emitted.
  The fixture establishes surviving siblings at the rename boundary because
  SQLite's earlier close may remove invalid siblings differently across OSes.
  Removing the production early return after rename failure made the test fail;
  restored production code passed all 184 storage tests.
- Disproved the proposed need for a new signal-readiness hook: `startCli`
  already installs its handlers before database initialization. Removed the
  shutdown test's 1.5s grace sleep and ineffective one-iteration liveness loop.
  Require the handler's transcript message in addition to signal exit status.
  Removing SIGTERM registration left exit status 143 intact but failed the new
  assertion, demonstrating the coverage gap. Restored code passed all three
  real-process signal cases in about 1.3s on this Linux host. The removed sleeps
  total 4.5s per full execution of this file; hosted savings are unmeasured.

The earlier historical counts are a September 13 snapshot ending September 12;
they were not refreshed to include newly created runs on September 16. Native
Windows filesystem execution and macOS PTY execution still need hosted evidence.

Validation: the full workspace suite passed 23/23 tasks with zero cached tasks
in 107.6s after granting fixture servers loopback access. The sandboxed attempt
failed with EPERM on socket binding and empty launcher stdout. After the full
run, the launcher stand-in was changed to exit naturally after writing output,
and two lint warnings in the earlier runner changes were removed. Final fresh
typecheck passed 14/14 tasks, lint passed 12/12 with zero warnings, and the 13
focused runner/shutdown cases passed. The full suite has not been rerun after
these last small edits.

The launcher fixture passed a deferred-stdout probe outside the sandbox with
natural exit. The old-fixture comparison outside the sandbox was rejected by
automatic approval review because of a usage limit. Empty stdout also occurred
inside the sandbox after the fix, so the observed failure is not established as
an output-flushing flake. No temporary production mutations remain. Windows
child-exit diagnosis and remote merge enforcement remain outstanding.

## Aggregate gate and review — 2026-09-17

Added `CI ready`, an always-running dependency aggregator with explicit required
job predicates. It rejects missing results, invalid filter outputs, failures,
cancellations and unexpected skips. Path routing fixtures include runtime,
docs, provider registry, installer, shared config, root scripts and CI changes.
Release Guard now emits a check on every PR. The duplicated registry-only test
was consolidated into these fixtures following independent review. The second
review correction removed a stale statement about Release Guard PR filtering.

Refreshed Actions history after the original cutoff: the first refresh returned
16 additional runs, none failed. Main remained at `5cba601f`; #385 remains open
and owns separate shell-installer timing changes. The existing ruleset remains
disabled. Remote enforcement is pending hosted qualification of the new check.

Restored missing worktree dependencies with frozen lockfile. Fresh local full
tests passed 23/23 tasks with zero cache in 90.5s on host Bun 1.4.2; hosted CI
continues to pin Bun 1.4.0. Typecheck passed 14/14 and lint 12/12 without warnings.
Doc paths/frontmatter/coverage and release guards passed. The Windows worker
root cause is still unproven; no timeout, GC, or concurrency change was made.
