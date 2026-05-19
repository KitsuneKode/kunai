# Provider UI Projection Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shell and future UI work a stable, product-ready source inventory view without exposing raw provider internals.

**Architecture:** Provider modules return rich technical evidence. Core and CLI services project that evidence into a UI-facing model for source, language, quality, subtitle, warning, and recovery controls. The UI consumes the projection only; it does not infer provider semantics from raw labels or trace payloads.

**Tech Stack:** `@kunai/types`, `apps/cli/src/services/playback`, `apps/cli/src/app-shell`, Bun tests.

---

## Agent Tracking Header

```text
SLICE_ID: P4
SLICE_STATUS: implemented
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: none
SLICE_BLOCKERS: none
```

## File Ownership

Create:

- `apps/cli/src/services/playback/PlaybackSourceInventoryView.ts`
- `apps/cli/src/services/playback/PlaybackSourceInventoryProjection.ts`
- `apps/cli/test/unit/services/playback/playback-source-inventory-projection.test.ts`

Modify only after the pure mapper is tested:

- `apps/cli/src/app/source-quality.ts`
- `apps/cli/src/app/subtitle-selection.ts`
- playback/source picker wiring under `apps/cli/src/app-shell/`

Do not import provider modules from app-shell. Do not call providers from the projection mapper.

## Why This Exists

Provider contract V2 gives us more data. That is not automatically a good UI boundary. Without a projection layer, the shell would still need to know that:

- anime providers expose `sub` and `dub` as separate source families
- series/movie providers often hide language inside server/source names
- quality may be a variant, a server suffix, or manifest-level evidence
- subtitles can be hardcoded, embedded, external, missing, or not applicable
- provider-native names must remain visible, but normalized fields drive logic

This plan creates the backend/frontend separation: backend produces a stable view model; UI renders it.

## Target Model

```ts
export interface PlaybackSourceInventoryView {
  readonly providerId: string;
  readonly selected?: PlaybackSourceSelectionView;
  readonly sourceGroups: readonly PlaybackSourceGroupView[];
  readonly languageOptions: readonly PlaybackLanguageOptionView[];
  readonly qualityOptions: readonly PlaybackQualityOptionView[];
  readonly subtitleOptions: readonly PlaybackSubtitleOptionView[];
  readonly recoveryActions: readonly PlaybackRecoveryActionView[];
  readonly warnings: readonly PlaybackInventoryWarningView[];
  readonly traceSummary?: PlaybackTraceSummaryView;
}
```

The exact names can change during implementation, but the separation must remain:

- technical provider result in
- stable UI projection out
- no raw provider tree rendering in app-shell components

## Projection Rules

- A manual provider/source/server choice is **preferred but recoverable**.
- UI labels use provider-native names when they are meaningful.
- Logic uses normalized IDs and language codes.
- Unavailable options can be shown disabled only when useful; otherwise hide them.
- Warnings are user-facing and concise.
- Trace summaries are developer-facing and can be expanded in diagnostics.
- Projection must never trigger a provider call.

## UI-Facing Concepts

### Source Groups

Examples:

- Anime: `Sub`, `Dub`, `Raw`
- Series/movie: `Original audio`, `Hindi audio`, `German audio`, `Multi-audio`
- Provider fallback: `VidKing`, `Rivestream`, `AllAnime`, `Miruro`

Each group should include:

- stable id
- label
- normalized language/presentation evidence when known
- provider-native label list
- selected/available/failed/skipped state
- candidate count

### Quality Options

Examples:

- `Auto`
- `1080p`
- `720p`
- `4K`
- `Source default`

Each option should include:

- stable id
- display label
- rank
- selected state
- whether switching requires mpv restart

### Subtitle Options

Examples:

- `Off`
- `English soft subtitles`
- `English hardsub`
- `Embedded subtitles`
- `Provider subtitles unavailable`

Each option should include:

- delivery type
- language
- selected state
- repair/download implications

### Recovery Actions

