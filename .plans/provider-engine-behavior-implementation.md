# Provider Engine Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first, deduped, observable provider resolve pipeline that avoids redundant network work, preserves rich provider facts, classifies health honestly, and leaves an optional privacy-safe aggregate-health seam for a future service.

**Architecture:** The app layer owns one shared `PlaybackResolveWorkService`, constructed by the container and used by foreground playback, near-handoff prefetch, and other resolve callers with distinct intent. Providers remain fact-producing adapters; core remains responsible for bounded local cycling and global fallback; storage records additive local health evidence; UI renders classified app state. A `ResolveWorkKey` identifies byte-affecting/freshness-equivalent work and deliberately excludes scheduling lane, while its ledger records initiating and joining lanes. Future aggregate intelligence is contract-only until explicitly approved.

**Tech Stack:** Bun, TypeScript, Ink CLI app, `@kunai/core`, `@kunai/providers`, `@kunai/types`, `@kunai/storage`, `bun:test`, SQLite JSON records.

**Source Audit:** [.plans/provider-engine-behavior-audit.md](./provider-engine-behavior-audit.md)

**Current status (2026-05-25):** Tasks 1-9 are implemented as local-first
deterministic slices. Tasks 10-11 remain deferred and unimplemented. One
approval-gated provider smoke was run on 2026-05-25: VidKing, Rivestream, and
AllManga resolved successfully; Miruro failed as a classified network error
from this environment. No remote telemetry, Cloudflare Worker, aggregate health
service, or real mpv playback smoke was run or built.

Implemented refinements:

- Playback and prefetch resolve intents normalize to shared playable work so a
  foreground request can join exact near-need prefetch work.
- `budgetLane` remains ledger metadata, not part of `ResolveWorkKey`.
- Download, recovery, diagnostic, selected-source, selected-stream, and forced
  freshness paths remain isolated by purpose or freshness policy.
- The resolve ledger records cache decisions, joined lanes, provider attempts,
  and rich provider facts already present on resolved payloads without storing
  raw URLs or raw title IDs.
- Support bundles can include a redacted resolve-work insight graph from local
  ledgers; this is local export only.

---

## Scope And Autonomy

Execute Tasks 1-9 as local, deterministic implementation slices without routine user intervention once execution is approved. Keep commits or review checkpoints task-sized and run the named tests before moving forward.

Stop for approval before:

- any live provider smoke, live scraping probe, or other provider network request;
- implementing an upload path, Cloudflare Worker, relay, leaderboard, or remote health-hint fetch;
- collecting raw title identifiers, URLs, request headers, cookies, subtitle URLs, watch history, or user identifiers for telemetry;
- a destructive storage migration or a global provider-ranking policy change;
- user-facing policy that conflicts with the locked copy/state grammar.

Tasks 10-11 are a deferred extension track. They are specified so the local model does not paint the future system into a corner; they are not part of the first implementation run.

For every release-critical task: add or change the named assertion first, run its package command to observe the expected focused failure, implement the smallest coherent behavior, rerun to green, then self-review the diff before proceeding.

## Target Ownership Map

| Concern                                                | Owning boundary           | Files                                                                                                      |
| ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Work identity and local evidence ledger                | CLI playback service      | `apps/cli/src/services/playback/ResolveWorkLedger.ts`                                                      |
| In-flight join, lane promotion, cancellation ownership | CLI playback service      | `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`                                             |
| Resolve orchestration/cache/provider progress          | Existing CLI service      | `PlaybackResolveService.ts`, `PlaybackResolveCoordinator.ts`                                               |
| Shared service construction                            | Composition root          | `apps/cli/src/container.ts`, `apps/cli/src/app/PlaybackPhase.ts`                                           |
| Provider-local stop/fallback evidence                  | Core/types                | `packages/core/src/provider-cycle-engine.ts`, `provider-engine.ts`, `packages/types/src/provider-cycle.ts` |
| Rich available provider facts                          | Provider adapters         | `packages/providers/src/**/direct.ts`, `shared/source-inventory.ts`                                        |
| Scoped local health                                    | CLI/storage               | `TitleProviderHealthService.ts`, new `ProviderHealthEvidence.ts`, storage repository                       |
| User-facing classified truth                           | CLI app/shell             | new `provider-resolve-user-state.ts`, loading/recovery/copy views                                          |
| Redacted export                                        | Diagnostics               | support bundle and operation taxonomy services                                                             |
| Future privacy-safe extension seam                     | Shared type contract only | deferred `packages/types/src/provider-health-intelligence.ts`                                              |

## Contract Anchors

`ResolveWorkKey` represents output-equivalent work, not who asked first:

