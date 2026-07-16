# Catalog Identity Parity (Anime ↔ Series / TMDB)

Status: core implemented (2026-07-16) — Phases 0–3 and 5 landed; Phase 4 UX badges and Phase 6 Fribb remain optional follow-ups.

## Implementation status (2026-07-16)

| Phase                            | State               | Where                                                                                                                                                                                                                         |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — contracts, alias table       | **Landed**          | `resolveCanonicalCatalogTitleId(…, { contentClass })`, `CatalogIdGraph` (`@kunai/types`), `history_title_aliases` (data migration 025) + `HistoryTitleAliasRepository`; aliases auto-written on every history upsert/backfill |
| 1 — CatalogIdentityService + ARM | **Landed**          | `apps/cli/src/services/catalog/arm-client.ts` (shared, AniSkip now uses it), `CatalogIdentityService.enrich`, `catalog_id_crosswalk` (cache migration 015, catalog-static TTL, misses cached)                                 |
| 1b — seams                       | **Landed**          | Both SearchPhase selection paths enrich the picked title; ARM-proven AniList hits mark `isAnime`; AniSkip/IntroDB read the enriched bag                                                                                       |
| 2 — history unify + backfill     | **Landed**          | Consolidator v2 (contentClass + aliases, one-shot `history_identity_consolidator_v2` marker at bootstrap); budgeted background `runHistoryIdentityEnrichBackfill` (main.ts, 10 titles/run, high-confidence only)              |
| 3 — dual-lane resolve            | **Landed**          | `adaptResolveLane` in `stream-request-adapter.ts`; lane contract admits linked anime through series mode; `resolveTitleLaneEligibility`; crosswalk season hints wired via `PlaybackResolveService`                            |
| 5 — episode coordinates          | **Landed**          | `packages/core/src/episode-map.ts` — fail-closed `mapAnimeEpisodeToTmdbCoordinates` / `mapTmdbEpisodeToAnimeCoordinates`                                                                                                      |
| 4 — dual search badges           | Optional, not built | —                                                                                                                                                                                                                             |
| 6 — Fribb offline pack           | Optional, not built | —                                                                                                                                                                                                                             |

Remaining follow-ups: surface lane eligibility in the provider picker UI (uses `resolveTitleLaneEligibility`), optional dual-catalog badges, live manual smoke of the Death Note scenario (§9).

Read this before unifying anime and series history units, enriching AniList/MAL ↔ TMDB/IMDB crosswalks, dual-lane provider resolve (anime content on series providers and the reverse), or promoting ARM beyond AniSkip.

Related:

- [.plans/title-identity-reconciliation.md](./title-identity-reconciliation.md) — **landed** foundation (catalog vs provider-native ids, resolve normalization, `providerNativeIds`, title bridge). This plan builds on that work; it does not replace it.
- [.plans/search-service.md](./search-service.md) — catalog/mapping ownership (deferred search decoupling)
- [.docs/playback-timing-and-aniskip.md](../.docs/playback-timing-and-aniskip.md) — ARM usage for MAL today; IntroDB needs TMDB
- [.docs/providers.md](../.docs/providers.md) — `catalogIdentity`
- [.docs/architecture.md](../.docs/architecture.md) — runtime boundaries

## 1. Context

Kunai has two discovery/playback worlds that currently fork history and providers:

| Lane           | Search / catalog                          | Provider catalog identity     | History `title_id` |
| -------------- | ----------------------------------------- | ----------------------------- | ------------------ |
| Anime          | AniList discovery + AllManga native remap | `anilist` / `provider-native` | AniList or MAL     |
| Series / movie | TMDB                                      | `tmdb`                        | `tmdb:{id}`        |

**Goal:** one logical work unit in history, full external-id bag, and **bidirectional provider access** when the title is within the supported range — so anime found via AllManga/AniList can fall back to Videasy/etc. when a TMDB id exists, and anime found via TMDB can use Miruro/AllAnime when AniList/MAL exists.

