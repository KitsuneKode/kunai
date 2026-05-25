# Kunai Active Runtime Observability Repair Design

**Status:** Approved design for implementation planning

**Date:** 2026-05-26

**Scope:** Active CLI runtime diagnostics, redacted debug traces, provider/playback/mpv evidence, support export, and diagnostics-panel truthfulness.

## Purpose

Kunai already records useful provider, playback, cache, player, subtitle, presence, download, and runtime facts. The problem is that those facts do not currently travel through one reliable diagnostic path:

- events written through `DiagnosticsService` can reach the in-memory store, structured logger, and JSONL trace reporter;
- many active runtime components write straight to `DiagnosticsStore`, so the same facts can appear in `/diagnostics` or an export while being absent from `--debug-json`;
- some stderr/debug paths log raw URLs outside the redaction boundary;
- provider timing evidence collapses real retries and fallback latency into retrospective summaries;
- completed resolve-work evidence exists as a model but is not available to real exports;
- diagnostics UI can state success where it has no collected evidence.

The repair makes observability dependable enough to explain slow provider resolve, mpv startup, fallback behavior, subtitle timing, cache/reuse decisions, and failures without exposing playback credentials or inventing certainty.

## Goals

- Establish one canonical ingestion path for active-runtime diagnostic evidence.
- Ensure `/diagnostics`, JSONL traces, structured debug logs, and support bundles agree on the events that occurred.
- Redact sensitive URLs, request credentials, and private local paths before diagnostic output leaves the runtime.
- Capture real provider attempt, retry, source-cycle, fallback, playback-startup, subtitle, and mpv timing evidence.
- Preserve correlation across autoplay and persistent-mpv playback.
- Make exported resolve-work evidence usable for identifying redundant work and prefetch joins.
- Present diagnostic status truthfully: known success, known failure, active work, or unknown.
- Keep the implementation incremental and deterministic-testable; live provider and real-mpv checks remain explicit manual validation.

## Non-Goals

- Replacing the existing provider engine or diagnostics system with an external tracing framework.
- Adding routine live-provider traffic to `bun run test`, CI, or commit hooks.
- Recording raw stream URLs, subtitle URLs, authorization headers, cookies, or provider secrets for debugging convenience.
- Treating first observed mpv progress as proof of an exact first rendered audio/video frame.
- Reworking unrelated terminal layout or provider extraction logic except where required to expose correct evidence.

## Current Evidence And Root Causes

The following gaps were confirmed from active code and deterministic test coverage:

1. `DiagnosticsServiceImpl.record()` forwards to logs and JSONL traces, but playback, player, search, downloads, presence, storage and other services often call `DiagnosticsStore.record()` directly. This splits observable truth across output surfaces.
2. `StructuredLogger` serializes context directly to stderr without using diagnostics redaction, and `child()` does not retain bound context. Some player/subtitle logging paths can expose media URLs.
3. Persistent autoplay/mpv event wrapping does not consistently carry playback/provider correlation identifiers, weakening joins for transitions and stalls.
4. Provider resolve timeline summaries are emitted after completion and collapse physical retries or timeout time into a provider-level retrospective result.
5. `PlaybackResolveWorkService` creates useful completed work ledgers, while production export flows do not retain or supply them to support bundles.
6. Subtitle attachment failures and late attachment timeouts do not consistently emit classified outcomes.
7. Recent episode in-memory reuse can lose original provider/source provenance after fallback.
8. The panel lacks compact correlation visibility and can label unavailable download evidence as healthy.
9. Existing redaction covers common values but needs realistic signed-CDN keys and private paths embedded inside error text.

## Architecture

### Canonical Diagnostic Ingestion

Active-runtime evidence flows through one service boundary:

```text
runtime subsystem
  -> DiagnosticsService.record(event)
  -> normalize and redact safe event envelope
  -> bounded DiagnosticsStore
  -> redacted structured debug logger when enabled
  -> redacted JSONL trace reporter when enabled
  -> support bundle and panel projections
```

`DiagnosticsStore` remains a bounded storage primitive. Active application components should depend on a narrow `Pick<DiagnosticsService, "record">` where they emit evidence, not on a raw writable store. Existing read paths can continue to read snapshots from the store/service while migration is staged.

Redaction belongs before any diagnostic output sink. A raw secret must not appear in stderr merely because debug logging was enabled.

### Event Envelope And Correlation

Diagnostic events retain their current fields and consistently populate them when applicable:

- `sessionId`: one CLI process/session;
- `playbackCycleId`: one user-visible title/episode playback attempt;
- `providerAttemptId`: provider-resolution attempt family for the playback cycle;
- `traceId`: provider or lower-level trace identifier;
- `spanId`: a specific timed unit such as one physical provider attempt;
- `category`, `operation`, `level`, `message`, safe context.

The envelope is intentionally small and redacted. It provides joins and timing facts, not raw request replay material.

### Evidence Lanes

Work must be attributable to one lane so foreground slowness is not confused with useful background richness:

- `user-blocking`: playback context, foreground provider resolve, player launch/readiness;
- `near-need`: bounded exact-intent next-episode prefetch;
- `background`: skip metadata, late subtitle enrichment, recommendations, optional inventory;
- `manual-diagnostic`: explicit smoke/export/research actions.

Events that represent work or wait should carry a lane when the owner knows it.

## Provider And Playback Timing Model

The startup timeline already captures foreground playback stages through first observed progress. It remains the top-level user-facing timing summary, but its provider segment gains real evidence from the provider engine boundary.

### Physical Provider Attempts

Each physical provider action should record real timestamps and elapsed time while work is in progress:

```text
provider attempt started
provider attempt succeeded | failed | timed out | cancelled
provider-local retry or source/server transition
global provider fallback started
provider resolve completed
```

The timeline must distinguish:

- initial provider attempt from a retry of the same provider;
- provider-local mirror/server/source cycling from global provider fallback;
- timeout, network failure, blocked/403-style failure, parse failure, empty result, cancellation and success;
- cache/prefetch/recent-memory reuse from fresh network provider work.

Events expose provider/source labels and safe host/provenance information where already available; they do not include raw playable URLs.

### Startup And mpv

Persistent autoplay and one-shot playback must emit correlated player events for:

- launch/load requested;
- IPC connected or readiness failure;
- media materialized when deferred resolution is used;
- first observed playback progress;
- buffering/stall/reconnect classification;
- player completion or failure where relevant to recovery.

The startup timing summary ends at first observed progress. Viewing time and late post-start work do not inflate startup latency.

### Subtitle Delivery

Subtitle richness remains available without blocking playable-first UX. Diagnostics classify subtitle delivery independently:

- available and attached on launch;
- discovered and attached after playback starts;
- no tracks found;
- disabled by user preference;
- late lookup failed;
- player-ready timeout before late attachment;
- `mpv` attach command failed.

This evidence answers whether subtitles affected startup without treating optional delivery as stream failure.

### Reuse And Provenance

Recent-episode reuse, cache reuse, prefetched output and fallback-selected streams retain the provider/source identity that produced the playable candidate. When a reused candidate later fails or is invalidated, evidence attributes the failure to that candidate provenance rather than the currently selected preference.

## Privacy And Output Safety

All diagnostic output sinks use the same redaction policy:

- redact credential-bearing fields such as auth headers, cookies, tokens, signatures and API keys;
- redact signed CDN query parameters including common AWS and CloudFront forms, case-insensitively;
- retain non-sensitive URL host/path shape only where it aids diagnosis;
- redact private home-directory paths even when embedded in an error sentence;
- avoid normal playback output that prints attached subtitle URLs or stream URLs;
- log subtitle attachment state and safe counts/labels instead of locations.

The support bundle, JSONL traces, stderr debug logs and in-memory panel evidence must satisfy the same privacy contract.

## Diagnostics Panel Experience

`/diagnostics` remains a shell panel, but it should read as a focused inspector rather than an undifferentiated log list.

### Primary Summary

The first view shows:

- status for Playback, Provider, Cache, Network, Subtitles, Downloads, Presence and Runtime;
- four truthful tones: healthy, active/informational, needs attention/failed, unknown;
- no `OK` state when the subsystem snapshot was never supplied or no evidence exists.

### Active Playback Evidence

For an active or recent playback cycle, show:

- compact correlation row: session/cycle/provider attempt/trace identifiers;
- startup path with total duration and slowest completed stage;
- provider attempt rows with actual elapsed time, retry/fallback reason and final classification;
- source provenance: selected provider/source/host, fresh/cache/prefetch/reused path and optional features;
- subtitle outcome as its own row;
- mpv/network evidence tied to the active cycle.

### Recent Events

The panel displays recent events grouped or scoped to the active cycle where possible. A developer should be able to identify which exported support evidence corresponds to the visible failed playback without matching vague timestamps by hand.

## Support Export And Issue Reporting

`/export-diagnostics` and `/report-issue` export the same active-session facts shown in the panel plus bounded historical detail:

- normalized and redacted event buffer;
- correlation identifiers;
- provider resolve summaries and physical attempt evidence;
- playback startup summary;
- source inventory summary;
- bounded completed resolve-work ledger snapshots;
- categorized health sections and actionable summaries.

Resolve-work ledger retention is bounded and local to the diagnostic session. It is intended to reveal deduplication, joined foreground/prefetch lanes, cache provenance and provider-attempt economy, not store playable secrets.

## Subsystem Rollout

Implementation is delivered in five independently verifiable slices.

### Slice 1: Diagnostic Ingestion And Privacy Foundation

- Make `DiagnosticsService` the active-runtime evidence write boundary.
- Keep the store as bounded persistence for panel/export reads.
- Ensure service ingestion forwards one redacted normalized event to store, logger and optional JSONL trace.
- Harden redaction for signed CDN parameters and embedded home paths.
- Apply redaction to structured debug output and retain bound logger child context.
- Stop raw stream/subtitle URL output.
- Carry correlation into persistent autoplay/mpv events.