```ts
type ResolveWorkKeyInput = {
  mediaId: string;
  mediaType: "movie" | "tv";
  episode?: number;
  season?: number;
  providerPreference?: string;
  audioPreference?: string;
  subtitlePreference?: string;
  sourceSelection?: string;
  qualitySelection?: string;
  freshnessPolicy: "trust-fresh" | "validate-before-use" | "force-fresh";
  intentKind: "playback" | "prefetch" | "recovery" | "download" | "diagnostic";
};

type ResolveBudgetLane = "user-blocking" | "near-need" | "background" | "manual-diagnostic";
```

Rules:

- `budgetLane` is ledger/dispatch metadata, never part of `ResolveWorkKey`.
- Exact foreground playback may join and promote identical near-need prefetch.
- Download and diagnostic intent do not join playback work merely because episode identity matches.
- Fresh usable cache produces zero validation and zero provider requests.
- Source/quality/subtitle browsing consumes cached inventory only; confirmation may issue work.
- Network-offline classification terminates local cycling and global fallback without health poisoning.

## Release-Critical Track

### Task 1: Add Resolve Work Identity And Ledger

**Files:**

- Create: `apps/cli/src/services/playback/ResolveWorkLedger.ts`
- Create: `apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts`

- [ ] Write failing tests for stable key construction, lane exclusion, distinct freshness/intent keys, join metadata, cache provenance, provider attempt counts, inventory fact counts, and redacted evidence serialization.
- [ ] Implement types and pure helpers: `buildResolveWorkKey`, `createResolveWorkLedger`, `recordLedgerJoin`, `recordCacheDecision`, `recordProviderAttempt`, `recordInventoryFacts`, `finalizeResolveWorkLedger`.
- [ ] Ensure the ledger cannot accept raw URLs, headers, cookies, subtitle URLs, or arbitrary evidence payloads; admit classified/redacted fields only.
- [ ] Run `bun run --cwd apps/cli test:unit`.

Expected proof:

```ts
expect(buildResolveWorkKey(prefetch.request)).toBe(buildResolveWorkKey(foreground.request));
expect(ledger.joinedBudgetLanes).toContain("user-blocking");
expect(JSON.stringify(ledger)).not.toContain("https://");
```

### Task 2: Introduce The Shared In-Flight Resolve Service

**Files:**

- Create: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Create: `apps/cli/test/unit/services/playback/playback-resolve-work-service.test.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`

- [ ] Test that two exact playback requests share one coordinator invocation and receive the same result.
- [ ] Test that foreground playback joins an identical in-flight prefetch, records lane promotion, and does not start a second provider path.
- [ ] Test that download, forced-fresh recovery, and manual-diagnostic work remain isolated by key/intent policy.
- [ ] Test consumer cancellation: one joining consumer may detach without cancelling work still needed by another consumer; cancel underlying work only when ownership permits and no consumers remain.
- [ ] Implement an app-owned service with `Map<ResolveWorkKey, InFlightResolve>` and ledger lifecycle ownership.
- [ ] Construct exactly one instance in `container.ts`; inject it into playback phase and any existing container-owned resolve callback instead of constructing fresh coordinators per request.
- [ ] Run `bun run --cwd apps/cli test:unit`.

Core assertion:

```ts
await Promise.all([work.resolve(prefetchRequest), work.resolve(playbackRequest)]);
expect(coordinator.resolve).toHaveBeenCalledTimes(1);
expect(result.ledger.joinedBudgetLanes).toEqual(["near-need", "user-blocking"]);
```

### Task 3: Prove Request Economy And Honest Prefetch Progress

**Files:**

- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/app/episode-prefetch.ts`
- Modify: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`
- Modify: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`
- Modify: `apps/cli/test/unit/app/episode-prefetch.test.ts`

- [ ] Add call-count tests proving a fresh stream-cache hit invokes neither validator, source-inventory resolve, nor provider engine.
- [ ] Add tests proving cached inventory validates/resolves only the selected candidate, while picker movement triggers no network work.
- [ ] Emit typed progress for cache trust, cache validation, inventory selection, provider attempt start, local source cycle, and global fallback start/completion.
- [ ] Update prefetch waiting behavior to extend only when real attempt/fallback progress is received, not an event shape that is never emitted.
- [ ] Ensure the coordinator appends ledger and diagnostics information once per physical work item, not once per joining caller.
- [ ] Run `bun run --cwd apps/cli test:unit`.

### Task 4: Bound Provider Cycling And Stop On Network Failure

**Files:**

- Modify: `packages/types/src/provider-cycle.ts`
- Modify: `packages/core/src/provider-cycle-engine.ts`
- Modify: `packages/core/src/provider-engine.ts`
- Modify: `packages/core/test/provider-cycle-engine.test.ts`
- Modify: `packages/core/test/core.test.ts`
- Modify as evidence requires: `packages/providers/src/vidking/direct.ts`
- Modify as evidence requires: `packages/providers/test/providers.test.ts`

- [ ] Change the existing offline cycle test first: after a classified offline/network-unavailable result, no second local candidate is attempted.
- [ ] Add a typed stop reason such as `network-offline` or equivalent evidence field, propagated into resolve diagnostics.
- [ ] Test that global provider fallback also terminates for classified offline network and does not treat that result as provider failure.
- [ ] Add deterministic request-count coverage for nested retry behavior, especially VidKing; make the total maximum explicit and reduce duplicated outer/inner retries only if the test demonstrates multiplication.
- [ ] Preserve retry behavior for retryable provider/source failures where network is healthy.
- [ ] Run:

```sh
bun run --cwd packages/core test
bun run --cwd packages/providers test
```

### Task 5: Record Scoped Health Without Poisoning It

**Files:**

- Create: `apps/cli/src/services/playback/ProviderHealthEvidence.ts`
- Create: `apps/cli/test/unit/services/playback/provider-health-evidence.test.ts`
- Modify: `apps/cli/src/services/playback/TitleProviderHealthService.ts`
- Modify: `packages/storage/src/repositories/title-provider-health.ts`
- Modify: `apps/cli/test/unit/services/playback/title-provider-health-service.test.ts`
- Modify as needed: storage repository unit tests

- [ ] Write the classifier tests first for successful playback, provider/source dead-stream, provider timeout, parse/no-streams, offline network, cancellation, manual diagnostic, and cache recovery.
- [ ] Represent health scope as provider + title + optional source/server + error class + TTL, with network-confidence evidence.
- [ ] Expand the existing JSON record additively; do not create a destructive table migration for nested evidence fields.
- [ ] Skip negative health writes for offline/flaky-network classification, cancellation, and manual diagnostic paths.
- [ ] Preserve healing semantics with successful playable evidence and expiration behavior.
- [ ] Run `bun run --cwd apps/cli test:unit`.

### Task 6: Replace Vague UI State With Classified Truth

**Files:**

- Create: `apps/cli/src/app/provider-resolve-user-state.ts`
- Create: `apps/cli/test/unit/app/provider-resolve-user-state.test.ts`
- Modify: `apps/cli/src/app/provider-resolve-copy.ts`
- Modify: `apps/cli/src/app-shell/loading-shell-runtime.ts`
- Modify: `apps/cli/src/app-shell/playback-recovery-view-model.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: matching existing UI unit tests

- [ ] Implement one pure mapper from ledger/progress/final outcome to these states: `Slow source`, `Trying another source`, `Using cached source`, `Provider issue for this title`, `Network looks unstable`, `No playable source found`.
- [ ] Change tests that currently assert generic `Provider degraded` text to classified outcomes supported by evidence.
- [ ] Keep source, quality, and subtitle presentation grounded in cached inventory or confirmed playable output; no unavailable promises.
- [ ] Confirm manual next remains user-intent episode advance and never becomes automatic fallback control.
- [ ] Run `bun run --cwd apps/cli test:unit`.

### Task 7: Preserve And Surface Provider Richness Already Paid For

**Files:**

- Modify selectively: `packages/providers/src/shared/source-inventory.ts`
- Modify selectively: `packages/providers/src/vidking/direct.ts`
- Modify selectively: `packages/providers/src/rivestream/direct.ts`
- Modify selectively: `packages/providers/src/miruro/direct.ts`
- Modify selectively: `packages/providers/src/allmanga/direct.ts`
- Modify: `packages/providers/test/providers.test.ts`
- Modify: `packages/providers/test/allmanga.test.ts`
- Modify as needed: `apps/cli/test/unit/app/source-quality.test.ts`

- [ ] Inventory all already-received facts used for user value: servers/sources, variants/quality, subtitle tracks/language/flavor, audio/sub/dub mode, thumbnail and intro/outro/timing hints, provider evidence.
- [ ] Normalize only facts already present in resolved payloads or already required requests; this task must not introduce extra requests merely to enrich presentation.
- [ ] Ensure stable source/server identifiers and presentation facts survive into inventory and diagnostics.
- [ ] Retain AllManga/ani-cli parity; do not alter crypto, endpoints, or decoding constants without a separate parity investigation.
- [ ] Add fixture tests showing which facts survive into result/inventory and which lane owns them.
- [ ] Run:

```sh
bun run --cwd packages/providers test
bun run --cwd apps/cli test:unit
```

### Task 8: Export A Redacted Attempt Graph

**Files:**

- Create: `apps/cli/src/services/diagnostics/resolve-work-insight.ts`
- Modify: `apps/cli/src/services/diagnostics/support-bundle.ts`
- Modify: `apps/cli/src/services/diagnostics/operation-taxonomy.ts`
- Modify: diagnostics redaction utilities if existing typed filters require extension
- Modify: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- Modify: matching operation/redaction unit tests

- [ ] Convert the local ledger into a support-bundle insight containing attempt graph, cache provenance, source inventory summary, stream health decision, fallback path, timings, request counts, and health-write/skip reasons.
- [ ] Prove redaction excludes playable URLs, subtitles URLs, headers, cookies, tokens, paths, and raw future telemetry identifiers.
- [ ] Preserve one graph per physical work item while noting joined lanes/consumers.
- [ ] Run `bun run --cwd apps/cli test:unit`.

### Task 9: Integration Gates And Documentation Truth

**Files:**

- Modify: `.docs/providers.md`
- Modify: `.docs/diagnostics-guide.md`
- Modify: `.docs/playback-source-inventory-contract.md`
- Modify: `.plans/provider-engine-behavior-audit.md`
- Modify: `.plans/plan-implementation-truth.md`

- [ ] Add or adjust deterministic integration tests covering: fresh-cache playback, selected inventory candidate, identical prefetch/foreground join, fallback after real provider failure, offline short-circuit, health skip/write, classified UI state, and support export.
- [ ] Document the implemented request economy, work key/ledger, source inventory facts, offline circuit behavior, health scope, and diagnostic export contract.
- [ ] Update truth-index status only for behavior actually landed and verified.
- [ ] Run the deterministic gate:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

- [ ] Record live smoke as intentionally not run; seek approval separately only if release validation later needs a provider-network check.

## Deferred Extension Track

### Task 10: Define A Privacy-Safe Aggregate Health Contract

**Do not execute during the release-critical local implementation unless separately approved.**

**Files:**

- Create: `packages/types/src/provider-health-intelligence.ts`
- Modify: `packages/types/src/index.ts`
- Create: corresponding type/serialization tests
- Modify: `.docs/diagnostics-guide.md`

- [ ] Define coarse redacted signal and advisory hint types only: provider id, stable non-reversible source/server grouping, coarse region, error class, latency bucket, success/failure, coarse timestamp bucket, runtime version, cache provenance.
- [ ] Exclude raw title identifiers by default; exclude URLs, IP addresses, user/session IDs, history, headers, tokens, and freeform evidence.
- [ ] Define opt-in/sampling/retention and signed hint freshness/version fields at the contract level.
- [ ] Do not implement an uploader, Worker, relay, remote fetch, ranking change, uptime chart, or leaderboard.

### Task 11: Evaluate Optional Advisory Hint Consumption

**Do not execute without a product/privacy review and a real threat model.**

- [ ] Design a cached signed hint consumer that can influence ordering only softly and never override local playable truth, fresh cache trust, user provider choice, or local offline evidence.
- [ ] Specify poison resistance, minimum cohort thresholds, regional aggregation, stale-hint fallback, transparency copy, and disable switch.
- [ ] Require privacy review and live-service approval before implementation.

## Principal-Level Completion Criteria

- [ ] One identical physical resolve produces one provider path, one ledger, and one diagnostics graph regardless of joining consumers.
- [ ] Fresh cache and inspection-only interactions prove zero network/provider calls in tests.
- [ ] Cache validation and provider attempts are attributable to a budget lane and user intent.
- [ ] Offline/flaky network terminates cycling early and cannot damage provider health.
- [ ] Local health evidence is scoped enough to avoid blaming an entire provider for a title/source-specific failure.
- [ ] Rich provider facts already received are retained for source/quality/subtitle/timing presentation and diagnostics without enrichment fetches.
- [ ] UI state tells the truth about cache, fallback, title-local provider issues, and network instability.
- [ ] Support exports make request economy and fallback behavior inspectable while remaining redacted.
- [ ] Future multi-user intelligence is possible through typed local evidence but has no hidden network behavior in the local-first release.

## Execution Recommendation

Implement Tasks 1-3 first as the foundation slice. Those tasks prove the hardest invariant: a user action, prefetch, cache decision, and provider attempt are all attributable without duplicate work. After that foundation is green, Tasks 4-8 can land independently behind deterministic tests, and Task 9 closes the truth/documentation loop. Keep Tasks 10-11 deferred until there is explicit approval for privacy and external-service design.
