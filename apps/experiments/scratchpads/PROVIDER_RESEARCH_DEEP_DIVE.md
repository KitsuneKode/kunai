# Provider research deep dive (evidence-backed)

Companion to `PROVIDER_USAGE_AND_LATENCY.md` and `.plans/provider-capability-latency-audit.md`.

**Offline proof script:** `analyze-fallback-and-timing.ts`
**Live probes:** `probe-evidence-2026.ts`, `probe-pipe-search.ts`, `probe-all-providers-usage.ts`

---

## 1. Confirmed bug: TV/movie fallback tries AllAnime incorrectly

### Evidence (code, reproducible without network)

Fallback list is built in `PlaybackResolveService`:

```309:321:apps/cli/src/services/playback/PlaybackResolveService.ts
    const compatibleIds = [input.providerId];
    if (recoveryMode !== "manual") {
      for (const module of this.deps.engine.modules) {
        if (module.providerId === input.providerId) continue;
        if (!module.manifest.mediaKinds.includes(resolveInput.mediaKind)) continue;
        // ...
        compatibleIds.push(module.providerId);
      }
    }
```

For **shell mode `series`**, `streamRequestToResolveInput` sets `mediaKind` to `title.type` → **`"series"`** for TMDB TV.

`allanimeManifest.mediaKinds` is **`["anime", "series"]`** (`packages/providers/src/allmanga/manifest.ts`).

So when **VidKing** fails on a normal TV show:

```text
compatibleIds = ["vidking", "miruro?", "rivestream", "allanime"]
```

Engine order: miruro (anime-only) skipped; **allanime included** because manifest claims `series`.

But `allmanga/direct.ts` **rejects** non-anime:

```130:137:packages/providers/src/allmanga/direct.ts
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(..., {
        code: "unsupported-title",
        message: "AllManga only supports anime",
        retryable: false,
      });
```

**Result:** Wasted resolve attempt, extra latency, confusing diagnostics (“trying AllManga” on Breaking Bad).

Movies are **not** affected: `allanime` manifest has no `"movie"`.

### What you asked for (correct behavior)

| Content | Shell mode | Fallback providers |
|---------|------------|-------------------|
| TMDB movie | series | `rivestream` only (after vidking) |
| TMDB TV (live-action) | series | `rivestream` only |
| Anime | **anime** | `miruro` only (after allanime) |
| TMDB entry that is actually anime | **ambiguous today** | See §4 |

### Recommended fixes (pick one, smallest first)

**A. Manifest truth (preferred)**
Remove `"series"` from `allanimeManifest.mediaKinds`. Update `packages/core/test/core.test.ts` expectation.
Catalog/search can still say anime+series in **capabilities** if needed, but fallback filter should use **`resolveMediaKinds`**.

**B. Fallback filter uses shell mode**
Only add `module.manifest.mediaKinds.includes("anime")` providers when `input.mode === "anime"`, not when `mediaKind === "series"`.

**C. Explicit `supportsResolve(mediaKind)` on each module**
Manifest declares what `resolve()` accepts; fallback uses that, not broad `mediaKinds`.

**D. TMDB anime detection (future)**
When `title.genreIds` includes TMDB Animation (16) **and** user is in series shell, optionally allow `allanime`/`miruro` — requires TMDB search to populate `genreIds` (not wired today; `discover-sections.ts` notes gap).

---

## 2. Provider timing vs AniSkip / IntroDB (use the best source)

### Current behavior

| Layer | Behavior |
|-------|----------|
| `PlaybackTimingAggregator` | `[IntroDbTimingSource, AniSkipTimingSource]` in parallel |
| `merge-timing.ts` | Per bucket: **first source wins** if it has segments (`intro`, `credits`, …) |
| Miruro pipe `sources` | Returns `intro` / `outro` with `start`/`end` |
| `createMiruroResultFromPayload` | **Does not** copy into `StreamCandidate.metadata` |
| `ResolveWorkLedger` | Already detects `metadata.intro` / `outro` for diagnostics |

So today **AniSkip/IntroDB always run** for anime even when Miruro already sent intro/outro — duplicate network and can **mask** better provider-local timings if IntroDB returns wrong TMDB-keyed data.

### Correct precedence (your intent)

```text
1. Provider stream metadata (0 extra HTTP) — Miruro pipe, any future provider fields
2. IntroDB (TMDB-keyed, series/movie and some anime with tmdb external id)
3. AniSkip (anime, MAL path)
```