Acceptance:

- a playback startup event and correlated mpv runtime event appear in the store, JSONL trace and bundle through production-style wiring;
- signed media/subtitle URLs and local home paths do not appear in stderr, trace or exported bundle;
- persistent autoplay player events retain cycle/attempt correlation.

### Slice 2: Real Provider And Subtitle Timeline Evidence

- Emit physical provider attempt start/end/timeout/retry/fallback evidence with real elapsed times.
- Preserve the distinction between provider-local cycling and global fallback.
- Emit classified initial and late subtitle attachment outcomes.
- Feed these outcomes into the startup/provider diagnostics projection.

Acceptance:

- deterministic tests distinguish a timeout retry, local source exhaustion and cross-provider fallback;
- subtitle tests distinguish no-track, late success, player-ready timeout and attach failure;
- provider progress evidence is available before the entire fallback sequence finishes.

### Slice 3: Resolve Work And Provenance Export

- Retain bounded completed resolve-work ledger snapshots.
- Supply them to support export and issue reporting.
- Preserve provider/source provenance on recent-memory and prefetched stream reuse.
- Emit reuse and validation decisions with lane/provenance information.

Acceptance:

- a real completed resolve operation becomes `insights.resolveWork` in an exported bundle;
- fallback-then-back-navigation attributes reused candidate evidence to the provider that produced it;
- ledger retention is bounded and contains no playable location secrets.

### Slice 4: Diagnostics Panel Trustworthiness

- Surface correlation identifiers, slowest startup stage, actual provider attempt durations, subtitle outcome and provenance in `/diagnostics`.
- Render absent subsystem information as unknown, not successful.
- Make active-cycle events discoverable without losing the bounded whole-session export.

Acceptance:

- panel tests cover correlated startup/provider evidence and unknown download state;
- a failed playback cycle can be matched directly to exported IDs;
- the panel remains compact and useful without raw URLs.

### Slice 5: Full Active Runtime Migration And Documentation

- Migrate remaining writable `DiagnosticsStore` dependencies in active search, download, presence, storage, update, session, work-control and background-task paths onto canonical ingestion.
- Retain intentionally read-only store access only where needed for snapshots.
- Update diagnostics/debugging documentation and smoke guidance.
- Reconcile related tracked plan truth where active implementation status changes.

Acceptance:

- active runtime code no longer bypasses diagnostic sinks for user-relevant evidence;
- deterministic tests cover each migrated subsystem category;
- full repository verification passes;
- manual smoke guidance verifies real provider/mpv/export behavior without adding live checks to default automation.

## File And Boundary Expectations

Primary implementation owners:

- `apps/cli/src/services/diagnostics/*`: ingestion, redaction, trace/export contracts and bounded diagnostic evidence;
- `apps/cli/src/infra/logger/*`: redacted structured debug output and bound context;
- `apps/cli/src/services/playback/*`: resolve-work retention and provider evidence projection;
- `apps/cli/src/app/PlaybackPhase.ts`: playback policy, timing stages, subtitle/reuse decisions;
- `apps/cli/src/infra/player/*`: mpv/persistent-session mechanics and correlated player evidence;
- `apps/cli/src/app-shell/*`: diagnostic presentation only;
- `packages/core/src/*` and `packages/providers/src/*`: provider attempt facts only when the evidence belongs at the provider-engine boundary.

The shell must not gain provider resolution policy. Providers must not gain UI status language. Infrastructure must not decide fallback policy. Diagnostics may summarize evidence, but must not change runtime behavior merely to make a report look cleaner.

## Testing And Verification

Implementation follows deterministic tests before or alongside each slice:

- unit tests for redaction, operation catalog, logger safety, correlation and formatting;
- service tests for canonical ingestion, JSONL forwarding and bounded ledger export;
- fixture-driven provider tests for per-attempt classifications without live network;
- persistent mpv harness tests for correlated runtime events and subtitle outcomes;
- panel tests for compact evidence and unknown state rendering;
- one explicit manual provider/mpv/export smoke after deterministic gates pass for the affected slice.

Repository verification for completed implementation:

```sh
bun run fmt
bun run lint
bun run typecheck
bun run test
bun run build
```

Live provider checks remain manual and bounded, following the existing testing strategy and provider-drift policy.

## Success Criteria

The work is successful when:

- enabling `--debug-json` captures the same relevant active-runtime evidence a user can see in `/diagnostics`;
- exports explain why a stream took time to begin, including real provider attempts, retries/fallback, mpv readiness, optional subtitle delay and reuse/prefetch decisions;
- debug output cannot leak signed playable URLs, subtitle locations or private home paths under the supported diagnostic paths;
- the app describes missing evidence as unknown rather than healthy;
- a support report can be tied to the visible playback cycle through correlation identifiers;
- future provider drift can be investigated using bounded, redacted facts rather than raw scraping output or guesswork.
