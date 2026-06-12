# Provider Fallback Resolver Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize provider-local source/server cycling so every provider gets deterministic retry, stop, fallback, abort, trace, and user-control behavior without rewriting the same loop.

**Architecture:** Keep global provider fallback in `ProviderEngine`, but add a provider-local resolver cycle helper for sources, servers, variants, and deferred locators. Providers supply inventory discovery and candidate probing functions; shared core owns policy, attempt ordering, failure classification, abort handling, and trace event emission.

**Tech Stack:** `packages/core`, `packages/types`, `packages/providers`, Bun tests.

---

## Agent Tracking Header

```text
SLICE_ID: P1
SLICE_STATUS: in-progress
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-20
SLICE_CURRENT_TASK: P1-T5
SLICE_BLOCKERS: none
```

## File Ownership

Create:

- `packages/types/src/provider-cycle.ts`
- `packages/core/src/provider-cycle-engine.ts`
- `packages/core/test/provider-cycle-engine.test.ts`

Modify:

- `packages/types/src/index.ts`
- `packages/core/src/index.ts`
- `packages/types/test/contracts.test.ts`
- `packages/providers/src/allmanga/direct.ts` only in P1-T4
- `packages/providers/test/allmanga.test.ts` only in P1-T4

Do not modify UI files in this slice. Do not migrate `vidking`, `rivestream`, or `miruro` until P3 fixtures exist for them.

## Current Problem

`ProviderEngine` already retries a whole provider and falls back across provider IDs. That is not enough for real sites:

- anime providers often expose `sub` and `dub`, then multiple servers under each mode
- series/movie providers often expose server names that imply language or quality
- a server can fail with timeout, empty manifest, parse failure, blocked host, or expired URL
- the user needs control to skip server retry, try next source, or fall back provider
- diagnostics need to explain the exact cycle path instead of only saying provider failed

Provider-local cycling is currently a provider convention. The V2 path makes it a reusable engine primitive.

## Target Model

```text
Global ProviderEngine
  -> Provider A
    -> ProviderCycleEngine
      -> source group: sub | dub | raw | multi-audio
      -> server/source: kiwi | telli | FlowCast | HindiCast | ...
      -> variant: 1080p | 720p | hardsub | softsub | direct
      -> probe/resolve candidate
  -> Provider B fallback
```

## Policy Boundaries

- `ProviderEngine` decides provider-level ordering, provider health, provider-level timeout, and cross-provider fallback.
- `ProviderCycleEngine` decides provider-local source/server/variant cycling.
- Provider modules decide how to discover candidates and how to resolve/probe one candidate.
- CLI decides user intent: automatic, manual, skip retries, skip source, fallback provider, or cancel.

## Planned Files

- Create: `packages/types/src/provider-cycle.ts`
  - shared types for cycle candidates, attempts, stop reasons, and user actions.
- Modify: `packages/types/src/index.ts`
  - export cycle types.
- Create: `packages/core/src/provider-cycle-engine.ts`
  - reusable cycle runner with abort, timeout, retry, stop, trace, and failure aggregation.
- Modify: `packages/core/src/index.ts`
  - export cycle engine.
- Test: `packages/core/test/provider-cycle-engine.test.ts`
  - deterministic cycle behavior.
- Modify provider modules incrementally:
  - `packages/providers/src/allmanga/direct.ts`
  - `packages/providers/src/miruro/direct.ts`
  - `packages/providers/src/videasy/direct.ts`
  - `packages/providers/src/rivestream/direct.ts`

## Failure Classes

Use these classes inside provider-local cycling:

- `candidate-timeout`: retry same candidate once if policy allows, then next candidate.
- `candidate-network`: retry once, then next source if available.
- `candidate-empty`: next candidate, no retry unless provider marks it transient.
- `candidate-expired`: refresh locator or next candidate.
- `candidate-blocked`: skip same host for this resolve, then next candidate.
- `candidate-parse`: next candidate; penalize provider only after all candidates exhaust.
- `candidate-unsupported`: stop this branch and move to compatible branch.
- `candidate-user-cancelled`: abort the whole resolve with no health penalty.

## User-Control Semantics

- Automatic mode: try best candidate, then next compatible candidate, then provider fallback.
- Manual source selected: try the selected source first, then ask before leaving that source group.
- Skip retry: stop retrying the current candidate and move to next candidate in the same source group.
- Skip source/server: mark the current source skipped for this resolve and try the next compatible source.
- Fallback provider: abort provider-local cycling and return a provider-level fallback signal.
- Cancel: abort the whole resolution.

## Tasks

### P1-T1: Add Cycle Types

- [x] Add cycle candidate and result types to `packages/types/src/provider-cycle.ts`.
- [x] Include stable IDs: `sourceId`, `serverId`, `variantId`, `streamId`.
- [x] Include user-visible labels separately from normalized identifiers.
- [x] Export from `packages/types/src/index.ts`.
- [x] Add contract tests in `packages/types/test/contracts.test.ts`.
- [x] Run `bun run --cwd packages/types test`.
- [x] Run `bun run --cwd packages/types typecheck`.
- [x] Commit with message `feat(types): add provider cycle contract`.

Minimum type shape:

