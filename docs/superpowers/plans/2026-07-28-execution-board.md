# Resolve Loop — Execution Board

Status board and run order for the resolve-loop work. This is the entry point: start here, not at an individual plan.

Design of record: [`../specs/2026-07-28-resolve-loop-design.md`](../specs/2026-07-28-resolve-loop-design.md)

## How to run this

Each plan is executed with **superpowers:subagent-driven-development** — a fresh subagent per task, with review between tasks. Plans are executed in the order below; a plan may not start until every plan it depends on has passed its gate.

```
/superpowers:subagent-driven-development docs/superpowers/plans/<plan>.md
```

Do not run plans concurrently. They touch overlapping files (`PlaybackResolveService.ts`, `provider-health-policy.ts`, `provider-cycle-engine.ts`), and the later plans depend on measurements the earlier ones produce. Concurrency here buys nothing and costs a merge conflict in the highest-risk code in the repo.

## Run order

| #   | Plan                                                                                  | Depends on | Blocking for release? |
| --- | ------------------------------------------------------------------------------------- | ---------- | --------------------- |
| 0   | _(done)_ truthful state propagation — commit `94189298`                               | —          | ✅ shipped            |
| 0   | _(done)_ in-flight provider hardening — commit `d79dcc7e`                             | —          | ✅ shipped            |
| 1   | _(done)_ [`resolve-telemetry-spine`](2026-07-28-resolve-telemetry-spine.md)           | —          | ✅ shipped            |
| 2   | _(engine landed, off)_ [`candidate-racing`](2026-07-28-candidate-racing.md)           | 1          | **Yes**               |
| 3   | _(done)_ [`health-recovery-and-ordering`](2026-07-28-health-recovery-and-ordering.md) | 1          | ✅ shipped            |
| 4   | _(done)_ [`history-actions-and-download`](2026-07-28-history-actions-and-download.md) | —          | ✅ shipped            |
| 5   | _(done)_ [`diagnostics-dashboard`](2026-07-28-diagnostics-dashboard.md)               | 1          | ✅ shipped            |
| 6   | Release gates (below)                                                                 | 1, 2       | **Yes**               |

Plan 4 has no dependencies and can be run at any point, including first if a quick visible win is wanted.

### Plan 2 status

`runProviderCycle` now accepts `hedgeDelayMs` and races candidates when it is set (commit `438f04a5`). No caller sets it, so runtime behaviour is unchanged.

Two deviations from the plan as written, both deliberate:

- **Task 1 was skipped as redundant.** It specified a new `withCancellationAwareEndpointHealth` wrapper, but `guardEndpointHealthAgainstCancellation` in `provider-attempt-cancellation.ts` already implements exactly that rule against the same `EndpointHealthPort` type, and is already tested for all five cases the task listed. A second copy of the highest-risk rule in the resolve loop is a liability, so the racing loop reuses the existing one.
- **The plan's racing body would have quarantined healthy endpoints.** It hardcoded `class: "server-error"` and dropped `titleId`, where the sequential path calls `classifyEndpointFailureFromCycleFailure` — which deliberately returns `null` for `candidate-blocked`. As written, every videasy session guard would have been persisted as endpoint evidence. The implemented version classifies identically to the sequential path, passes `titleId` through, honours `shouldStopAfterFailure`, and records real per-candidate timings.

Tasks 3 (enable on videasy) and 4 (verify) are **deferred pending a traced baseline**: `resolve_traces` is empty until a playback runs, and the plan's own constraint is that enabling racing is a measured decision.

### Plan 3 status

All three tasks landed. Two deviations worth recording:

- **Ordering applies to fallbacks only.** The plan sorted the whole candidate list; the planner emits `[primary, ...fallbacks]`, and sorting the primary out of first place would override the provider the user explicitly selected for this resolve. `orderProviderCandidates` is applied to the fallback tail.
- **The shadow probe selects but does not execute.** That matches the plan's own "out of scope" note — the executor waits on a latency baseline showing the resolve deadline can absorb an extra request. `selectShadowProbeTarget` therefore has no caller yet, which is the one case on this board where an uncalled capability is deliberate rather than an oversight.

### Plan 4 status

All four tasks landed, but Task 2 could not be implemented as written.

- **The plan's Task 2 would have downloaded the wrong title.** It had `m` open the title-control menu over a history row, but the menu's `download` shell action resolves `state.searchResults[state.selectedResultIndex]` — the highlighted _search_ result, not the history row. The overlay now _picks_ from the menu without running it (`pickTitleControlShellAction`) and re-dispatches row-scoped actions through `MediaActionRouter` with the row's media item, which is the pattern history already used for mark-watched and queue.
- **The `history` allow-list is narrower than the plan specified.** Only actions that can be aimed at a row are offered: `resume`, `download`, `mark-watched`, `mark-unwatched`, `diagnostics`. `play` was dropped because it shares the `resume` shell action and the two arrive indistinguishable; `switch-provider`, `pick-episode`, `share`, and the cache purges were dropped because they are session-scoped.
- **`m` displaced an undocumented watched toggle**, which moved to `w`. Both are now registered in `keybindings.ts`, so unlike the old binding they appear in help and the footer.
- **`downloadsEnabled` now gates the menu on every surface.** The only code honouring that capability at the menu layer was the dead policy this plan deleted, so browse, library, and playing had been offering Download with downloads off.

