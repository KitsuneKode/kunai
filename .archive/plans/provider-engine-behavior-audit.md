# Provider Engine Behavior Audit

Status: implemented in local-first slices; one approval-gated provider smoke run on 2026-05-25

Date: 2026-05-24

## Goal

Audit the current provider-engine behavior against the locked playback/provider policy and define the next implementation slices. This is a behavior design/spec, not an implementation pass.

## Locked Policy Baseline

- No routine live provider calls. Live provider smoke remains manual and approval-gated.
- Separate provider data lanes: playable truth, catalog truth, presentation hints, diagnostics evidence.
- Inventory broadly, resolve narrowly.
- Provider-local source/server cycling is distinct from global provider fallback.
- Manual next means next episode, not silent control hijack.
- Near-EOF prefetch starts around 90-95 percent, or credits-aware, only when exact intent matches and cache/in-flight work is deduped.
- No per-frame or per-keystroke provider/cache work.
- Every provider action has a budget lane: user-blocking, near-need, background, manual-diagnostic.
- Use a `ResolveWorkKey` to dedupe in-flight resolves.
- Trust fresh stream cache by policy; validate stale, fragile, dead, recovery, and near-handoff streams.
- Stop provider cycling early on flaky/offline network and do not poison provider health.
- Provider health is scoped by provider, title, source/server, error class, and TTL.
- UI copy should use classified states instead of vague degraded state.
- Diagnostics/export should expose provider attempt graph, cache provenance, source inventory, stream health, fallback path, timings, and redacted evidence.

## Current Architecture Map

The current provider path is already close to the intended shape:

```text
PlaybackPhase
  -> PlaybackResolveCoordinator
  -> PlaybackResolveService
  -> SourceInventoryService / stream cache / StreamHealthService
  -> ProviderEngine.resolveWithFallback
  -> provider module resolve
  -> optional runProviderCycle inside provider
  -> ProviderResolveResult
  -> providerResolveResultToStreamInfo
  -> PersistentMpvSession
```

Key owners:

- `packages/core/src/provider-engine.ts`: global provider timeout, retry, fallback, offline stop.
- `packages/core/src/provider-cycle-engine.ts`: provider-local candidate/source cycling.
- `packages/types/src/index.ts` and `packages/types/src/provider-cycle.ts`: provider result, stream/source/variant, health, trace, and cycle contracts.
- `packages/providers/src/shared/source-inventory.ts`: stable source/stream/variant IDs and normalized source/language evidence.
- `apps/cli/src/services/playback/PlaybackResolveService.ts`: cache, source inventory, stream validation, provider fallback, stream persistence, broad provider health, title/provider health handoff.
- `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`: diagnostics event bridge and provenance classification.
- `apps/cli/src/services/playback/SourceInventoryService.ts`: persisted provider inventory cache.
- `apps/cli/src/app/episode-prefetch.ts`: exact-match next-episode prefetch handle and wait budget policy.
- `apps/cli/src/infra/player/PersistentMpvSession.ts`: persistent mpv, same-URL reconnect, near-EOF callback, playback telemetry.

## Provider Data Classification

Use four lanes consistently:

| Lane                 | Current examples                                                          | Owner                                           | Policy                                                         |
| -------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Playable truth       | `StreamCandidate.url`, headers, cache TTL, selected stream                | provider result + playback resolver             | Can start playback; must be cached/validated by stream policy. |
| Catalog truth        | title IDs, episode lists, release facts, MAL/AniList/TMDB IDs             | catalog/search/provider list endpoints          | Must not be inferred from playable stream success alone.       |
| Presentation hints   | source labels, quality labels, language labels, hard-sub/soft-sub display | provider inventory projection                   | May be incomplete; never lie as normalized language.           |
| Diagnostics evidence | trace events, failures, source evidence, cache provenance, health checks  | provider modules + resolver + diagnostics store | Redacted, structured, and enough to explain fallback.          |

Audit result:

- The type model supports the separation.
- VidKing/RiveStream use shared source-inventory helpers.
- Miruro and AllManga preserve anime sub/dub/hardsub facts but still use some hand-rolled IDs and source objects.
- Diagnostics are stronger at the resolver layer than inside some provider failure paths.

## Work Budget Lanes