Examples:

- `retry-current`
- `next-server`
- `next-source`
- `fallback-provider`
- `refresh-stream`
- `cancel`

Each action should include:

- stable id
- label
- disabled reason
- whether it preserves timestamp
- whether it changes provider/source/cache identity

## Tasks

### Task 1: Define Projection Types

- [x] Add UI projection types near playback/domain boundaries, not inside provider modules.
- [x] Keep provider-native fields as display metadata.
- [x] Keep normalized fields as logic metadata.
- [x] Add compile-time tests or contract tests.
- [x] Run `bun run --cwd apps/cli typecheck`.
- [x] Commit with message `feat(playback): add source inventory projection types`.

Minimum type shape:

```ts
export type PlaybackInventoryOptionState =
  | "selected"
  | "available"
  | "failed"
  | "skipped"
  | "disabled";

export interface PlaybackSourceGroupView {
  readonly id: string;
  readonly label: string;
  readonly state: PlaybackInventoryOptionState;
  readonly providerId: string;
  readonly sourceIds: readonly string[];
  readonly nativeLabels: readonly string[];
  readonly presentation?: "sub" | "dub" | "raw";
  readonly audioLanguages: readonly string[];
  readonly subtitleLanguages: readonly string[];
  readonly candidateCount: number;
  readonly disabledReason?: string;
}

export interface PlaybackRecoveryActionView {
  readonly id:
    | "retry-current"
    | "next-server"
    | "next-source"
    | "fallback-provider"
    | "refresh-stream"
    | "cancel";
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly preservesTimestamp: boolean;
  readonly changesCacheIdentity: boolean;
}
```

### Task 2: Build Projection Mapper

- [x] Create a pure mapper from `ProviderResolveResult` to `PlaybackSourceInventoryView`.
- [x] Handle anime sub/dub/hardsub/softsub cases.
- [x] Handle series/movie source/server language cases.
- [x] Handle missing optional data without throwing.
- [x] Add fixture-backed tests.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(playback): project provider inventory for UI`.

Mapper signature:

```ts
export function buildPlaybackSourceInventoryView(
  result: ProviderResolveResult,
  options?: {
    readonly selectedStreamId?: string;
    readonly selectedSourceId?: string;
    readonly selectedVariantId?: string;
    readonly preferredAudioLanguage?: string;
    readonly preferredSubtitleLanguage?: string;
  },
): PlaybackSourceInventoryView;
```

### Task 3: Wire Shell Components To Projection

- [x] Update source, language, quality, and subtitle pickers to consume the projection model.
- [x] Keep existing UI behavior where projection does not yet expose richer choices.
- [x] Ensure switching source/language/quality captures current mpv timestamp when restart is required.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Run `bun run --cwd apps/cli typecheck`.
- [x] Commit with message `refactor(shell): render playback choices from projection`.

### Task 4: Add Diagnostics Projection Summary

- [x] Add a compact trace summary derived from the same projection.
- [x] Show user-facing warning copy in shell.
- [x] Export developer-facing projection details in diagnostics bundle with redaction.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(diagnostics): include source projection summary`.

## Commit Boundaries

- P4-T1 and P4-T2 are pure domain/service work and must not change shell UI rendering.
- P4-T3 is the first shell wiring commit.
- P4-T4 may touch diagnostics but must not add provider calls.

## Regression Checks

- Projection must return usable empty arrays instead of throwing for partial provider results.
- Projection must not trigger network, cache writes, or provider resolve.
- Existing playback starts must keep working when no projection-specific fields exist.
- App-shell components must consume projection output, not provider-specific raw payloads.

## Acceptance Tests

- UI can render anime sub/dub server choices without reading raw provider payloads.
- UI can render series/movie server-language choices without hardcoded provider branches.
- A missing subtitle does not break projection.
- A failed source produces a recovery action instead of an empty picker.
- Manual choice is preferred first, then recoverable through explicit next/fallback actions.