### Why this is viable now

- Schema already has `externalIds: { anilistId, malId, tmdbId, imdbId, providerNativeIds }` ([`packages/schemas/src/index.ts`](../packages/schemas/src/index.ts)).
- Canonical helpers already exist ([`packages/core/src/title-identity.ts`](../packages/core/src/title-identity.ts)).
- History can rekey and backfill ([`packages/storage/src/repositories/history.ts`](../packages/storage/src/repositories/history.ts) — `rekeyProgressRow`, `backfillTitleMetadata`).
- Provider-native bridge exists for AllAnime ([`ProviderTitleBridgeRepository`](../packages/storage/src/repositories/provider-title-bridge.ts)).
- **ARM** (`arm.haglund.dev`) is already called from [`apps/cli/src/aniskip.ts`](../apps/cli/src/aniskip.ts) but only extracts MAL. A real ARM response already returns the full bag, e.g. Death Note: `anilist=1535`, `myanimelist=1535`, `themoviedb=13916`, `imdb=tt0877057`, plus `themoviedb-season`.
- Content classification already wants anime stamped when AniList/MAL/Animation signals exist even on series providers ([`apps/cli/src/domain/media/content-kind.ts`](../apps/cli/src/domain/media/content-kind.ts)).
- Title-identity reconciliation (slices 1–6) landed provider-native mapping and resolve-time normalization; this plan is the **cross-catalog** half (AniList/MAL ↔ TMDB/IMDB).

### Hard constraint

Title-id parity ≠ episode parity. Multi-cour AniList entries vs one TMDB show need season/offset mapping (`themoviedb-season` from ARM; Fribb offline for harder cases).

## 2. Recommended approach

Build a **Catalog Identity Crosswalk** as a first-class service, promote ARM from AniSkip-only to shared enrichment, then wire history rekey + dual-lane resolve. Prefer live ARM (already trusted in-tree) with SQLite durability; optional Fribb offline later for offline/resilience.

Do **not** force one global primary id for all media. Keep:

- **Anime-capable works** → history unit prefers **AniList** (then MAL)
- **Non-anime series/movies** → history unit stays **`tmdb:{id}`**
- Always store the **full external id bag** so either side can resolve providers and timing (AniSkip = MAL, IntroDB = TMDB)

## 3. Architecture

```text
Search (anime AniList/AllManga | series TMDB)
        │
        ▼
 CatalogIdentityService.enrich(title)
   - input: partial externalIds + title/year/kind
   - sources: pass-through → ARM (cached) → optional Fribb → low-conf title match (never auto-merge)
        │
        ▼
 Enriched TitleIdentity
   externalIds: anilist, mal, tmdb, imdb, providerNative…
   identityConfidence: high | medium | low
   episodeMap hints: tmdbSeason, episodeOffset (when known)
        │
        ├─► History upsert (canonical title_id + alias index + merge)
        ├─► Anime providers (catalogIdentity anilist | provider-native)
        └─► Series providers (catalogIdentity tmdb) via dual-lane resolve
```

### Dual-lane resolve (provider sharing)

Series providers (Videasy, etc.) declare `mediaKinds: ["movie","series"]` and reject `mediaKind: "anime"`. Do **not** fake anime into their manifests casually.

Instead, at resolve handoff:

| User content         | Target provider lane    | `ProviderResolveInput.mediaKind` | Title fields used                     |
| -------------------- | ----------------------- | -------------------------------- | ------------------------------------- |
| Anime (AniList unit) | anime (AllAnime/Miruro) | `anime`                          | anilist / native via existing mapping |
| Anime with `tmdbId`  | series (Videasy…)       | `series` or `movie`              | `tmdbId` + mapped S/E                 |
| Pure series          | series                  | `series`                         | `tmdbId`                              |

History/persisted kind stays **`anime`** when content is anime (`classifyPersistedKind` / `isAnimeContent`); only the **resolve call** adapts to provider catalog identity.

Episode mapping for series-lane anime:

