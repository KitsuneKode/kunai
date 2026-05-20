# Provider Source Inventory Reliability Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallel provider refactors, or `superpowers:executing-plans` for inline execution. Track each checkbox as it lands. Code wins over this plan if drift is found; update `.plans/plan-implementation-truth.md` when the pass is reconciled.

**Goal:** Make provider output, fallback behavior, downloads, recommendations, and history reconciliation deterministic enough that the next UI pass can consume rich source data without extra calls or provider-specific guesses.

**Architecture:** Add small shared provider-side builders for source inventory, language evidence, quality ranking, stable IDs, and failure classification. Refactor providers toward the shared builder while preserving their provider-specific scraping and resolve logic. Then align playback, download recovery, recommendation prewarm, and history reconciliation around the richer contract.

**Tech Stack:** Bun-first TypeScript monorepo, `@kunai/types`, `@kunai/core`, `@kunai/providers`, CLI app services, SQLite-backed storage/cache.

---

## Non-Negotiable Constraints

- Do not stage or revert unrelated dirty files.
- Keep episode numbers 1-based at UI boundaries.
- Keep provider-specific scraping inside providers; shared helpers should own taxonomy, IDs, language/source evidence, quality ranking, and error classification only.
- CLI-facing language fields must be normalized ISO-639-1 codes such as `en`, `hi`, `ja`, `de`.
- Native provider labels such as `killjoy`, `HindiCast`, `Vietsub`, `H-SUB`, or source display names must survive in `languageEvidence`, `sourceEvidence`, `metadata`, or diagnostics, not in primary language fields.
- User abort, network offline, timeout, blocked, parse failure, and empty-provider results must be distinguishable in traces and diagnostics.
- Late valid resolver results may be persisted for cache warmth, but must never switch playback behind the user after navigation or abort.
- Recommendations, history reconciliation, downloads, poster lookup, and seekbar thumbnail lookup must not block next-episode playback.

## Scoped Commit Shape

1. `docs(plans): add provider reliability hardening plan`
2. `feat(providers): add source inventory helpers`
3. `fix(providers): enforce strict language evidence`
4. `fix(providers): classify provider abort and network failures`
5. `refactor(providers): normalize source inventory output`
6. `fix(playback): keep next episode flow non-blocking`
7. `feat(downloads): align recovery with source inventory`
8. `feat(history): reconcile caught-up and new episode state`
9. `feat(recommendations): prewarm post-playback suggestions`
10. `docs(ui): add source inventory UI handoff notes`

## Phase 1: Shared Provider Inventory Foundation

**Files**

- Create: `packages/providers/src/shared/source-inventory.ts`
- Modify: `packages/providers/src/shared/subtitle-helpers.ts`
- Modify: `packages/providers/src/utils/variant-tree.ts`
- Test: `packages/providers/test/providers.test.ts`

**Tasks**

- [ ] Add `stableProviderInventoryId(prefix, parts)` for deterministic source/stream/variant IDs.
- [ ] Add `parseSourceHost(url)` with safe fallback for invalid URLs.
- [ ] Add `qualityRankFromLabel(label)` and `normalizeQualityLabel(label)`.
- [ ] Add `createProviderSourceEvidence()` and `createProviderLanguageEvidence()`.
- [ ] Add `createSourceCandidateFromStream()` and `createVariantCandidateFromStream()`.
- [ ] Replace `Buffer.from(...).toString("base64url")` in `VariantTreeBuilder` with the shared stable ID helper.
- [ ] Add tests for deterministic IDs, quality sorting, source evidence, and Bun/Node-safe behavior.

**Completion Criteria**

- Shared helper tests pass.
- Existing provider tests still pass without provider refactors.
- No provider behavior changes except stable ID implementation internals.

## Phase 2: Strict Language Normalization

**Files**

- Modify: `packages/providers/src/shared/subtitle-helpers.ts`
- Modify: `apps/cli/src/services/providers/provider-result-adapter.ts`
- Test: `packages/providers/test/providers.test.ts`
- Test: `apps/cli/test/unit/services/providers/provider-result-adapter.test.ts` if present; otherwise add focused tests near provider adapter coverage.

**Tasks**

