# Playback timing, IntroDB, and AniSkip

Use this doc when changing **auto-skip** (intro / recap / credits / preview), **near-end / auto-next** behavior that depends on timing, or **MAL / catalog identity** for anime skip metadata. It complements [.docs/providers.md](./providers.md) (streams) with the **timing** side of playback.

## Mental model

```text
PlaybackPhase
  -> PlaybackTimingAggregator
       -> IntroDbTimingSource   (TMDB-keyed, all content types where applicable)
       -> AniSkipTimingSource   (anime mode; community skip times keyed by MAL)
  -> mergeTimingMetadata
  -> PlaybackTimingMetadata  ──►  player / PersistentMpvSession (IPC: seek when inside a segment)
```

- **Player IPC does not know** about providers, AniList, AllAnime, or MAL. It only receives merged `PlaybackTimingMetadata` (segment lists with `startMs` / `endMs`).
- **Identity resolution** (how we turn a `TitleInfo` + active provider into IntroDB and/or AniSkip requests) lives in `apps/cli/src/infra/timing/*` and `apps/cli/src/aniskip.ts`.

## IntroDB (The Intro Database)

- **Endpoint:** `GET https://api.theintrodb.org/v2/media?tmdb_id=…&season=…&episode=…` (see `apps/cli/src/introdb.ts`).
- **Requires a TMDB id** in the query. Anime providers that use opaque catalog ids (e.g. AllAnime `_id`) are **not** valid IntroDB keys.
- **IntroDB in anime mode:** `IntroDbTimingSource` only runs when `title.id` looks like a numeric TMDB id (`apps/cli/src/infra/timing/IntroDbTimingSource.ts`). Otherwise IntroDB is skipped so AniSkip is not blocked by useless calls.
- **Segments without `end_ms`:** IntroDB may return open-ended credits. Skip logic ignores segments without a finite end; see `.plans/kunai-execution-passes-and-cli-modes.md` for rationale.
- **Autoskip policy:** config is the parent gate. `skipIntro`, `skipCredits`, and optional `skipRecap` enable automatic skipping; the per-session autoskip pause (`u` during playback) suppresses automatic skipping without changing config. Manual skip prompts can still appear for finite known segments.
- **Autoplay prefetch:** persistent playback uses credits timing as an early prefetch trigger for the next episode. If a credible credits start exists near the natural end, prefetch starts roughly 45 seconds before credits; otherwise it falls back to the final 30 seconds. This keeps “skip credits / quit near credits” flows fast without adding provider work at playback start.