## Why this order

**1 before everything.** Plans 2, 3, and 5 all consume something plan 1 creates. Racing (2) is a latency change with no way to prove it helped without a traced baseline. Ordering (3) sorts on health fields that are currently untrustworthy — `recentFailureRate` is seeded such that one failure reads as 100%. The dashboard (5) currently renders "no resolve telemetry yet" for the Provider row, so redesigning around that field would be designing for a bug.

**2 before 6.** The hedging default cannot be decided without `winnerWasHedged` aggregated across real resolves.

**4 is independent.** It touches the shell action policy and nothing in the resolve path.

## Gate between plans

A plan is not complete until all of these pass. Run from the repo root:

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck && bun run lint && bun run test
```

Then, specific to each plan, the checks in its own **Verification** section.

The repo now lints clean: the two long-standing warnings (the unused `ImageCapability` import in `poster-renderer.ts` and an unused `recorded` parameter in `packages/core/test/core.test.ts`) were removed in `0fe1a05f`. A warning at this gate is now a regression, not noise.

If a **pre-existing** test fails at any gate, stop. Do not edit the test to pass. Report the file, line, and assertion — a pre-existing test failing after a change is evidence, not a chore.

## Verifying against reality, not just tests

Three of these plans change runtime behaviour in ways unit tests cannot fully prove. Each has a real-world check:

**After plan 1** — traces must actually land:

```bash
cd "$(git rev-parse --show-toplevel)"
cp ~/.cache/kunai/kunai-cache.sqlite /tmp/kunai-verify.sqlite
sqlite3 /tmp/kunai-verify.sqlite "select count(*) from resolve_traces;"
```

Run one playback, re-copy, re-count. The count must increase. **Always copy first — never query the live database.**

**After plan 2** — latency must actually improve, measured against the plan-1 baseline. If it did not, say so and stop rather than tuning the delay until the number looks good.

**After plan 5** — open the overlay and look at it. Layout is not unit-testable.

## Release gates

These are gates, not follow-ups. Each is currently unanswered.

- [ ] **Provider signoff green across all three lanes.**

  ```bash
  KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
  ```

  Back up `~/.cache/kunai/kunai-cache.sqlite` and `~/.local/share/kunai/kunai-data.sqlite` first — the harness calls `createContainer({ debug: true })` and writes to the live databases. Classify every failure as `provider-drift`, `environment-network`, or `harness-failure`. A `provider-drift` failure is an acceptable documented release risk; a `harness-failure` is not.

- [ ] **The hedging default decided by data.** Hedging is on by default (`balanced` → 5s). It makes the user's configured provider priority advisory and doubles outbound load against sites being scraped. Aggregate `winnerWasHedged` from `provider.resolve.hedge-outcome`. If the hedged candidate rarely wins, turn the default off — the cost is real and the benefit is currently unmeasured.

- [ ] **No provider ships reporting `healthy` at a sustained failure rate.** After plan 1, re-read `provider_health` from a copy. vidlink's status is either a real defect to fix or grounds to drop it from the default registry.

- [ ] **The racing cancellation guard proven by test.** Plan 2 Task 1. Getting this wrong quarantines healthy endpoints silently — the worst failure mode available here, because it degrades over time instead of failing loudly.

## The pattern these plans exist to fix

Five capabilities in this codebase were built, tested, and never called:

| Capability               | State found                                                   | Now                                   |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------- |
| `ResolveTraceRepository` | schema, migration, repo, pruning — instantiated only in tests | wired via `ResolveTraceSink` (plan 1) |
| `recentFailureRate`      | persisted every resolve, read by nothing                      | gates effective status (plan 1)       |
| `medianResolveMs`        | persisted every resolve, read by nothing                      | breaks ordering ties (plan 3)         |
| Endpoint quarantine      | failures recorded, `quarantined_until` never set              | single-title trigger added (plan 1)   |
| `getMediaActions`        | full per-surface policy, called only by its own test          | deleted, not wired (plan 4)           |

Worth naming as a systemic thing rather than five coincidences: the expensive part — schema, storage, retention, tests — gets built, and the cheap last wire is skipped, so the feature reads as present in code review and is absent at runtime. When adding a capability, the acceptance criterion is a runtime observation, not a passing test.
