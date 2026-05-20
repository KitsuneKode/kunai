# Provider Contract V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let provider-native IDs, release facts, artwork, source labels, language evidence, and thumbnail metadata reach the CLI without redundant third-party lookups.

**Architecture:** Expand existing contracts additively. `ProviderResolveResult` remains the
persisted source-inventory unit, but it now extends a lightweight
`ProviderSourceInventory` facade so UI/download/recommendation consumers can depend on the
inventory facts without also depending on resolve lifecycle bookkeeping.

**Tech Stack:** `@kunai/types`, `@kunai/schemas`, `@kunai/core`, `@kunai/providers`, `apps/cli`.

---

## Agent Tracking Header

```text
SLICE_ID: P2
SLICE_STATUS: completed
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: done
SLICE_BLOCKERS: none
```

## File Ownership

Modify:

- `packages/types/src/index.ts`
- `packages/schemas/src/index.ts`
- `packages/types/test/contracts.test.ts`
- `packages/schemas/test/schemas.test.ts`
- `apps/cli/src/domain/types.ts`
- `apps/cli/src/services/providers/provider-result-adapter.ts`
- `apps/cli/src/services/providers/stream-request-adapter.ts`
- `packages/storage/src/repositories/history.ts`
- `packages/storage/src/migrations.ts`
- `packages/storage/test/storage.test.ts`
- timing fallback sites in `apps/cli/src/app/anime-metadata.ts` and `apps/cli/src/aniskip.ts` only if provider-native IDs are actually threaded.

Do not change provider scraping behavior in this slice. Providers may keep returning old shapes until P3/P1 migrations.

## Contract Direction

Add optional structured fields:

- `externalIds`: `anilistId`, `tmdbId`, `imdbId`, `malId`
- `release`: `airDate`, `availableAt`, `status`, `providerConfirmed`
- `artwork`: `posterUrl`, `backdropUrl`, `thumbnailUrl`, `seekBarVttUrl`
- `languageEvidence`: normalized codes plus provider-native labels and confidence
- `sourceEvidence`: provider source/server labels and host evidence

## Rules

- Existing fields keep working.
- App-domain models should preserve the subset needed by UI, history, sync, and diagnostics.
- Cache identity includes only fields that affect playback bytes or selected sidecars.
- Provider-native labels stay visible in metadata/diagnostics.
- Missing optional metadata must never block playback.

## Tasks

### P2-T1: Add Additive Shared Types

- [x] Add `ProviderExternalIds`, `ProviderReleaseInfo`, `ProviderArtworkInfo`, and language/source evidence types in `packages/types/src/index.ts`.
- [x] Add optional fields to `TitleIdentity`, `ProviderSearchResult`, `ProviderEpisodeOption`, `ProviderResolveResult`, `StreamCandidate`, `ProviderSourceCandidate`, and `ProviderVariantCandidate` only where useful.
- [x] Add a lightweight `ProviderSourceInventory` facade and helper for consumers that need only inventory facts, not trace/failure/health bookkeeping.
- [x] Preserve all existing fields.
- [x] Run `bun run --cwd packages/types test`.
- [x] Run `bun run --cwd packages/types typecheck`.
- [x] Commit with message `feat(types): add provider metadata v2 fields`.

Completed in `e23604a`.

Minimum type shape:

```ts
export interface ProviderExternalIds {
  readonly anilistId?: string;
  readonly tmdbId?: string;
  readonly imdbId?: string;
  readonly malId?: string;
}

export interface ProviderReleaseInfo {
  readonly airDate?: string;
  readonly availableAt?: string;
  readonly status?: "released" | "upcoming" | "unknown";
  readonly providerConfirmed?: boolean;
}

export interface ProviderArtworkInfo {
  readonly posterUrl?: string;
  readonly backdropUrl?: string;
  readonly thumbnailUrl?: string;
  readonly seekBarVttUrl?: string;
}
```

### P2-T2: Add Schemas And Compatibility Tests

- [x] Add matching schemas in `packages/schemas/src/index.ts`.
- [x] Add tests proving old payloads still parse.
- [x] Add tests proving new optional fields parse.
- [x] Run `bun run --cwd packages/schemas test`.
- [x] Run `bun run --cwd packages/schemas typecheck`.
- [x] Commit with message `feat(schemas): validate provider metadata v2 fields`.

Completed in `1aef4fb`.

### P2-T3: Thread App-Domain Fields

- [x] Add optional external ID/release/artwork fields to `TitleInfo`, `SearchResult`, and `EpisodeInfo` in `apps/cli/src/domain/types.ts`.
- [x] Thread fields through provider adapters without requiring them.
- [x] Add unit tests in `apps/cli/test/unit/services/providers/provider-registry.test.ts` or a new adapter test if one exists.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(cli): preserve provider metadata through adapters`.

Completed in `ffb583e`.

### P2-T4: Add History Fields Safely

- [x] Add nullable columns through a new migration id, for example `00x_data_history_external_ids`.
- [x] Add optional fields to `HistoryProgressInput` and `HistoryProgress`.
- [x] Update `HistoryRepository.upsertProgress` and row mapping compatibly.
- [x] Add storage tests for old rows and new rows.
- [x] Run `bun run --cwd packages/storage test`.
- [x] Commit with message `feat(storage): persist provider external ids in history`.

Completed in `716bb12`.

### P2-T5: Make Third-Party Metadata Fetch Fallback-Only

- [x] Update timing/catalog lookup sites to first use provider-native IDs when present.
- [x] Keep existing AniList/TMDB/Haglund fetches as fallback when IDs are absent.
- [x] Add tests proving provider-native `malId` skips redundant lookup where a test seam exists.
- [x] Add tests proving provider-native release facts skip cached schedule probing.
- [x] Run `bun run --cwd apps/cli typecheck`.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(playback): prefer provider-native metadata ids`.
- [x] Commit with message `feat(catalog): surface provider-native release badges`.

Completed in `01dd799` and `a467dae`.

## Commit Boundaries

- Types, schemas, CLI adapters, storage, and lookup behavior are separate commits.
- No provider scraping changes in this plan.
- No SQLite destructive migrations.

## Acceptance Tests

- Old provider results parse unchanged.
- Provider result with `malId` can skip MAL lookup in timing flow.
- Provider result with release date can render schedule badges without a second catalog fetch.
- Source inventory cache keys do not change until byte-affecting fields change.