Official product/docs: [theintrodb.org/docs](https://theintrodb.org/docs).

## AniSkip (community skip times)

- **Endpoint:** `GET https://api.aniskip.com/v1/skip-times/{malAnimeId}/{episode}?types=op&types=ed`
- The public API expects a **MyAnimeList numeric anime id** in the path, **not** AniList, TMDB, or AllAnime `_id` directly.
- **Query types:** Only `op` and `ed` are accepted on the live API; requesting `recap` caused HTTP 400 for the entire request (regression fixed in `apps/cli/src/aniskip.ts`).
- **JSON shape:** Responses use **snake_case** (`skip_type`, `start_time`, `end_time`). The client normalizes both snake_case and camelCase.
- **Type mapping:** `op` / `mixed-op` become intro, `ed` / `mixed-ed` become credits. Unknown labels such as prologue, epilogue, post-credits, afterscene, and preview are ignored defensively.

Reference ecosystem: [synacktraa/ani-skip](https://github.com/synacktraa/ani-skip) (shell helper) and [aniskip/aniskip-api](https://github.com/aniskip/aniskip-api) (HTTP service).

## MAL resolution for anime (`title.id` is not always MAL)

`TitleInfo.id` depends on **search/catalog** source:

| `title.id` shape                 | Typical source                 | Resolution strategy (see `resolveMalIdForAniSkip` in `aniskip.ts`)                                                                                                    |
| -------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opaque string (e.g. 24-char hex) | AllAnime / AllManga `show._id` | When `providerId === "allanime"`: GraphQL `show(_id){ malId }` on `https://api.allanime.day/api` (same idea as ani-skip `-s allanime -i <_id>`), then AniSkip by MAL. |
| Numeric                          | AniList, TMDB TV, or other     | Try ARM `anilist` → MAL; if missing, try ARM **TMDB → MAL** list (first entry; split cours caveat).                                                                   |
| Opaque + non-AllAnime provider   | Unknown catalog                | Fall back: AniList **title search** (optional `seasonYear` from `title.year`) → ARM AniList → MAL.                                                                    |

**Important:** `PlaybackTimingFetchContext.providerId` must match the **manifest provider id** (e.g. `allanime` from `@kunai/core`), because branching keys off that string.

## `PlaybackTimingFetchContext` (extension seam)

Defined in `apps/cli/src/infra/timing/PlaybackTimingSource.ts`:

- Passed from `PlaybackPhase` into `PlaybackTimingAggregator.resolve(…, context)`.
- Every `PlaybackTimingSource.fetch` receives `context` (optional).
- **Today:** `providerId` is set from `SessionState.provider` so AniSkip can choose catalog-specific MAL resolution **without** polluting `TitleInfo` or mpv IPC.

When a future anime catalog needs extra hints (e.g. disambiguation regex, alternate API base URL), **prefer adding optional fields to `PlaybackTimingFetchContext`** and threading them from `PlaybackPhase`, rather than hard-coding provider checks in the shell or player.

## Merge behavior

`apps/cli/src/infra/timing/merge-timing.ts`: per segment bucket (`intro`, `recap`, `credits`, `preview`), **IntroDB wins if it returned any segments** for that bucket; otherwise AniSkip fills the gap. Keep this in mind when testing: bad IntroDB data for a valid TMDB id can mask AniSkip for that bucket.

---

## Templates: new anime provider + AniSkip

Use the following patterns so new providers stay compatible with timing and auto-skip.

### 1. Manifest and registry

- Add the provider to `apps/cli/src/services/providers/definitions/*` and the registry in `apps/cli/src/services/providers/definitions/index.ts` (single source of truth per repo rules).
- Note the **string id** you use in `defineProviderManifest({ id: "…" })` — that is `providerId` at runtime.

### 2. What `TitleInfo.id` means for your provider

Decide and document one of:

- **A. Opaque catalog id** (like AllAnime `_id`): you **must** implement or reuse a resolver **opaque id → MAL** (or eventually **→ numeric id understood by ARM**). Hook it in `resolveMalIdForAniSkip` when `providerId === "<your-id>"`.
- **B. Numeric AniList id**: existing ARM AniList → MAL path usually works.
- **C. Numeric TMDB TV id**: ARM TMDB → MAL fallback after AniList attempt covers many cases.

If the catalog exposes **MAL on the show record** (REST/GraphQL), follow the **AllAnime template**: small fetch function + in-memory cache keyed by catalog id, then return `number | null`.

### 3. Code template (opaque id + catalog `malId`)

```text
1. apps/cli/src/aniskip.ts
   - Add const for API base if needed.
   - Add fetchYourCatalogMalId(showId, signal) with caching.
   - In resolveMalIdForAniSkip:
       if (providerId === "your-provider" && !isNumericAniListId(catalogTitleId)) {
         const mal = await fetchYourCatalogMalId(catalogTitleId, signal);
         if (mal != null) return mal;
       }
   - Keep existing fallbacks after your branch (numeric ARM, then AniList name search).

2. apps/cli/src/infra/timing/AniSkipTimingSource.ts
   - No change required if only providerId branching is needed (already passes context).

3. apps/cli/src/infra/timing/IntroDbTimingSource.ts
   - Only if IntroDB should run for your ids: ensure title.id is numeric TMDB, or extend rules explicitly (rare for opaque anime catalogs).
```

### 4. Code template (numeric id only, no opaque ids)

No `aniskip.ts` change required if `title.id` is always numeric AniList or TMDB TV; ARM resolution already runs. Still verify with a few shows (split cours may map TMDB → multiple MAL rows; we pick the first).

### 5. Verification checklist

- [ ] Confirm `SessionState.provider` equals your manifest `id` when your provider is selected.
- [ ] With anime mode + your provider, play an episode with known AniSkip data: intro/credits seek once (see diagnostics / `.plans/kunai-execution-passes-and-cli-modes.md`).
- [ ] If IntroDB should apply: `title.id` must be TMDB-shaped for anime, or use non–anime-mode TMDB browse paths.
- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt`; add or extend unit tests if you add non-trivial resolution logic.

### 6. Optional future: richer `PlaybackTimingFetchContext`

If disambiguation or per-session API bases become necessary, extend:

```ts
// PlaybackTimingSource.ts — illustrative only
export interface PlaybackTimingFetchContext {
  readonly providerId?: string;
  // readonly catalogSearchFilter?: string;  // e.g. ani-skip -f disambiguation
  // readonly timingApiOverrides?: { allanimeGraphqlUrl?: string };
}
```

Thread new fields from `PlaybackPhase` where timing is resolved; **do not** thread provider secrets into mpv.

---

## File map

| Area                              | Path                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AniSkip fetch + MAL resolution    | `apps/cli/src/aniskip.ts`                                                                             |
| AniSkip timing source             | `apps/cli/src/infra/timing/AniSkipTimingSource.ts`                                                    |
| IntroDB fetch                     | `apps/cli/src/introdb.ts`                                                                             |
| IntroDB timing source             | `apps/cli/src/infra/timing/IntroDbTimingSource.ts`                                                    |
| Merge + aggregator + context type | `apps/cli/src/infra/timing/merge-timing.ts`, `PlaybackTimingAggregator.ts`, `PlaybackTimingSource.ts` |
| Wiring provider id into timing    | `apps/cli/src/app/PlaybackPhase.ts`                                                                   |
| Skip application (mpv)            | `apps/cli/src/infra/player/playback-skip.ts`, `PersistentMpvSession.ts`                               |