Current lanes exist but are not explicit on every provider action.

| Lane              | Current coverage                                                            | Gap                                                                                         |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| User-blocking     | foreground `PlaybackResolveCoordinator.resolve`                             | No typed budget passed into provider engine/result diagnostics.                             |
| Near-need         | near-EOF `EpisodePrefetchHandle` and `next-episode-prefetch` scheduler lane | Prefetch bypasses diagnostics service in `resolveEpisodePrefetchBundle`; progress is local. |
| Background        | recommendation warming, maintenance, offline runway                         | Provider availability/background health sync must remain opt-in/manual until budgeted.      |
| Manual-diagnostic | live smoke scripts and debug commands                                       | Should stay outside routine gates.                                                          |

Spec:

- Add a `ResolveBudgetLane` concept at the app boundary before provider work.
- Persist it only as diagnostics context first.
- Do not change provider behavior until the lane has tests proving no new live/provider fan-out.

## Network Request Economy

Policy: every provider/catalog/network call must be either necessary now, near-need, explicitly background-budgeted, or manually diagnostic. The best backend feel is not "try everything"; it is "reuse what we know, fetch exactly what is missing, and keep the user moving."

Current strengths:

- Exact stream cache is checked before provider resolve.
- Source inventory cache is checked before provider resolve and validated before promotion.
- `EpisodePrefetchHandle` avoids duplicate next-episode prefetch for one exact target.
- `BackgroundWorkScheduler` dedupes queued background work by id.
- Catalog/release/history paths have cache-first helpers in other services.
- Miruro and AllManga maintain provider-local short TTL caches for repeated episode/source data.

Redundant-call risks:

- Foreground resolve, near-EOF prefetch, auto-next handoff, recover/refresh, and source/quality restarts can overlap without a shared resolve in-flight map.
- ProviderEngine outer retries plus provider-internal query/source/candidate loops can multiply upstream requests.
- Source inventory and stream cache are separate; a miss in one lane can still trigger provider work if the other lane is not checked with the exact same key policy.
- Provider-local source cycling does not yet expose enough live progress to let foreground work join or wait intelligently.
- Some UI actions may feel cache-backed, but without a `ResolveWorkKey` they can still create parallel equivalent work.

Hard rules for implementation:

- No provider call from render, keypress movement, list focus, or display preference toggles.
- Source/quality/subtitle pickers read cached inventory only; resolving happens only after an explicit selection that needs a playable stream.
- Alias/title-display changes are pure projection over catalog/search data.
- Fresh exact cache hit returns without validation or provider calls.
- Source inventory hit validates only the selected playable stream, not every discovered stream.
- Near-EOF prefetch is one immediate next episode, not a watchlist warmup.
- Background work must have a stable id, lane, cancellation signal, and diagnostics reason.
- Live provider smoke stays manual; deterministic tests use fake providers and synthetic fetchers.

Acceptance tests to add later:

- Same `ResolveWorkKey` resolves join one provider call across foreground and prefetch.
- Source picker open/move/close performs zero provider calls.
- Quality picker over full inventory performs zero provider calls until explicit selection.
- Fresh exact stream cache performs zero stream-health calls and zero provider calls.
- Source inventory hit validates only one selected stream.
- Recover/refresh bypasses stale joined work but does not fan out to unrelated providers.
- Offline/flaky network aborts provider cycling without recording provider poison.

## Provider Capability Utilization And Richness

Goal: use the useful things providers expose instead of collapsing everything into "one URL". A rich user experience depends on the backend preserving all provider facts that are cheap or already discovered.

Current provider utilization:

| Provider   | Uses today                                                                                                                                                        | Underused or risky                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VidKing    | Multiple Videasy servers, embed-referer fallback, decrypted source payload, subtitles, quality labels, source evidence, provider-local server cooldown.           | Retry/query loops can multiply calls; server health is in-memory and not joined with title/source health; source cycle progress is not surfaced richly enough to UI.                         |
| RiveStream | Provider services list, per-service source cycling, quality variants, embedded captions, language/source evidence.                                                | Service IDs use hand-built source IDs; all services may be cycled user-blocking unless bounded by inventory/health; fallback progress needs better diagnostics.                              |
| Miruro     | Episode cache, source cache, sub/dub categories, Kiwi/Bee source profiles, hard-sub vs soft-sub evidence, thumbnails/seekbar artwork, intro/outro payload fields. | Intro/outro provider timing is not yet integrated as timing metadata; source IDs are hand-rolled; source cache is provider-local rather than visible in diagnostics/source-inventory policy. |
| AllManga   | Search/list episode catalog, sub/dub availability, GraphQL/AES source extraction, HLS/MP4 candidates, hard-sub/soft-sub evidence, external AniList/MAL IDs.       | Ani-cli parity code should stay protected; helper migration should not flatten anime hierarchy; failures often return without full accumulated events/failures.                              |

Richness rules:

- Preserve all discovered playable streams, sources, variants, subtitles, language facts, hard-sub facts, headers, expiry hints, artwork, release facts, and external IDs.
- Do not fetch a second endpoint just to make UI richer unless that endpoint is budgeted and cacheable.
- If a provider already returns thumbnails, intro/outro, captions, or source labels in the resolve payload, store/project them.
- If a provider needs another expensive call for quality/source details, represent that as deferred/unknown rather than probing everything eagerly.
- Provider-native labels stay in evidence; normalized public fields stay strict.
- Diagnostics should show the rich tree even when the primary UI simplifies it.

Backend "love this" target:

- Fast path: existing data makes the app feel instant.
- Rich path: when a provider exposes more, controls feel real: source, quality, audio, hardsub, soft subtitle, timing, artwork, and recovery choices are grounded in actual inventory.
- Honest path: when data is missing, the UI says unknown/not found/using cached/trying another source instead of pretending.
- Recovery path: when a stream dies, Kunai knows which source/provider/title failed and can choose the next best action without thrashing.

## ResolveWorkKey And In-Flight Dedupe

Current state:

- `EpisodePrefetchHandle` dedupes one next-episode prefetch by exact target.
- `BackgroundWorkScheduler` dedupes queued jobs by `id`.
- Miruro and AllManga have provider-local short TTL caches for episode/source data.
- There is no shared in-flight dedupe around `PlaybackResolveCoordinator.resolve` / `PlaybackResolveService.resolve`.

Risk:

- Foreground manual `N`, near-EOF prefetch, auto-next handoff, recover/refresh, and source picker restarts can overlap and issue duplicate provider resolves for the same effective intent.
- This is the main missing policy item.

Spec:

```text
ResolveWorkKey =
  intentKind
  providerId
  mediaKind
  titleId
  season / episode / absoluteEpisode
  audioPreference
  subtitlePreference
  qualityPreference
  selectedSourceId
  selectedStreamId
  freshnessPolicy
  runtimeClass
```

Rules:

- Exact same key joins the existing promise.
- `refresh` and `recover` use a fresh key and bypass stale work.
- Hard cancellation from title/episode change, quit, or shutdown aborts and discards.
- Soft abandon from fallback/user navigation can persist cache-safe full inventory but must not mutate current playback.
- `budgetLane` is ledger/dispatch metadata, not a key component: the same playable work must be able to join across near-need and user-blocking callers.
- A user-blocking caller can promote ownership of an exact near-need in-flight resolve for handoff/wait policy without issuing a duplicate provider call.
- Background or manual-diagnostic work never joins playback-critical work merely because its title/episode matches; its `intentKind` and freshness policy must remain distinct.

## ResolveWorkLedger

The `ResolveWorkKey` prevents duplicate work. The `ResolveWorkLedger` proves what happened. This is the missing audit surface that turns backend feel into something testable instead of vibes.

Shape:

```text
ResolveWorkLedger
  identity:
    resolveWorkKey
    playbackCycleId
    providerAttemptId
    initiatingBudgetLane
    joinedBudgetLanes
    intentKind
  cache:
    exactStreamCacheChecked
    exactStreamCacheOutcome
    sourceInventoryChecked
    sourceInventoryOutcome
    cacheProvenance
  network:
    providerCallCount
    providerCalls[{ providerId, reason, budgetLane, attempt, durationBucket }]
    streamHealthCheckCount
    catalogCallCount
  provider:
    providerLocalCandidatesTried
    selectedSourceId
    selectedStreamId
    globalFallbackPath
    failureClasses
  richness:
    streamCount
    sourceCount
    variantCount
    subtitleCount
    audioLanguages
    hardSubLanguages
    artworkFacts
    timingFacts
    externalIds
  health:
    healthWrites
    skippedHealthWrites
    networkConfidence
  userState:
    finalCopyClass
    finalOutcome
```