### Implementation shape (when approved)

1. Map Miruro `intro`/`outro` → `StreamCandidate.metadata` at resolve time.
2. Add `ProviderStreamTimingSource` reading from `PlaybackTimingFetchContext.resolveMetadata` or last `providerResolveResult`.
3. Aggregator order: **`[ProviderStreamTiming, IntroDB, AniSkip]`** — same merge rule; provider wins when present.
4. **Do not** call AniSkip when provider timing is complete for intro+credits (configurable bucket policy).

### AllAnime / VidKing / Rivestream

| Provider | Intro/outro in stream payload? | Evidence |
|----------|-------------------------------|----------|
| Miruro | **Yes** | Fixture `miruro/source-response.json` |
| AllAnime | **Unknown** — not in normalized fixtures | Needs GQL/source sniff; likely **no** |
| VidKing | **No** in direct payload | IntroDB + Wyzie path |
| Rivestream | **No** | IntroDB for TMDB |

**Conclusion:** Provider-first timing is **not** “instead of AniSkip for all providers” — it is **when the resolved stream already carried timing facts**. Otherwise keep AniSkip/IntroDB.

---

## 3. Search lanes — how to use Miruro without redundant calls

### Production today

```text
Anime shell
  SearchIntent mode:anime → AniList GraphQL (one HTTP)
  User picks title (AniList id)
  mapAnimeDiscoveryResultToProviderNative()
    Tier 1: searchAllManga() GraphQL if provider needs _id
    Tier 2: provider.search() if registered
  Play: allanime or miruro (AniList id works for miruro resolve directly)

Series/movie shell
  TMDB/Videasy search
  compatibleProviders: ["vidking"] only
  Episodes: TMDB fetchEpisodes (not provider)
```

Miruro has **no** `search` on `miruroProviderModule` — only `listEpisodes` + `resolve`.

### Experiment: Miruro pipe `search` path

`analyze-search.ts` / `miruro-headless.ts` use:

```json
{ "path": "search", "query": { "q": "...", "limit": 15, "offset": 0, "type": "ANIME" } }
```

Live probe `probe-pipe-search.ts` hit intermittent `ECONNRESET` (same as pipe episodes). When episodes work, search path is **likely** valid — needs cached fixture capture on success.

### Anti-pattern: triple search

```text
AniList search + AllManga search + Miruro pipe search   // BAD on every selection
```

### Smart unified lanes (recommended)

```text
Lane A — Discovery (always one)
  anime → AniList GraphQL
  series/movie → TMDB/Videasy

Lane B — Provider identity (only when needed)
  allanime selected → map AniList → show._id (searchAllManga or provider search)
  miruro selected → keep AniList id (no mapping call)

Lane C — Enrich (optional, deferred)
  On-demand: miruro pipe search to verify availability / alternate spelling
  Or: filter chip provider:miruro in SearchIntent routes discovery to pipe search ONLY when user opts in

Lane D — Play metadata (on resolve, cached)
  episodes pipe (30m) + sources pipe (5m) — already in miruro/direct.ts
```

### Using Miruro as “search layer” for AllManga?

| Approach | Pros | Cons |
|----------|------|------|
| Replace AllManga search in mapping | One less GraphQL | Loses `_id` mapping; Miruro results may not match AllAnime catalog |
| Miruro search only when `provider:miruro` filter | Correct lane | Extra pipe call; user-driven |
| Keep AniList + mapping | Works today | Extra GraphQL for allanime users |

**Evidence-based recommendation:**
**Do not** replace AllManga search with Miruro search globally. Use:

- **AniList** for discovery and filters (`genre:`, `mode:anime`, `year:`).
- **Mapping** only for `allanime` play.
- **Miruro** play with AniList id directly.
- Optional **`provider:miruro`** search intent → pipe `search` (implement `miruroProviderModule.search` once fixture proves shape).

---

## 4. Filter / intent routes (make data land in the right lane)

`SearchIntent` already supports (`apps/cli/src/domain/search/SearchIntentParser.ts`):

- `mode:anime` | `series` | `movie` | `all`
- `type:movie` | `series`
- `genre:…`
- `provider:…` (parsed but needs routing policy)

### Recommended routing policy