```ts
export type ProviderCycleFailureClass =
  | "candidate-timeout"
  | "candidate-network"
  | "candidate-empty"
  | "candidate-expired"
  | "candidate-blocked"
  | "candidate-parse"
  | "candidate-unsupported"
  | "candidate-user-cancelled"
  | "candidate-unknown";

export type ProviderCycleIntent =
  | "automatic"
  | "manual-source"
  | "skip-retry"
  | "skip-source"
  | "fallback-provider"
  | "cancel";

export interface ProviderCycleCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly serverId?: string;
  readonly variantId?: string;
  readonly streamId?: string;
  readonly groupId?: string;
  readonly label?: string;
  readonly nativeLabel?: string;
  readonly normalizedAudioLanguage?: string;
  readonly normalizedSubtitleLanguage?: string;
  readonly presentation?: StreamPresentation;
  readonly qualityRank?: number;
  readonly priority: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderCycleFailure {
  readonly providerId: ProviderId;
  readonly candidateId: string;
  readonly failureClass: ProviderCycleFailureClass;
  readonly message: string;
  readonly retryable: boolean;
  readonly at: string;
}

export interface ProviderCycleAttempt {
  readonly candidate: ProviderCycleCandidate;
  readonly attempt: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failure?: ProviderCycleFailure;
}
```

The implementing agent may refine names, but it must preserve these concepts and keep provider-native labels separate from normalized fields.

### P1-T2: Build Core Cycle Engine

- [x] Create `packages/core/src/provider-cycle-engine.ts`.
- [x] Accept an ordered list of candidates and a `resolveCandidate(candidate, context)` function.
- [x] Apply per-candidate timeout, max retry, abort propagation, and stop decisions.
- [x] Emit trace events: `source:start`, `source:success`, `source:failed`, and `retry:scheduled`.
- [x] Return the selected stream result plus all attempts.
- [x] Run `bun run --cwd packages/core test`.
- [x] Run `bun run --cwd packages/core typecheck`.
- [x] Commit with message `feat(core): add provider cycle engine`.

Minimum engine shape:

```ts
export interface ProviderCycleEngineOptions {
  readonly maxAttemptsPerCandidate?: number;
  readonly candidateTimeoutMs?: number;
  readonly retryDelayMs?: number;
}

export interface RunProviderCycleInput<TResolved> {
  readonly providerId: ProviderId;
  readonly candidates: readonly ProviderCycleCandidate[];
  readonly intent?: ProviderCycleIntent;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly resolveCandidate: (
    candidate: ProviderCycleCandidate,
    context: ProviderCycleCandidateContext,
  ) => Promise<TResolved>;
}

export interface ProviderCycleCandidateContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly emit: (event: ProviderTraceEvent) => void;
}
```

The result type must include `selected`, `attempts`, `events`, and `fallbackRequested`.

### P1-T3: Test Stop And Fallback Semantics

- [x] Add tests for success on first candidate.
- [x] Add tests for timeout retry then next candidate.
- [x] Add tests for non-retryable parse failure moving to next candidate.
- [x] Add tests for user cancel aborting the whole run.
- [x] Add tests for explicit fallback provider signal.
- [x] Add tests that user cancellation does not produce a health penalty signal.
- [x] Run `bun run --cwd packages/core test`.
- [x] Commit with message `test(core): cover provider cycle decisions`.

### P1-T4: Migrate One Provider Behind The Engine

- [x] Start with `allmanga` because its sub/dub/server split is the clearest.
- [x] Convert provider-local server ordering into cycle candidates.
- [x] Preserve existing successful stream output.
- [x] Preserve ani-cli parity behavior.
- [x] Add fixture-backed tests before behavior changes.
- [x] Run `bun run --cwd packages/providers test`.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `refactor(providers): route allmanga source cycling through shared engine`.
  - Implementation is present in the worktree; commit split is intentionally left as repository hygiene because this branch already contains unrelated dirty files.

### P1-T5: Migrate Series/Movie Providers

- [x] Convert `vidking`, `rivestream`, and `miruro` only after fixtures capture their source/server/language semantics.
- [x] Preserve source names like `FlowCast`, `HindiCast`, `kiwi`, and provider-native labels in metadata.
- [x] Normalize logic fields separately from labels.
- [ ] Commit each provider separately:
  - `refactor(providers): route vidking source cycling through shared engine`
  - `refactor(providers): route rivestream source cycling through shared engine`
  - `refactor(providers): route miruro source cycling through shared engine`
  - Implementations are present in the worktree; split commits should stage only the provider files touched by each provider.

## Commit Boundaries

- P1-T1 commit must touch only `packages/types`.
- P1-T2/P1-T3 commits must touch only `packages/core` and `packages/types` imports if needed.
- P1-T4 must touch only AllManga provider files and tests.
- P1-T5 must be one provider per commit.

## Regression Checks

- Existing `ProviderEngine.resolveWithFallback` tests in `packages/core/test/core.test.ts` must keep passing.
- Existing provider tests in `packages/providers/test/providers.test.ts` must keep passing.
- A provider-local candidate failure must not skip directly to another provider if another compatible candidate exists.
- A provider-local user cancel must not be converted into a retryable provider failure.

## Acceptance Tests

- A provider with three failing internal servers returns one structured exhausted result with all attempts.
- A provider with first server timeout and second success returns success without falling back to another provider.
- User cancellation does not mark provider health down.
- Provider-level fallback still works when all local candidates exhaust.
- Diagnostics can show provider, source, server, variant, failure class, retry count, and elapsed time.
