# Title Identity Reconciliation Plan

Status: Proposed (not yet landed)

Read this before changing title identity, `externalIds`, anime provider mapping, resolve-input construction, history/continuation replay, or cross-provider routing.

Related: [.plans/search-service.md](search-service.md) (catalog/mapping ownership), [.docs/providers.md](../.docs/providers.md) (`catalogIdentity`), [.docs/architecture.md](../.docs/architecture.md).

## 1. Problem (Root Cause)

`TitleInfo.id` is an **overloaded** field. Depending on where a title came from it holds an AniList id, a TMDB id, or a provider-native opaque id. Nothing normalizes that id to what the **active provider** expects before we resolve a stream. Providers also cannot bridge between catalog ids (AniList/TMDB) and their own opaque ids, so a perfectly valid cross-catalog id silently fails.

Concrete failing case (verified in the user DB):

- `history_progress` for "Hozuki's Coolheadedness": `title_id = 20431` (AniList id), `media_kind = anime`, `provider_id = miruro`, `external_ids_json = {"anilistId":"20431"}`.
- Miruro consumes AniList ids, so it worked.
- Replaying/switching to AllManga (AllAnime) passes `20431` straight through as the opaque show id → `No sub episodes found for show 20431`.
- The remap helper that could have fixed this (`mapAnimeDiscoveryResultToProviderNative`) is not on the replay path, and even on the search path it relies on a text search that misses because the English title does not match AllAnime's romaji catalog ("Hoozuki no Reitetsu").

This is an **identity reconciliation gap**, not data corruption. The stored data is correct; the resolve pipeline does not translate it for the target provider.

## 2. Failure Inventory (current code, with evidence)

1. **No catalog-aware normalization at the resolve chokepoint.**
   `defaultResolveStream` → `streamRequestToResolveInput(request, mode)` is the single path all providers share, and `catalogIdentity` is already known here, but it is never used to pick the right id.
   - `apps/cli/src/services/providers/Provider.ts:69` (`catalogIdentity` computed), `:101` (chokepoint).

2. **Unsafe numeric-id inference.**
   `titleToCoreIdentity` treats any bare numeric anime id as an AniList id and any non-anime id as a TMDB id.
   - `apps/cli/src/services/providers/stream-request-adapter.ts:70-73`, `:80-82`.

3. **AllManga cannot bridge AniList → opaque id.**
   `resolve` uses `input.title.id` as the show id directly and ignores `input.title.externalIds.anilistId`, which it already receives.
   - `packages/providers/src/allmanga/direct.ts:219-228` (showId), `:633-636` (it does read anilistId, but only to echo back in the result, never for lookup).

4. **Remap merge bug on provider-native id match.**
   On the provider-search tier, a numeric id match returns the unmapped discovery result.
   - `apps/cli/src/app/anime-provider-mapping.ts:77-79` (`if (idMatch) return result;` should merge, mirroring `:53`).

5. **Remap gate too narrow.**
   `isAniListBackedResult` only fires when `metadataSource` starts with `"AniList "`. AniList-backed results whose `metadataSource` is exactly `"AniList"` or that carry `externalIds.anilistId` without that prefix are skipped.
   - `apps/cli/src/app/anime-provider-mapping.ts:89-91`.

6. **Replay/continuation bypasses remap.**
   History launch rebuilds `TitleInfo` straight from stored `titleId` + `externalIds` with no provider normalization.
   - `apps/cli/src/app/launch-entry.ts:77-87`.

7. **No fallback when provider-native search returns empty.**
   `provider.search()` returning `[]` (not `null`) short-circuits to "0 results" instead of falling back to the registry (AniList/TMDB).
   - `apps/cli/src/services/search/SearchRoutingService.ts:68-98`.

8. **TMDB ingest does not stamp `externalIds.tmdbId`.**
   Series/movie search results carry `id` but no `externalIds`, so downstream routing has nothing to fall back on.
   - `apps/cli/src/search.ts` (no `externalIds`/`tmdbId` writes).

9. **History persists only one id.**
   `history_progress` stores a single `title_id` plus `external_ids_json`; there is no per-provider native id, so every cross-provider replay must re-bridge over the network.
   - `packages/storage/src/repositories/history.ts:24,33-34,273-283`.

## 3. Reconciliation Model (design principles)

Separate two kinds of identity and never conflate them:

- **Catalog identity** — stable, cross-provider key. Prefer `anilistId` for anime, `tmdbId` (+ `imdbId`) for series/movie. This is the merge key.
- **Provider-native identity** — opaque ids that only one provider understands (AllAnime `_id`, etc.). These are _satellites_ of a catalog identity, stored as a map, never used as the merge key.

Rules:

- **Normalize at resolve time** based on the active provider's `catalogIdentity`. The provider declares what it wants; the pipeline supplies it.
- **Bridge inside the provider** when only a catalog id is known and the provider needs a native id (AllManga reverse-lookup by `anilistId`). Keep provider-native knowledge in the provider package.
- **Stamp `externalIds` at ingest** so every result/title carries its catalog ids from birth.
- **Merge only on shared catalog id.** If two entries share `anilistId` (or `tmdbId`), merge. If they share nothing reliable, keep duplicates — never guess-merge.
- **Persist the bridge.** Once a catalog id ↔ provider-native id edge is discovered, cache it (catalog mapping cache) and store it on history so replays are instant and offline-safe.

## 4. Implementation Phases

Order is by leverage: Phase 1 + 2 fix the real DB case with minimal surface; later phases harden and generalize.

### Phase 1 — Resolve-time normalization (foundation)

Goal: the chokepoint always hands a provider the id shape it declared.