| Intent | Search backend | Default provider | Play mediaKind |
|--------|----------------|------------------|----------------|
| `mode:anime` | AniList | config `animeProvider` | anime |
| `mode:series` | TMDB | vidking | series |
| `mode:movie` | TMDB | vidking | movie |
| `provider:miruro` | AniList OR miruro pipe (if implemented) | miruro | anime |
| `provider:allanime` | AniList + map | allanime | anime |
| `genre:animation` + `type:series` | TMDB (+ flag `likelyAnime`) | user choice | series* |

\*For TMDB anime in series shell, do **not** auto-fallback to allanime until `genreIds` or `externalIds.anilistId` is populated.

---

## 5. Per-provider: utilizing full capacity

### AllAnime

| Capacity | Used? | Gap |
|----------|-------|-----|
| GQL search + catalog | Yes | — |
| Sub/dub episode lists | Yes | Generic episode labels |
| Parallel source extraction | Yes | Can over-fetch |
| MAL on catalog | Yes | AniSkip |
| Thumbnail on show | Search | Not episode list |
| Intro timing in stream | Unlikely | Use AniSkip |

**Best use:** Primary anime when user wants AllAnime CDN / mirrors.
**Fix:** Manifest/fallback mismatch (§1).

### Miruro

| Capacity | Used? | Gap |
|----------|-------|-----|
| Pipe episodes + sources | Yes | — |
| kiwi/bee × sub/dub | Yes | — |
| Episode titles in listEpisodes | Yes | — |
| Seek VTT in artwork | Partial | mpv wiring |
| Intro/outro | **No** | metadata + timing source |
| Pipe search | **No** | optional Lane C |
| AniList id | Yes | — |

**Best use:** Anime fallback with rich metadata; future provider-first skip.

### VidKing

| Capacity | Used? | Gap |
|----------|-------|-----|
| WASM decrypt | Yes | — |
| Multi-server cycle | Yes | Retry fan-out |
| Subtitles in payload | Sometimes | Late Wyzie in app |
| TMDB episodes in shell | Yes | Not provider |
| IntroDB | App layer | TMDB id |

**Best use:** Default TMDB movie/TV.
**Fix:** Failure-path HTTP budget.

### Rivestream

| Capacity | Used? | Gap |
|----------|-------|-----|
| secretKey hash | Yes | — |
| Dynamic services list | Partial | **Not cached** |
| captions | Yes | — |
| relaySafe | Manifest | — |

**Best use:** TMDB fallback only.

---

## 6. Better routes & techniques (ranked by evidence)

| Technique | When | Evidence |
|-----------|------|----------|
| Fix fallback manifest filter | Now | §1 offline proof |
| Provider timing before AniSkip | After Miruro metadata map | Fixture + ledger |
| Services TTL (Rivestream) | Now | Every cold resolve hits services |
| VidKing 404 non-retry | Now | Code review |
| AniList discovery + conditional mapping | Keep | anime-provider-mapping |
| Miruro pipe search as opt-in | After fixture | Experiment path exists |
| theanimecommunity backend | **Reject** | Returns only `mediaItemID` |
| Playwright default | **Reject** | Lab only |
| TLS impersonation via ProviderFetchPort | When 403 classified | fetch.ts seam |
| Dynamic PIPE_KEY on decode fail | When rotation proven | Hardcoded still works in probe |

---

## 7. Implementation slices (ordered)

1. **P0** — Fallback: drop `allanime` from `series`/`movie` fallback (manifest or filter by `input.mode === "anime"`).
2. **P0** — Miruro intro/outro → metadata + `ProviderStreamTimingSource` first in aggregator.
3. **P1** — VidKing retry/variant trim; Rivestream services cache.
4. **P2** — SearchIntent `provider:miruro` → optional `miruroProviderModule.search` (pipe).
5. **P2** — TMDB `genreIds` on `SearchResult` for animation detection (enables smart anime fallback from series shell).
6. **P3** — Cineby flavor promotion (research).

---

## 8. Tests to add (deterministic)

```text
playback-resolve-service: series mode + vidking primary → candidates must NOT include allanime
providers.test: miruro fixture → metadata.intro/outro present after map
search-intent: provider:miruro routes to anime mode + miruro provider
```

---

## 9. Commands

```sh
bun scratchpads/analyze-fallback-and-timing.ts
bun run --cwd apps/experiments providers:probe
bun run --cwd apps/experiments miruro:probe
# When network stable:
bun scratchpads/provider-miruro/probe-pipe-search.ts
```
