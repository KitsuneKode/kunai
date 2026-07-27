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

| #   | Plan                                                                         | Depends on | Blocking for release? |
| --- | ---------------------------------------------------------------------------- | ---------- | --------------------- |
| 0   | _(done)_ truthful state propagation — commit `94189298`                      | —          | ✅ shipped            |
| 0   | _(done)_ in-flight provider hardening — commit `d79dcc7e`                    | —          | ✅ shipped            |
| 1   | [`resolve-telemetry-spine`](2026-07-28-resolve-telemetry-spine.md)           | —          | **Yes**               |
| 2   | [`candidate-racing`](2026-07-28-candidate-racing.md)                         | 1          | **Yes**               |
| 3   | [`health-recovery-and-ordering`](2026-07-28-health-recovery-and-ordering.md) | 1          | No                    |
| 4   | [`history-actions-and-download`](2026-07-28-history-actions-and-download.md) | —          | No                    |
| 5   | [`diagnostics-dashboard`](2026-07-28-diagnostics-dashboard.md)               | 1          | No                    |
| 6   | Release gates (below)                                                        | 1, 2       | **Yes**               |

Plan 4 has no dependencies and can be run at any point, including first if a quick visible win is wanted.

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

Known-acceptable noise, so it is not mistaken for a regression:

- `apps/cli/src/app-shell/poster-renderer.ts` — `ImageCapability` imported but never used. Pre-existing, unrelated, from the sixel work. Leave it.

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

## Housekeeping, unrelated to the plans

Blocked earlier by the permission classifier; both verified safe:

```bash
# 126MB of stale agent worktrees. All 6 sit on 5fab8110 (merged to main),
# 0 commits ahead, only change is the same deleted build stub in each.
for d in .claude/worktrees/*/; do git worktree remove --force "$d"; done
git branch --list "worktree-agent-*" --format="%(refname:short)" | xargs -r git branch -D

# Orphaned test residue. The test bug itself is already fixed.
rm -rf 'apps/cli/\tmp\kunai-uninstall-yGVQtd'
```

## The pattern these plans exist to fix

Five capabilities in this codebase were built, tested, and never called:

| Capability               | State found                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `ResolveTraceRepository` | schema, migration, repo, pruning — instantiated only in tests |
| `recentFailureRate`      | persisted every resolve, read by nothing                      |
| `medianResolveMs`        | persisted every resolve, read by nothing                      |
| Endpoint quarantine      | failures recorded, `quarantined_until` never set              |
| `getMediaActions`        | full per-surface policy, called only by its own test          |

Worth naming as a systemic thing rather than five coincidences: the expensive part — schema, storage, retention, tests — gets built, and the cheap last wire is skipped, so the feature reads as present in code review and is absent at runtime. When adding a capability, the acceptance criterion is a runtime observation, not a passing test.