- Add a pure helper `resolveProviderTitleIdentity(title, catalogIdentity)` (in `stream-request-adapter.ts` or a new `@kunai/core` identity module) that deterministically chooses `title.id`/`anilistId`/`tmdbId` from `externalIds` for the target `catalogIdentity`. No network, no guessing.
- Thread `catalogIdentity` into `streamRequestToResolveInput` and `titleToCoreIdentity`; pass it from `Provider.ts` (already computed at `:69`).
- Remove the unsafe `isNumericId` AniList/TMDB inference (`stream-request-adapter.ts:70-73,80-82`); replace with explicit `externalIds`-driven selection. Only fall back to `title.id` when its catalog matches the provider's `catalogIdentity`.
- Tests: extend `apps/cli/test/unit/services/providers/stream-request-adapter.test.ts` — anilist provider gets anilistId, provider-native provider keeps opaque id, tmdb provider gets tmdbId, no mis-inference for bare numerics.

### Phase 2 — AllManga AniList-id bridge (fixes Hozuki)

Goal: AllManga resolves from a catalog id when it has no opaque id.

- In `packages/providers/src/allmanga/direct.ts` `resolve`: when `input.title.id` is not a usable AllAnime opaque id (e.g. it equals `externalIds.anilistId`, or the catalog lookup yields no episodes) and `externalIds.anilistId` exists, perform a reverse lookup:
  - `searchAllManga` using the best available query terms (provider/romaji/native/english/title aliases),
  - select the result whose `aniListId === anilistId`,
  - continue resolution with that opaque id.
- Cache the discovered `anilistId → opaque id` edge (catalog mapping cache / cache DB) to avoid repeat lookups.
- Fix `anime-provider-mapping.ts:77-79` to merge on id match (mirror `:53`).
- Tests: integration test reproducing AniList `20431` → AllManga resolve succeeds via bridge using romaji alias; unit test for the merge-bug fix.

### Phase 3 — Stamp `externalIds` at ingest

Goal: every title carries catalog ids from birth so later stages never guess.

- TMDB/Videasy search (`apps/cli/src/search.ts`): stamp `externalIds.tmdbId` (and `imdbId` when available) on results.
- AniList search/enrichment: ensure `externalIds.anilistId` (+ `malId`) is always set (AllManga search already does — `allmanga/direct.ts:151-154`).
- Confirm `titleInfoFromSearchResult` / browse mappers preserve `externalIds` end-to-end.

### Phase 4 — Broaden remap gate + search fallback

Goal: remap fires whenever it can help; empty native search still returns results.

- `isAniListBackedResult` (`anime-provider-mapping.ts:89-91`): trigger on `externalIds.anilistId` present OR numeric id in anime mode with AniList metadata, not only the `"AniList "` prefix.
- `SearchRoutingService` (`:68-98`): when provider-native search returns empty `[]`, fall back to registry (AniList/TMDB) search instead of returning zero results. Keep `null` semantics (provider declined) distinct from `[]` (provider found nothing).

### Phase 5 — Replay/continuation normalization + history identity persistence

Goal: replays resolve on any provider without re-bridging, and survive provider switches.

- Run Phase 1 normalization (and Phase 2 bridge when needed) on the history/continuation launch path (`launch-entry.ts` `titleFromHistorySelection` and callers).
- Persist richer identity in `history_progress`: store discovered per-provider native ids alongside `external_ids_json` (either extend `external_ids_json` with a `providerIds` map or add a column/satellite table). Migration + healer backfills existing rows.
- Update the history metadata healer (`apps/cli/src/services/history-metadata/create-history-metadata-resolver.ts`) to also persist catalog↔native edges it discovers, not just posters/externalIds.

### Phase 6 — Tests, docs, verification

- Unit: identity helper, AllManga bridge, remap merge fix, search fallback.
- Integration: Hozuki AniList→AllManga replay; provider switch mid-session keeps resolving; TMDB series carries tmdbId through resolve.
- Live (opt-in): `bun run test:live:relay-allanime` still green; spot-check Miruro + AllManga on the same AniList id.
- Docs: update [.docs/providers.md](../.docs/providers.md) (catalog identity + bridge behavior), [.docs/architecture.md](../.docs/architecture.md) (identity normalization seam), and [.plans/plan-implementation-truth.md](plan-implementation-truth.md) when landing.
- Gates: `bun run typecheck`, `bun run lint`, `bun run fmt`, `bun run test`.

## 5. Acceptance Criteria

- A title stored with an AniList id resolves on both Miruro (anilist) and AllManga (provider-native) without manual reselection.
- Switching providers mid-session never produces "No … episodes found for show <catalog id>".
- Provider-native search returning empty falls back to registry results; `null` still means "provider declined".
- TMDB series/movie results carry `tmdbId` through to resolve input.
- No code path infers a catalog id type from "looks numeric"; selection is `externalIds`-driven and provider-declared.
- Entries are merged only when they share a catalog id; otherwise duplicates are kept (no corrupting auto-merge).
- Discovered catalog↔native edges are cached and persisted so replays don't re-bridge.

## 6. Risks & Notes

- **Bridge cost**: AllManga reverse-lookup adds a search round-trip on first resolve of a catalog-id-only title. Mitigate with the mapping cache + history persistence (Phase 5).
- **Schema change** (Phase 5) needs a forward-only migration; keep it additive (extend JSON or add a satellite table) to avoid breaking older rows.
- **Do not** build a global Rosetta mapping graph up front (see search-service.md) — only persist edges proven at resolve time.
- Keep `apps/relay-server` a thin adapter; none of this changes relay contracts.