- [ ] Add `normalizeIsoLanguageCode(value)` that returns `undefined` for unknown/non-language labels.
- [ ] Keep `normalizeSubtitleLanguage()` as a compatibility alias, but route safe callsites to the stricter helper.
- [ ] Add `languageDisplayName(code)` and keep `subtitleLanguageDisplayName()` as alias.
- [ ] Treat `sub`, `dub`, `hardsub`, `softsub`, `cc`, `sdh`, `server`, and provider code names as presentation/source evidence, not primary language.
- [ ] Preserve native labels in `ProviderLanguageEvidence.nativeLabel`.
- [ ] Add tests for `killjoy`, `HindiCast`, `FlowCast`, `Vietsub`, `Vietnamese`, `Portuguese (BR)`, `pt-br`, `English CC`, and unknown labels.

**Completion Criteria**

- CLI-facing stream/subtitle language fields never contain provider source aliases.
- Raw labels remain visible through evidence/metadata for diagnostics and UI detail panels.

## Phase 3: Provider Failure Classification And Abort Guardrails

**Files**

- Create: `packages/providers/src/shared/provider-errors.ts`
- Modify: `packages/providers/src/shared/provider-cycle.ts`
- Modify: `packages/core/src/provider-cycle-engine.ts` only if the core cycle type needs a new attribute.
- Test: `packages/core/test/provider-cycle-engine.test.ts`
- Test: `packages/providers/test/providers.test.ts`

**Tasks**

- [ ] Add `classifyProviderThrownError(error)` for `cancelled`, `timeout`, `network-error`, `blocked`, `parse-failed`, and `unknown`.
- [ ] Add `isAbortLikeError(error)` that recognizes DOM abort, Bun abort, timeout abort, and user-cancel messages.
- [ ] Add `createProviderFailureFromError(providerId, error, at)` for consistent trace entries.
- [ ] Route provider-local timeout/network catch blocks through the classifier.
- [ ] Keep provider cycles from retrying user-cancelled and offline errors that cannot recover inside the same request.
- [ ] Add tests for abort, timeout, DNS/offline, blocked HTTP, parse failure, and empty candidate.

**Completion Criteria**

- Network-offline does not produce long retry loops.
- User abort does not keep resolving provider candidates in the background except for explicitly safe cache-only commits.
- Diagnostics can explain why fallback stopped or moved.

## Phase 4: Provider Refactor To Shared Inventory

**Files**

- Modify: `packages/providers/src/vidking/direct.ts`
- Modify: `packages/providers/src/rivestream/direct.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Modify: `packages/providers/src/miruro/direct.ts`
- Test: `packages/providers/test/providers.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-source-inventory-projection.test.ts`

**Tasks**

- [ ] Refactor VidKing source/stream/variant creation to shared helpers.
- [ ] Refactor Rivestream source/stream/variant creation to shared helpers.
- [ ] Refactor AllManga source/stream/variant/sub-dub evidence to shared helpers.
- [ ] Refactor Miruro source/stream/variant/subtitle evidence to shared helpers.
- [ ] Ensure selected stream/source IDs are stable and cache-safe.
- [ ] Preserve provider-specific labels, server names, and source aliases in evidence.
- [ ] Ensure source inventory includes artwork and seekbar thumbnail facts when provider payload includes them.

**Completion Criteria**

- Anime inventory exposes sub/dub/hardsub/softsub distinctions without flattening away provider hierarchy.
- Series/movie inventory exposes source/server, audio-language evidence, quality, subtitles, and artwork without extra CLI guesses.
- Projection tests show the UI can render source/quality/language controls from inventory alone.

## Phase 5: Playback Flow Non-Blocking Hardening

**Files**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/ResolveResultCommitPolicy.ts`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts` if needed
- Test: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`
- Test: relevant playback phase tests if present.

**Tasks**

- [ ] Identify any post-end recommendation/history/reconcile work that runs before next-episode OSD/loading feedback.
- [ ] Move non-critical work onto background lanes with abortable tasks.
- [ ] Show immediate next-episode intent before any slow provider or recommendation compute.
- [ ] Do not await recommendation, poster enrichment, history refresh, or notification writes before starting next resolve.
- [ ] Keep late valid resolve results as cache-only if user has moved away.

**Completion Criteria**