Rules:

- The ledger is local-only and redacted by default.
- Tests assert ledger facts before UI claims are trusted.
- The ledger records skipped work as deliberately as performed work.
- The ledger records which lane initiated work and which later lanes joined it, while the work key stays stable for identical stream intent.
- Provider/call counters use fake providers and synthetic fetchers in deterministic tests.
- The future aggregate health contract can derive from the ledger, but the ledger itself is local playback truth.

Golden scenarios:

- Fresh cache hit: exact stream cache checked, zero provider calls, zero stream-health calls, final copy `Using cached source`.
- Source inventory hit: source inventory checked, zero provider calls, one selected-stream health validation, selected stream promoted.
- Foreground plus near-EOF same intent: one provider resolve, joined by exact `ResolveWorkKey`.
- Refresh: bypass stale joined work, fresh provider attempt allowed, cached stream preserved if fresh source fails.
- Recover: invalidates current stale/dead evidence, resolves fresh, does not reuse stale joined work.
- Provider-local source failure: ledger shows source A failed, source B tried, global provider fallback not started until local candidates exhaust.
- Offline/flaky network: provider cycling stops early, health write skipped with network-confidence reason.
- Rich provider payload: all discovered streams/sources/subtitles/timing/artwork/external IDs are counted and projected without extra network calls.

## Cache Trust And Validation Matrix

Current behavior:

- Fresh stream cache can be trusted without validation.
- Forced or stale health checks go through `StreamHealthService`.
- Source inventory reuse validates before promotion into exact stream cache.
- Recovery can delete the current exact stream cache; refresh can preserve a cached stream if fresh lookup fails.
- Persistent mpv skips preflight for streams cached within five minutes, and preflights older replacement streams before `loadfile` failure handling.

Matrix:

| Source                   | Trust policy                                  | Current status     | Required slice                                                           |
| ------------------------ | --------------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| Fresh exact stream cache | Trust by policy                               | Implemented        | Keep diagnostics copy as `Using cached source`.                          |
| Stale exact stream cache | Validate before use                           | Implemented        | Ensure validation failures feed title/source health when definitive.     |
| Source inventory cache   | Validate selected stream before promoting     | Implemented        | Include selected source/server in health scope.                          |
| Prefetched stream        | Exact intent match required                   | Mostly implemented | Add `ResolveWorkKey` and subtitle preference handling to the match rule. |
| Recover                  | Fresh evidence                                | Mostly implemented | Bypass joined stale work and record cache invalidation cause.            |
| Refresh                  | Prefer fresh, preserve current if fresh fails | Implemented        | Classify copy as `Using cached source`, not generic recovery.            |
| Near-handoff             | Validate if freshness matters                 | Partial            | Make near-handoff validation explicit in diagnostics.                    |
| Dead/premature EOF       | Invalidate and refetch                        | Partial            | Ensure all dead-stream evidence links to stream/source/provider health.  |

## Provider-Local Cycling Vs Global Fallback

Current behavior:

- `ProviderEngine.resolveWithFallback` owns global provider fallback.
- `runProviderCycle` owns provider-local source/server candidate cycling.
- VidKing, RiveStream, Miruro, and AllManga all use `runProviderCycle` in some form.
- VidKing also has a provider-local `HealthTracker` cooldown for servers.

Gaps:

- Provider cycle events are appended, but not all provider paths carry failures/source candidates into exhausted results equally. Some catch blocks return `createExhaustedResult` without the accumulated events/failures.
- `ProviderEngine` has `maxAttempts` around the whole provider module. Some providers also loop internally. This can multiply calls in ways that are hard to reason about.
- RiveStream maps provider service names into `source:${provider}:${server}` rather than the shared stable ID helper.

Rules:

- Provider-local cycling exhausts current provider sources before global fallback.
- Global fallback starts only after current provider is exhausted, explicitly skipped, or policy-unhealthy.
- Provider module retry loops should be bounded and visible as cycle attempts or provider trace events.
- Avoid double retry multiplication: either provider-local retry is specific and small, or `ProviderEngine` retry is the only outer retry.

## Circuit Breaker And Health Scope

Current behavior:

- `ProviderEngine` stops fallback on offline-looking network failure.
- `ProviderEngine` broad health is provider-only and marks down after consecutive health deltas.
- `TitleProviderHealthService` persists title/provider failure with TTL and healing.
- `TitleProviderHealthService` records `timeout`, `no-streams`, `dead-stream`, and `parse`.

Gaps:

- The locked health scope includes provider + title + source/server + error class + TTL. Current title health is title/provider only; broad provider health is provider only.
- Offline/flaky network detection prevents fallback poisoning in `ProviderEngine`, but title/provider health recording can still classify a primary timeout/no-stream if the engine attempt shape does not preserve "local network unstable" as a first-class non-countable outcome.
- Source/server health is provider-local for VidKing only and in-memory.

Spec:

- Add a `ProviderHealthEvidence` classifier before writing title/provider health.
- Scope stored evidence by:
  - `providerId`
  - `titleId`
  - optional `sourceId`
  - optional `serverId`
  - `failureClass`
  - `networkConfidence`
  - `expiresAt`
- Do not count user cancel, local offline, title unreleased, manual provider/source/quality changes, subtitle-only missing, slow success, or cache hit skipped provider.
- Two clean successes heal warnings; severe parse/schema failures may retain longer TTL.

## Prefetch And Auto-Next Lifecycle

Current behavior:

- Near-EOF trigger is credits-aware or fallback `max(duration - 180s, min(duration - 60s, duration * 0.9))`.
- `EpisodePrefetchHandle` dedupes one exact target and aborts superseded generation.
- Manual next and auto-next use exact target matching.
- Default wait is three seconds and extends to eight seconds only with progress evidence.
- Timing metadata can be resolved separately and does not block playback.

Gaps:

- `matchesEpisodePrefetchTarget` ignores `subtitlePreference` intentionally in the boolean expression and handles subtitle mismatch only in `takeReadyFor`; the locked policy says exact intent matches, with soft subtitle changes allowed to keep video while marking subtitle prep stale. This should be documented in code/tests as a two-level match, not hidden in one function name.
- Prefetch resolve progress detects fallback by `attempt > 1`, but `PlaybackResolveEvent.attempt` does not appear to be emitted by `PlaybackResolveService`; global fallback progress may not extend handoff wait as intended.
- Prefetch does not route diagnostics through `PlaybackResolveCoordinator`'s diagnostics dependency, so cache/source/fallback events are less visible in support bundles.

Spec:

- Rename/extend matching into:
  - `matchesVideoPrefetchTarget`
  - `matchesPreparedPrefetchTarget`
- Add tests for subtitle-only mismatch: reuse video, mark `prepared: false`.
- Emit explicit fallback-started/progress events from provider timeline or resolve service so wait budget evidence is real.
- Carry diagnostics correlation into prefetch resolve.

## Flaky Network And Sleep/Resume Behavior

Current behavior:

- Offline-like failures stop fallback in the core provider engine.
- Candidate cycle treats offline messages as non-retryable candidate network failures.
- Persistent mpv has in-process same-URL reconnect for dead network reads and premature EOF.
- Stale streams can be validated before use.

Gaps:

- Flaky/offline is message-classified, not a first-class network state shared with recovery policy.
- Sleep/resume is handled by validation/reconnect side effects, but there is no explicit "machine resumed, treat stream cache fragile" policy.
- Provider health can still receive broad health deltas from provider results without network confidence.

Spec:

- Introduce a local `NetworkStabilitySnapshot` consumed by recovery/health classification first, even if backed only by recent diagnostics.
- Mark cache entries fragile after sleep/resume or network-interface change once such signals exist.
- Do not add active network probes in the provider path without manual approval.

## UI State Grammar

Current behavior:

- Some good copy exists: `Trying the next compatible provider`, `Preparing next episode`, `No fresher source found. Continuing current stream.`
- Old/generic copy remains: `Resolving provider stream`, `Cached stream expired`, `Provider/CDN may be degraded`, `Provider degraded`.