1. Prefer stored `absoluteEpisode` as primary anime progress key.
2. For TMDB resolve: use ARM `themoviedb-season` + episode within that season when single-cour map is high confidence; else `S1 + absolute` only when map says season 1 continuous; else require explicit map or refuse auto-fallback (manual provider pick still ok with user-chosen S/E).

## 4. Phased work

### Phase 0 — Contracts and pure identity (no network UX change)

**Intent:** make identity rules explicit and testable before wiring network.

1. **Extend `resolveCanonicalCatalogTitleId` policy** ([`packages/core/src/title-identity.ts`](../packages/core/src/title-identity.ts))
   - Keep anime → AniList/MAL preference.
   - When `kind === "series"` **but** `externalIds.anilistId` (or mal) present **and** `isAnime` signal is true, prefer AniList as history unit (or introduce optional `historyKind` / call-site flag so pure western series never get forced).
   - Safer API: `resolveCanonicalCatalogTitleId(title, { contentClass: "anime" | "general" })` used from `classifyPersistedKind` path, not raw TMDB series search results without anime signals.

2. **Add `CatalogIdGraph` type** (types package)

   ```ts
   type CatalogIdGraph = {
     anilistId?: string;
     malId?: string;
     tmdbId?: string;
     imdbId?: string;
     tmdbMedia?: "tv" | "movie";
     tmdbSeason?: number; // from ARM
     confidence: "high" | "medium" | "low";
     source: "passthrough" | "arm" | "fribb" | "provider" | "manual";
   };
   ```

3. **History alias index** (storage migration)
   - New table `history_title_aliases (alias_ns, alias_id, title_id)` unique on `(alias_ns, alias_id)`.
   - Namespaces: `anilist`, `mal`, `tmdb`, `imdb`, `youtube`, plus `provider:{id}`.
   - On upsert: write aliases for every known external id.
   - Lookup: any alias → canonical `title_id`.
   - Reuse `rekeyProgressRow` + merge when two title_ids collapse.

4. **Unit tests** in `packages/core/test/title-identity.test.ts` and new storage alias tests.

**Reuse:** `mergeBackfillExternalIds`, `resolvePersistedHistoryTitle`, `createHistoryKey`, `HistoryRepository.rekeyProgressRow`.

### Phase 1 — CatalogIdentityService (ARM promoted)

**Intent:** one enrichment path for search, playback, history, AniSkip, IntroDB.

1. **New module** (prefer packages so CLI + future surfaces share it):
   - `packages/core/src/catalog-identity/` or `apps/cli/src/services/catalog/CatalogIdentityService.ts` initially if deps are CLI-heavy.
   - Ports: `ArmClient`, `CatalogIdentityCache` (SQLite).

2. **Extract ARM client** from [`apps/cli/src/aniskip.ts`](../apps/cli/src/aniskip.ts)
   - Keep AniSkip using the shared client (no duplicated fetch/cache).
   - Parse **full** ARM payload: `anilist`, `myanimelist`, `themoviedb`, `imdb`, `themoviedb-season`, `media`.
   - Endpoints already known:
     - `GET https://arm.haglund.dev/api/v2/ids?source=anilist&id=`
     - `GET https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=` (confirm parity)
     - `GET https://arm.haglund.dev/api/v2/themoviedb?id=&include=…`

3. **SQLite cache** (cache DB, not data DB)
   - Table `catalog_id_crosswalk (source_ns, source_id, graph_json, confidence, expires_at)`.
   - TTL class: long (provider-metadata or dedicated week-scale).

4. **`enrich(title): Promise<TitleIdentity & { graph }>`**
   - Never clobber existing ids (`mergeBackfillExternalIds` semantics).
   - High confidence only from exact ARM/Fribb id hits.
   - Low confidence title search must **not** rewrite history.

5. **Wire enrich at seams** (order matters):
   - After search selection (anime + series) before episode pick.
   - Before history upsert in playback progress path.
   - Before dual-lane provider resolve.
   - AniSkip MAL resolution becomes “read graph.malId first.”
   - IntroDB can use graph.tmdbId even when session came from anime search.

