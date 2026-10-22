# Plan 004: Decide wire-or-retire for the attention decision layer (spike — no code until decided)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. This is a **spike**: its deliverable is a decision memo reported
> back to the operator — NOT a code change. Do not wire or delete anything
> unless the operator explicitly instructs it in reply to your memo. When
> done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- apps/cli/src/services/attention apps/cli/src/services/release-reconciliation .docs/features/new-episode-tracking.md .docs/feature-map.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (investigation + memo; implementation is a separate decision)
- **Risk**: LOW (read-only until the operator decides)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `faf1afd22`, 2026-10-09

## Why this matters

Kunai ships a documented three-fact model for new-episode attention
(aired / worth-surfacing / provider-confirmed) and has two pure decision
functions implementing the middle fact — plus dedicated green test suites for
both — but **nothing in production calls them**. The live notification path
uses a different, narrower gate instead. So today: tests certify behavior
production never runs, the docs describe a model the code doesn't execute,
and the two gates can drift apart with both sides green. This is the repo's
recurring false-confidence failure mode. The product-facing question —
should implicit interest (recent watching) actually drive the home shelf and
notifications? — needs a maintainer decision before any code moves.

## Current state

All caller-count claims below were verified by grep at `faf1afd22`
(2026-10-09); re-verify them yourself in Step 1.

- `apps/cli/src/services/attention/FollowedTitleService.ts:14` — the middle-fact
  heuristic, zero production callers:

```ts
export function shouldTrackTitleForNewEpisodes(input: NewEpisodeTrackingInput): {
  readonly shelf: boolean;
  readonly notification: boolean;
} {
  if (input.preference === "muted") {
    return { shelf: false, notification: false };
  }
  if (input.preference === "following") {
    return { shelf: true, notification: true };
  }
  const recentWindowMs = input.recentWindowMs ?? 14 * 24 * 60 * 60 * 1000;
  const watchedRecently =
    input.lastWatchedAt !== undefined &&
    Date.parse(input.now) - Date.parse(input.lastWatchedAt) <= recentWindowMs;
  const strongInterest = input.recentWatchedEpisodes >= 2 || watchedRecently;
  return { shelf: strongInterest, notification: strongInterest };
}
```

Its only importer is its own test:
`apps/cli/test/unit/services/attention/FollowedTitleService.test.ts`.

- `apps/cli/src/services/attention/ReleaseAvailabilityService.ts:24` —
  `projectReleaseAvailability(input)` returns the `shelfState` +
  `new-playable-episode` signal; zero production callers; only imported by
  `apps/cli/test/unit/services/attention/ReleaseAvailabilityService.test.ts`.

- The LIVE gate, `apps/cli/src/services/release-reconciliation/release-notification-policy.ts:24`:

```ts
export function shouldNotifyForReleaseProjection(
  projection: Pick<
    ReleaseProgressProjection,
    "newEpisodeCount" | "latestKnownReleaseAt" | "status" | "staleAfterAt"
  >,
  historyRow: HistoryProgress | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (activeNewEpisodeCount(projection, nowMs) <= 0) return false;
  if (!historyRow) return true;
  if (!isFinished(historyRow)) return false;
  return isFreshlyAiredSinceWatch(projection.latestKnownReleaseAt, historyRow.updatedAt);
}
```