Required state grammar:

| State                           | Trigger                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| `Slow source`                   | user-blocking resolve exceeds expected latency but no failure evidence yet. |
| `Trying another source`         | provider-local cycle advances source/server.                                |
| `Using cached source`           | fresh cache hit or preserved cached stream after failed refresh.            |
| `Provider issue for this title` | title/provider health warning with fallback evidence.                       |
| `Network looks unstable`        | local/offline network confidence, no provider poisoning.                    |
| `No playable source found`      | all eligible provider/source work exhausted.                                |

Spec:

- Build a pure `ProviderResolveUserState` mapper from cache events, provider timeline, stream-health result, and health evidence.
- Replace vague `degraded` copy at playback recovery/loading surfaces.
- Keep raw failure details in diagnostics, not primary UI copy.

## UX Truthfulness Gaps

- Resolving/loading: still too generic during source cycle; users cannot tell provider-local source cycling from global provider fallback.
- Source/quality: projection is strong, but changing a source/stream can still look like a generic restart instead of `Trying another source`.
- Subtitle: subtitle-only changes are mostly attach/reuse behavior, but prefetch matching should explicitly state when only subtitle prep is stale.
- Auto-next: policy is mostly implemented, but diagnostics should state whether auto-next used prefetch, cache, source inventory, or foreground resolve.
- History: no major provider-engine gap found in this pass; risk is stale provider/source facts in history display if projection lacks cache provenance.
- Diagnostics: support bundle taxonomy exists, but provider attempt graph should include provider-local source attempts, source inventory hit/miss, stream-health validation result, fallback path, and timing readiness in one joined view.

## Diagnostics Graph And Export Requirements

Required graph nodes:

- resolve work key
- budget lane
- cache decision
- source inventory decision
- provider attempt
- provider-local source/server candidate attempt
- stream-health validation
- selected stream and source IDs
- fallback transition
- title/provider/source health write or skipped write
- timing readiness
- subtitle readiness
- mpv preflight/reconnect/dead-stream evidence

Required redaction:

- stream URLs, auth headers, cookies, tokens, signatures, private home paths.
- Preserve host/path shape and source/server labels where safe.

Implementation rule:

- First add graph/export tests with synthetic provider events.
- Do not require live providers to validate diagnostics shape.

## Future Aggregate Health Intelligence

This is a future extension seam, not a current dependency. Kunai should stay seamless and deterministic locally first; cloud or multi-user intelligence may later improve ranking, charts, diagnostics, and support copy, but playback must never require it.

Principle:

```text
local truth first
  -> optional redacted aggregate hints later
  -> hints improve ranking/explanation
  -> hints never block local playback
```

Recommended future architecture:

```text
Local ResolveWorkLedger
  -> LocalHealthEvidence classifier
  -> Local diagnostics/support bundle
  -> optional RedactedHealthSignal
  -> Cloudflare Worker / lightweight relay
  -> aggregate regional provider/source health
  -> signed/cacheable ProviderHealthHint feed
  -> local resolver uses hints as soft ranking input
```

Local-first contract now:

- Build the local ledger, health classifier, cache policy, and diagnostics graph as if they may later produce redacted aggregate signals.
- Keep local playback fully functional when offline, when the future relay is down, or when telemetry is disabled.
- Treat aggregate hints as advisory only. They can change ordering, copy, and diagnostics explanation; they cannot remove user choice or hard-block a provider.
- Store user preferences and title-scoped decisions locally. Do not let cloud hints mutate provider config automatically.

Privacy contract for any future aggregate signal:

- Never send stream URLs, subtitle URLs, auth headers, cookies, tokens, signatures, local paths, raw watch history, or raw user identifiers.
- Do not send raw title IDs by default. If title-level aggregation is ever needed, require a separate design review and use coarse/bucketed or salted privacy-preserving keys.
- Allowed future signal fields should be coarse and non-identifying:
  - app version bucket
  - provider id
  - source/server id hash
  - media kind
  - coarse region bucket
  - error class
  - latency bucket
  - success/failure outcome
  - timestamp bucket
  - runtime class
  - cache provenance class
- Use sampling, rate limits, and local opt-in/opt-out controls.
- Keep support bundles local unless the user explicitly exports or shares them.