**Critical files**

| Area                  | Path                                                   |
| --------------------- | ------------------------------------------------------ |
| AniSkip ARM (extract) | `apps/cli/src/aniskip.ts`                              |
| Title identity        | `packages/core/src/title-identity.ts`                  |
| Content kind          | `apps/cli/src/domain/media/content-kind.ts`            |
| Search selection      | `apps/cli/src/app/search/SearchPhase.ts`               |
| Anime native map      | `apps/cli/src/app/discover/anime-provider-mapping.ts`  |
| History               | `packages/storage/src/repositories/history.ts`         |
| Title persist         | `apps/cli/src/app/bootstrap/title-identity-persist.ts` |
| Timing docs           | `.docs/playback-timing-and-aniskip.md`                 |

### Phase 2 — History unify + backfill

**Intent:** one continue-watching unit for the same work.

1. On enriched upsert:
   - Canonical `title_id` = AniList for anime-capable; else existing rules.
   - Write all aliases.
   - If alias already points at a different `title_id`, **merge**:
     - Prefer richer external ids, newest progress, max watchedSeconds.
     - Rekey loser rows via `rekeyProgressRow`; delete duplicates carefully.

2. One-shot backfill job (CLI maintenance or first-run migration helper):
   - Scan `history_progress` with partial external ids.
   - Enrich via CatalogIdentityService.
   - Rekey + alias.

3. Continue-watching / calendar / share links:
   - Resolve by any alias ([`calendar-results.ts`](../apps/cli/src/app/search/calendar-results.ts), [`resolve-share-target.ts`](../apps/cli/src/app/bootstrap/resolve-share-target.ts), [`playback-target-ref.ts`](../apps/cli/src/domain/share/playback-target-ref.ts) already has ns `tmdb|anilist|mal|imdb`).

4. **Tests:** two synthetic histories (`anime:1535` and `series:tmdb:13916`) collapse to one after enrich.

### Phase 3 — Dual-lane provider access (the “share providers for anime” win)

**Intent:** watch anything in supported range with all capable providers.

1. **Provider eligibility helper**

   ```ts
   listEligibleProviders(title, mode): {
     animeLane: ProviderId[]; // needs anilist or native map
     seriesLane: ProviderId[]; // needs tmdbId
   }
   ```

   - Anime mode UI: anime providers first; series providers shown/enabled only when `tmdbId` present (or after enrich).
   - Series mode UI: series providers first; anime providers only when AniList/MAL present.

2. **Resolve adapter** (near engine / registry, not inside each provider)
   - `buildResolveInput(title, episode, providerId)`:
     - If provider `catalogIdentity === "tmdb"`: force `mediaKind` to `movie|series` from TMDB media type; set `title.id`/`tmdbId` from graph; map episode to S/E.
     - If `catalogIdentity === "anilist"`: existing path.
     - If `provider-native`: existing `mapAnimeDiscoveryResultToProviderNative` + title bridge.

3. **Engine gate** remains honest: Videasy still only accepts movie/series — adapter never sends `mediaKind: "anime"` to it.

4. **Fallback chains**
   - Config: optional `animeProviderPriority` may include series providers **only after** enrich proves `tmdbId`, or a separate `animeSeriesFallbackProviders` list to avoid surprising users.
   - Fail closed: if episode map confidence is low, skip series-lane auto-fallback; allow manual pick with explicit season/episode.

5. **Do not expand every series provider `mediaKinds` to include `anime`** unless the provider truly uses anime catalog keys. Dual-lane adapter is cleaner and matches Videasy’s TMDB APIs.

6. **Integration tests**
   - Fixture: AniList-enriched title with tmdbId → mock Videasy resolve receives series + tmdbId + S/E.
   - Fixture: TMDB Animation title with anilist from ARM → Miruro receives anilist id.

**Key files**

