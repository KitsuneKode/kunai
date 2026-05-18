# Provider Contract V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let provider-native IDs, release facts, artwork, source labels, language evidence, and thumbnail metadata reach the CLI without redundant third-party lookups.

**Architecture:** Expand existing contracts additively. Do not introduce a parallel `ProviderSourceInventory` if `ProviderResolveResult`, `StreamCandidate`, `ProviderSourceCandidate`, and `ProviderVariantCandidate` can carry the same information cleanly.

**Tech Stack:** `@kunai/types`, `@kunai/schemas`, `@kunai/core`, `@kunai/providers`, `apps/cli`.

---

## Agent Tracking Header

```text
SLICE_ID: P2
SLICE_STATUS: in-progress
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: P2-T1
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

- [ ] Add `ProviderExternalIds`, `ProviderReleaseInfo`, `ProviderArtworkInfo`, and language/source evidence types in `packages/types/src/index.ts`.
- [ ] Add optional fields to `TitleIdentity`, `ProviderSearchResult`, `ProviderEpisodeOption`, `ProviderResolveResult`, `StreamCandidate`, `ProviderSourceCandidate`, and `ProviderVariantCandidate` only where useful.
- [ ] Preserve all existing fields.
- [ ] Run `bun run --cwd packages/types test`.
- [ ] Run `bun run --cwd packages/types typecheck`.
- [ ] Commit with message `feat(types): add provider metadata v2 fields`.

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

- [ ] Add matching schemas in `packages/schemas/src/index.ts`.
- [ ] Add tests proving old payloads still parse.
- [ ] Add tests proving new optional fields parse.
- [ ] Run `bun run --cwd packages/schemas test`.
- [ ] Run `bun run --cwd packages/schemas typecheck`.
- [ ] Commit with message `feat(schemas): validate provider metadata v2 fields`.

### P2-T3: Thread App-Domain Fields

- [ ] Add optional external ID/release/artwork fields to `TitleInfo`, `SearchResult`, and `EpisodeInfo` in `apps/cli/src/domain/types.ts`.
- [ ] Thread fields through provider adapters without requiring them.
- [ ] Add unit tests in `apps/cli/test/unit/services/providers/provider-registry.test.ts` or a new adapter test if one exists.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(cli): preserve provider metadata through adapters`.

### P2-T4: Add History Fields Safely

- [ ] Add nullable columns through a new migration id, for example `00x_data_history_external_ids`.
- [ ] Add optional fields to `HistoryProgressInput` and `HistoryProgress`.
- [ ] Update `HistoryRepository.upsertProgress` and row mapping compatibly.
- [ ] Add storage tests for old rows and new rows.
- [ ] Run `bun run --cwd packages/storage test`.
- [ ] Commit with message `feat(storage): persist provider external ids in history`.

### P2-T5: Make Third-Party Metadata Fetch Fallback-Only

- [ ] Update timing/catalog lookup sites to first use provider-native IDs when present.
- [ ] Keep existing AniList/TMDB/Haglund fetches as fallback when IDs are absent.
- [ ] Add tests proving provider-native `malId` skips redundant lookup where a test seam exists.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `feat(playback): prefer provider-native metadata ids`.

## Commit Boundaries

- Types, schemas, CLI adapters, storage, and lookup behavior are separate commits.
- No provider scraping changes in this plan.
- No SQLite destructive migrations.

## Acceptance Tests

- Old provider results parse unchanged.
- Provider result with `malId` can skip MAL lookup in timing flow.
- Provider result with release date can render schedule badges without a second catalog fetch.
- Source inventory cache keys do not change until byte-affecting fields change.