Future Worker responsibilities:

- Accept only versioned `RedactedHealthSignal` payloads.
- Reject payloads containing URL-like strings, token-like keys, raw headers, or high-cardinality identifiers.
- Aggregate by provider/source/error/region/time bucket.
- Publish compact `ProviderHealthHint` snapshots with TTLs.
- Sign or version hint snapshots so clients can cache safely and ignore stale or incompatible data.
- Provide public status/uptime summaries without exposing individual user behavior.

Client use of future hints:

- Feed hints into provider/source ranking only after local cache and exact user intent are considered.
- Prefer a locally successful provider/source over a remote aggregate warning for the current title.
- Use hints to explain: `Provider issue for this region`, `Source looks unhealthy today`, or `Many users are seeing this failure`.
- Keep manual provider/source selection available even when hints say a source is unhealthy.
- Never fetch the hint feed during render, keypress movement, or blocking playback unless a cached hint is already available.

Why this matters later:

- Multi-user aggregation is what makes region-aware provider health, uptime charts, provider/source leaderboards, and maintainer prioritization meaningful.
- Local-only health can say "this failed for me"; aggregate health can say "this provider/source is broadly failing in this region."
- The point is better user control and better support: explain whether the issue is likely provider-side, source-side, local network, title-specific, unreleased content, or app regression.

Do not build yet:

- Do not add a Worker, telemetry endpoint, account identity, or automatic upload in the provider-engine cleanup slice.
- Do not make cloud hints part of the deterministic gate.
- Do not add routine live provider probes to populate charts.
- Do not add a "leaderboard" until the local event taxonomy is trustworthy and privacy rules are reviewed.

## Antipatterns And Risks Found

1. Missing shared in-flight resolve dedupe.
   - `EpisodePrefetchHandle` dedupes only one prefetch target; foreground resolver work can still duplicate provider calls.

2. Retry multiplication risk.
   - `ProviderEngine` has outer attempts, and providers have internal loops/cycles. VidKing also uses query variants and per-query attempts from context retry policy.

3. Provider event/failure loss on some exhausted paths.
   - Some provider catch/exhausted returns do not pass accumulated `cachePolicy`, `events`, `failures`, or `startedAt`.

4. Health scope is too broad.
   - Title/provider health lacks source/server and network-confidence dimensions.

5. Fallback progress may not drive handoff wait.
   - Prefetch waits look for `event.type === "attempt" && attempt > 1`, but the current resolver path mainly emits cache/recovery events and provider timeline after resolution.

6. UI copy still has vague degraded language.
   - Loading and recovery surfaces should use classified copy.

7. Provider source inventory helper migration is uneven.
   - VidKing/RiveStream use shared helpers more consistently than Miruro/AllManga; migrate carefully without flattening anime hierarchy.

8. Diagnostics graph is not unified enough.
   - Resolver, provider cycle, source inventory, stream health, timing, and mpv reconnect exist, but need a joined export view keyed by correlation/work key.

9. Provider richness is not harvested uniformly.
   - Providers expose useful facts beyond the winning URL, but timing, artwork, subtitle, source, language, and source-health facts are not always normalized, cached, projected, or diagnosed consistently.

10. Network request budgets are implicit.

- The code has several cache-first pieces, but there is no explicit proof that every provider/catalog call belongs to a user-blocking, near-need, background, or manual-diagnostic lane.

11. Future aggregate health can become a privacy or reliability trap if not shaped now.

- The local event/ledger contracts should be versioned and redaction-friendly, but cloud intelligence must remain optional, aggregate-only, and advisory.

12. There is no formal work ledger yet.

- Without a ledger, we cannot prove which calls were avoided, which facts were harvested, or which user-facing state was justified.

## Implementation Slices After Review

### Slice 1: ResolveWorkKey, Work Ledger, And In-Flight Dedupe

- Add pure key builder and tests.
- Add local `ResolveWorkLedger` model and deterministic fake-provider counters.
- Add in-flight registry around `PlaybackResolveCoordinator` or a small app service above it.
- Test same-key joins, refresh/recover bypass, hard abort discard, soft abandon cache-safe persistence, and ledger proof for zero redundant calls.