| Area                         | Path                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Engine mediaKind check       | `packages/core/src/provider-engine.ts`                                        |
| Videasy TMDB resolve         | `packages/providers/src/videasy/direct.ts`                                    |
| Provider registry / priority | `apps/cli/src/services/providers/*`, `packages/core/src/provider-priority.ts` |
| Launch / replay              | `apps/cli/src/app/bootstrap/launch-entry.ts`                                  |
| Playback phase resolve       | `apps/cli/src/app/playback/*` (resolve input construction)                    |
| Provider manifests           | `packages/providers/src/*/manifest.ts`                                        |

### Phase 4 — Dual search convergence (UX)

**Intent:** anime-only search and TMDB search both produce the same enrichable identity.

1. **Anime search path** (AniList / AllManga discovery)
   - After pick: `enrich` → attach `tmdbId`/`imdbId` when ARM hits.
   - Keep discovery id AniList for UI; store full bag.
   - Existing native remap for AllAnime remains.

2. **Series search path** (TMDB)
   - After pick: if Animation genre **or** user in anime mode **or** ARM returns anilist → mark `isAnime`, attach anilist/mal, history unit can become AniList after high-conf enrich.
   - TMDB-only anime with no ARM hit stays `tmdb:` unit (series providers only).

3. **Optional later:** unified search results with dual badges (“AniList · TMDB linked”) — not required for v1 of this plan.

4. **SearchPhase** ([`SearchPhase.ts`](../apps/cli/src/app/search/SearchPhase.ts)) is the main orchestration point after selection / before episode UI.

### Phase 5 — Episode coordinate layer (correctness)

**Intent:** shared history resume is correct across lanes.

1. Prefer **absoluteEpisode** on anime history keys when available.
2. Store optional mapping on external ids or side table:
   - `tmdbSeason`, `episodeOffset` from ARM/Fribb.
3. `mapEpisodeForProvider(title, episode, catalogIdentity)` shared helper.
4. Merge progress across lanes only when episode coordinates map 1:1 with high confidence; otherwise keep per-episode rows under same `title_id` but do not invent S/E.

5. Document known failure modes (multi-MAL cours for one TMDB show — ARM “first row” caveat already noted in aniskip).

### Phase 6 — Offline Fribb pack (optional resilience)

**Intent:** ARM outages / rate limits.

1. Vendor or download Fribb `anime-list-mini.json` + indices into cache dir.
2. Secondary source in CatalogIdentityService after ARM miss/fail.
3. Not required for first ship if ARM + SQLite cache is solid.

External references:

- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) — AniList/MAL/AniDB ↔ TMDB/TVDB/IMDB + season offsets
- [manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database) — anime-site mesh only (no TMDB)

## 5. Confidence and safety rules (non-negotiable)

| Signal                     | Auto-merge history?                                                   | Auto series-lane for anime?                 |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Exact ARM/Fribb id map     | Yes                                                                   | Yes if episode map ok                       |
| AniList `idMal` only       | Yes (anime ids only)                                                  | No (need tmdb)                              |
| Title + year fuzzy         | **Never**                                                             | **Never**                                   |
| TMDB Animation genre alone | Tag `isAnime` only                                                    | No                                          |
| Multi-row ARM TMDB→MAL     | Prefer first + log; do not merge conflicting AniList ids without user | Episode map low unless season field present |

## 6. What we deliberately do not do

- Make TMDB the single global history id for anime (breaks AniList sync, anime providers, cour ontology).
- Expand Videasy `mediaKinds` to `"anime"` without a real anime catalog API.
- Fuzzy-merge remakes by title.
- Route video bytes through relay for identity (identity is metadata-only).
- Reopen landed title-identity reconciliation work unless regressions appear; extend it.

## 7. Critical files (summary)