- Auto-next returns immediate feedback and does not pause on post-playback enrichment.
- Last-episode end goes to post-playback without long hidden compute.
- Tests prove non-critical work is scheduled, not awaited, on the hot path.

## Phase 6: Download Recovery Alignment

**Files**

- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `packages/storage/src/repositories/download-jobs.ts`
- Test: `apps/cli/test/unit/services/download/download-service.test.ts`
- Docs: `.docs/download-offline-onboarding.md`

**Tasks**

- [ ] Store source inventory facts needed for repair: selected stream ID, source ID, variant ID, subtitle expectation, artwork URL, and seekbar VTT URL when available.
- [ ] Classify completed video with missing optional sidecars as `completed-with-notes` or equivalent existing state, not hard failure.
- [ ] Treat hardsub-only or unknown-subtitle inventory as “no subtitle sidecar expected.”
- [ ] Add repair-only path for missing subtitle/artwork sidecars without redownloading video.
- [ ] Add diagnostics text that distinguishes “subtitle unavailable” from “subtitle failed.”

**Completion Criteria**

- Interrupted downloads can resume without repeating completed work.
- Missing optional subtitles do not poison the whole job.
- Download manager can show recovery action and notes clearly.

## Phase 7: History Reconciliation And New Episode State

**Files**

- Modify: `apps/cli/src/domain/continuation/history-reconciliation.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: storage history entities/repositories if schema support is missing.
- Test: `apps/cli/test/unit/domain/continuation/history-reconciliation.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

**Tasks**

- [ ] Track known season/episode counts when a title is selected or episode list is loaded.
- [ ] Distinguish `completed`, `caught-up`, `in-progress`, and `new-episode-available`.
- [ ] Do not mark a series complete unless the known episode map proves the latest available episode is complete.
- [ ] When new episode data appears, downgrade `completed/caught-up` to `new-episode-available` without losing prior watched state.
- [ ] Keep reconciliation stale-friendly: use cached metadata immediately and refresh in background.

**Completion Criteria**

- Continue/history can show new-episode indicators without over-fetching.
- Rewatching older episodes does not destroy the latest known progress.
- A network miss does not erase or corrupt useful local history.

## Phase 8: Recommendation Prewarm And Cache Policy

**Files**

- Modify: `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/PostPlaybackPhase.ts` if present
- Test: `apps/cli/test/unit/services/recommendations/recommendation-service.test.ts`

**Tasks**

- [ ] Add per-title session prewarm when title is selected or playback starts.
- [ ] Return stale cached recommendation sections immediately on post-playback.
- [ ] Abort/deprioritize recommendation fetches when playback context changes.
- [ ] Never block auto-next or post-playback transition on recommendation fetch.
- [ ] Record cache-hit/stale/network-fallback diagnostics.

**Completion Criteria**

- Recommendation panel feels instant when cached.
- Network failure still shows stale recommendations with an honest warning.
- No extra provider calls are made just to render post-playback.

## Phase 9: Diagnostics And UI Handoff

**Files**

- Create: `.docs/source-inventory-ui-handoff.md`
- Modify: `.docs/diagnostics-guide.md`
- Modify: `.docs/providers.md`

**Tasks**

- [ ] Document source inventory fields UI should use for anime and series/movie controls.
- [ ] Document which fields are safe for compact labels and which are dev-only evidence.
- [ ] Document no-extra-call expectations for history, episode picker, post-playback, source picker, and diagnostics.
- [ ] Add diagnostics examples for provider fallback, stale cache, subtitle unavailable, network offline, and abort.

**Completion Criteria**

- UI agent can polish presentation without guessing provider internals.
- Diagnostics explain source/variant IDs, cache behavior, fallback reasons, subtitles, thumbnails, and stale data.

## Bulk Verification

Run after implementation slices are complete:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Expected:

- Typecheck passes.
- Lint passes without new warnings.
- Formatter produces no unexpected unrelated churn.
- Unit/integration tests pass.
- Build passes.

Manual smoke, not automated:

- One anime provider resolve with sub and dub available.
- One series provider resolve with multiple source/server labels.
- One auto-next from non-final episode.
- One final-episode end to post-playback.
- One network-offline recovery path.
- One download resume with completed video and missing optional subtitle.