### Slice 2: Budget Lane Plumbing

- Add `ResolveBudgetLane` to playback resolve input.
- Thread lane into diagnostics only.
- Prove no behavior change with unit tests.

### Slice 3: Cache Validation Matrix Tests

- Add tests for fresh cache trust, stale cache validation, source inventory validation, refresh cached fallback, recover invalidation, near-handoff validation.
- Keep live providers out of the suite.

### Slice 4: Provider Timeline Event Completion

- Emit source cycle/fallback progress in a way prefetch wait can observe before final resolution.
- Ensure exhausted provider results preserve accumulated events/failures.
- Add synthetic provider-engine tests for local cycle vs global fallback.

### Slice 5: Scoped Health Evidence

- Introduce `ProviderHealthEvidence` and classifier.
- Add source/server/error-class/network-confidence fields to title/provider health storage or a new cache table if migration is cleaner.
- Do not count local offline/user cancel/manual changes.

### Slice 6: UI State Grammar Mapper

- Add pure mapper with the six locked user states.
- Replace vague degraded copy in loading/recovery/provider source surfaces.
- Tests should snapshot copy for cache hit, source cycle, fallback, local network, title provider issue, and final failure.

### Slice 7: Prefetch Match Split And Diagnostics

- Split video-target match from prepared-target match.
- Add subtitle-only stale-prep tests.
- Pass diagnostics correlation into prefetch resolve.
- Verify no provider calls on exact cache/source inventory hit.

### Slice 8: Provider Helper Convergence

- Low-risk migrate Miruro/AllManga IDs/evidence through shared helpers where it preserves anime source hierarchy.
- Keep AllManga ani-cli parity logic untouched unless specifically scoped.
- Add fixture/unit tests for source IDs, presentation, hard-sub, soft-sub, and quality projection.

### Slice 9: Unified Diagnostics Export Graph

- Add graph assembly from existing diagnostics events.
- Include redacted work key, cache provenance, source inventory, stream health, fallback path, provider-local attempts, timings, subtitles, and mpv reconnect/preflight evidence.
- Add export tests with redaction assertions.

### Slice 10: Network Request Economy Tests

- Add deterministic fake-provider counters around foreground resolve, prefetch, source picker, quality picker, cache hit, inventory hit, recover, refresh, and network-offline flows.
- Fail tests on unexpected provider calls, stream-health calls, or catalog calls.
- Add diagnostics assertions that every network call has a budget lane and reason.

### Slice 11: Rich Provider Facts Harvest

- Inventory provider-returned facts that are already available without extra network calls.
- Wire low-risk fields into normalized inventory: Miruro thumbnails/intro/outro evidence, RiveStream provider labels/captions, VidKing source/server evidence, AllManga external IDs and sub/dub/hardsub facts.
- Add projection tests so source, quality, audio, hardsub, soft subtitle, timing, artwork, and diagnostics views use the richest available data without eager probing.

### Slice 12: Future Aggregate Health Contract

- Define versioned local-only types for `RedactedHealthSignal` and `ProviderHealthHint`.
- Add redaction tests that reject URLs, headers, token-like keys, raw title IDs, and high-cardinality user identifiers.
- Do not add network upload. This slice only makes the local ledger future-compatible.

### Slice 13: Optional Hint Consumer

- Add a disabled/offline-safe `ProviderHealthHintProvider` interface that can read a local fixture or cached hint snapshot.
- Use hints only as soft ranking/explanation input after local cache, exact user intent, and local health evidence.
- Add tests proving playback still works and rankings remain deterministic when hints are missing, stale, or disabled.

## Verification Plan

For implementation slices later:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `bun run test`

An approval-gated live provider smoke was run on 2026-05-25 after implementation:
VidKing, Rivestream, and AllManga resolved successfully; Miruro failed as a
classified network error from this environment. Routine live provider smoke
remains excluded, and real mpv playback smoke remains manual.

## Open Policy Questions

No user policy question is blocking this draft. The only review decision is sequencing:

- Recommended first slice: `ResolveWorkKey` plus in-flight dedupe, because it reduces overfetch risk without changing provider scraper behavior.
- Recommended second slice: UI state grammar mapper, because it makes the existing engine behavior more truthful before deeper provider-health migration.