| Role                           | Path                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| Canonical id rules             | `packages/core/src/title-identity.ts`                        |
| Catalog identity type/manifest | `packages/core/src/provider-manifest.ts`                     |
| Content anime signals          | `apps/cli/src/domain/media/content-kind.ts`                  |
| ARM (extract)                  | `apps/cli/src/aniskip.ts`                                    |
| History + rekey                | `packages/storage/src/repositories/history.ts`               |
| Native AllAnime bridge         | `packages/storage/src/repositories/provider-title-bridge.ts` |
| Anime discovery remap          | `apps/cli/src/app/discover/anime-provider-mapping.ts`        |
| Search orchestration           | `apps/cli/src/app/search/SearchPhase.ts`                     |
| History launch/replay          | `apps/cli/src/app/bootstrap/launch-entry.ts`                 |
| Share ns already multi-catalog | `apps/cli/src/domain/share/playback-target-ref.ts`           |
| Series TMDB resolve            | `packages/providers/src/videasy/direct.ts`                   |
| Timing identity docs           | `.docs/playback-timing-and-aniskip.md`                       |

**Reuse first:** `mergeBackfillExternalIds`, `resolvePersistedHistoryTitle`, `mapAnimeDiscoveryResultToProviderNative`, `ProviderTitleBridgePort`, `resolveMalIdForAniSkip` internals, `classifyPersistedKind`, share `CatalogNs`.

## 8. Implementation order

1. Phase 0 contracts + alias table + tests
2. Phase 1 CatalogIdentityService + ARM extract + cache + AniSkip thin wrapper
3. Wire enrich on search select + history write
4. Phase 2 rekey/merge + backfill
5. Phase 3 dual-lane resolve adapter + eligibility in provider picker / fallback
6. Phase 5 episode map for high-confidence cases
7. Phase 4 UX polish / dual badges (optional)
8. Phase 6 Fribb (optional)

## 9. Verification

### Unit

- `packages/core/test/title-identity.test.ts` — anime series with anilist prefers AniList history id when contentClass anime.
- CatalogIdentityService: ARM fixture Death Note → full bag; merge does not clobber.
- History alias: insert by tmdb, lookup by anilist after enrich.
- Episode mapper: absolute 5 + tmdbSeason 1 → S1E5.

### Integration

- `apps/cli/test/integration/anime-discovery-resolve-handoff.test.ts` — still remaps AllAnime; external ids keep anilist **and** gain tmdb when enriched.
- New: history collapse integration (two title_ids → one).
- New: dual-lane resolve input adapter tests with mock series provider.

### Live (manual / opt-in)

1. Anime search Death Note → play AllAnime ep1 → progress saved under AniList id.
2. Same session or later: switch to Videasy (if listed) → resolve uses tmdb `13916`, history still same unit.
3. Series/TMDB search Death Note → enrich attaches anilist → continue-watching merges with step 1.
4. AniSkip still works (MAL from graph). IntroDB works when tmdb present.
5. Title with no ARM map: no forced merge; providers stay lane-native.

### Gates

```sh
bun run typecheck
bun run lint
bun run test
# focused:
bun test packages/core/test/title-identity.test.ts
bun test packages/storage/test/
```

## 10. Success criteria

1. Same anime work yields **one** continue-watching row whether entered via AniList/AllManga or TMDB.
2. External id bag on that row includes every high-conf id learned.
3. With `tmdbId`, series providers are usable for that anime without abandoning anime history identity.
4. With `anilistId`, anime providers remain primary and correct.
5. AniSkip + IntroDB both fire when both MAL and TMDB known.
6. No false merges on ambiguous titles.

## 11. Open product knobs (defaults recommended)

| Knob                                            | Recommended default                                       |
| ----------------------------------------------- | --------------------------------------------------------- |
| Auto-include series providers in anime fallback | **On only when high-conf tmdbId + episode map**           |
| History unit for linked anime                   | **AniList**                                               |
| ARM network on search select                    | **Yes, cached; non-blocking timeout ~4s (match AniSkip)** |
| Fuzzy title linking                             | **Off** for history                                       |

No further product decisions required to start Phase 0–1; knobs can stay as code defaults until UX polish.