- Its single call site, `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts:119-141`
  — builds the same `new-playable-episode` signals inline (note the shape is
  nearly `projectReleaseAvailability`'s `notificationSignal`):

```ts
          .map((projection) => {
            const historyRow = historyByTitle.get(projection.titleId);
            const providerId = historyRow?.providerId ?? projection.source;
            return {
              type: "new-playable-episode" as const,
              titleId: projection.titleId,
              mediaKind: projection.mediaKind,
              title: projection.title,
              season: projection.latestAiredSeason,
              episode: projection.latestAiredEpisode,
              providerId,
              catalogSource: catalogSourceLabel(projection.source) ? projection.source : undefined,
              availableAt: projection.checkedAt,
            };
          });
```

- Docs that describe the dead model:
  - `.docs/feature-map.md:109` — `Follow / new-episode attention | packages/storage followed-titles; services/attention/*`
  - `.docs/features/new-episode-tracking.md:11-16` (status: current):

```
New episode tracking separates three facts:

- the episode is scheduled or aired
- Kunai believes the title is worth surfacing
- a provider has confirmed a playable stream
```

The middle fact is exactly what `shouldTrackTitleForNewEpisodes` encodes.

- Related but distinct: `enqueue-release-reconciliation.ts:147+` DOES call
  `container.attentionRefreshWorker.runOnce(...)` behind
  `featureFlags.providerAvailabilitySync` — the _refresh worker_ is wired;
  it is the two _decision functions_ above that are not. Do not confuse the
  two when writing the memo.

## Commands you will need

| Purpose                                        | Command                                                                                            | Expected on success                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Zero-caller check (decision functions)         | `grep -rn "shouldTrackTitleForNewEpisodes\|projectReleaseAvailability" apps/cli/src apps/cli/test` | hits only inside `services/attention/*` and `test/unit/services/attention/*` |
| Live-gate call-site check                      | `grep -rn "shouldNotifyForReleaseProjection" apps/cli/src`                                         | declaration + one call in `enqueue-release-reconciliation.ts`                |
| Typecheck (if you change nothing, sanity only) | `bun run typecheck`                                                                                | exit 0                                                                       |

## Scope

**In scope** (read-only investigation + one memo):

- `apps/cli/src/services/attention/` (both files + their tests)
- `apps/cli/src/services/release-reconciliation/` (the live gate and its call site)
- `.docs/feature-map.md:109`, `.docs/features/new-episode-tracking.md`
- Deliverable: your report back to the operator (see "Deliverable" below)

**Out of scope** (do NOT touch):

- Any code or doc edit — this is a spike. No wiring, no deletion, no doc
  rewording until the operator picks an option.
- `NotificationEngine` / `notificationService` behavior.
- The `providerAvailabilitySync` refresh-worker path (already wired; not
  part of the dead-layer question).

## Git workflow

- No branch needed unless the operator later promotes the chosen option to
  implementation (then: `advisor/004-attention-wire` or `-retire` per the
  operator's choice).

## Steps

### Step 1: Re-verify the dead-layer claims

Run both grep commands in the table. Confirm: zero callers outside
`services/attention/` + its tests; exactly one live call site for the
projection gate.

**Verify**: outputs match "Expected on success" columns exactly.

### Step 2: Trace what the live path actually notifies on

Read `enqueue-release-reconciliation.ts:100-175` end to end and answer, in
the memo (with file:line evidence):

1. Which titles get `new-playable-episode` signals today (followed?
   continue-watching? muted-filtered where?)
2. Is the "worth surfacing" (implicit interest) fact enforced anywhere, or
   does every reconciled history+followed title notify?
3. What would `shouldTrackTitleForNewEpisodes` change about the current set
   (stricter? looser?) — trace where `recentWatchedEpisodes` /
   `lastWatchedAt` would have to come from (history rows already loaded in
   that function?) and whether the data is at hand or requires new queries.

**Verify**: each answer cites at least one `file:line`.

### Step 3: Scope both options' costs

- **Option A — Wire**: fold `projectReleaseAvailability`'s shelf/signal
  mapping into the `enqueue-release-reconciliation` signal path and drive an
  implicit-preference check through `shouldTrackTitleForNewEpisodes`.
  Estimate: which call sites change, what new inputs are needed, which tests
  beyond the two attention suites exercise notification counts
  (grep `recordSignals` tests), and what user-visible behavior changes
  (which notifications stop/ start firing).
- **Option B — Retire**: delete `services/attention/{FollowedTitleService,ReleaseAvailabilityService}.ts`
  - their two test suites, and reword `.docs/feature-map.md:109` and
    `.docs/features/new-episode-tracking.md:11-16` to describe only the live
    three-fact implementation (dropping or re-anchoring the "worth surfacing"
    fact). Estimate blast radius: `grep -rn "services/attention" apps/cli/src`
    — note `attentionRefreshWorker` (a different directory file) survives.

**Verify**: both options have a concrete file list and a behavior-change
statement in the memo.

### Deliverable: the decision memo

Report back to the operator (in your final response — do not create repo
files) with: verified evidence from Steps 1–2, Option A and Option B as
scoped in Step 3, and ONE recommended option with reasoning. Then **STOP**
and wait. Only implement if the operator explicitly replies with the choice.

## Test plan

- None to write — the spike's output is the memo. Existing suites
  (`FollowedTitleService.test.ts`, `ReleaseAvailabilityService.test.ts`)
  are evidence input: note how thoroughly they pin the heuristic (they are
  the reason Option B deletes them too, and the reason Option A inherits
  ready-made coverage).

## Done criteria

- [ ] Zero-caller and call-site greps re-verified and quoted in the memo
- [ ] Memo answers Step 2's three questions with `file:line` evidence
- [ ] Both options carry a file list + user-visible behavior statement
- [ ] ONE recommendation delivered; execution halted pending operator choice
- [ ] No files modified (`git status` unchanged)
- [ ] `advisor-plans/README.md` status row updated (BLOCKED-pending-decision
      is the honest value until the operator replies)

## STOP conditions

Stop and report back (do not improvise) if:

- Any grep contradicts the "Current state" claims (the layer got wired, or
  was already deleted — the plan's premise would be false).
- You discover the two decision functions ARE called through dynamic
  dispatch (string-keyed registry, `componentDidMount`-style indirect call) —
  report the call path instead of concluding "dead".
- The operator's reply to your memo is ambiguous about which option to
  implement.

## Maintenance notes

- If Option B (retire) is chosen, `.docs/features/new-episode-tracking.md`
  must be reworded in the same change set — a doc describing a deleted model
  is the exact staleness class this spike exists to remove.
- If Option A (wire) is chosen, the notification-count change needs release
  notes wording (users may see fewer/more notifications) and the two
  attention suites become load-bearing — extend, don't replace them.
- Either way, the false-confidence pair (green suites over unwired code)
  disappears — that is the spike's success criterion.
