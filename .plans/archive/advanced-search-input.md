# Advanced Search Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current cosmetic browse-filter box with a real `SearchIntent`-driven advanced search surface.

**Architecture:** Search input text is parsed once by domain code into `SearchIntent`. Search/catalog backends receive that intent, report which filters were applied upstream, applied locally, or unsupported, and the browse shell displays that evidence honestly. UI chips and `/filters` are guided editing surfaces over the same intent contract, not a separate behavior path.

**Tech Stack:** Bun, TypeScript, Ink, existing CLI search/catalog services, TMDB/Videasy, AniList.

---

## File Structure

- `apps/cli/src/domain/search/SearchIntent.ts`: Own the serializable search intent model, including advanced filters such as type, genre, rating, year, release, provider, local library, and sort.
- `apps/cli/src/domain/search/SearchIntentParser.ts`: Own query-token parsing and filter descriptions.
- `apps/cli/src/domain/search/SearchIntentEngine.ts`: Normalize parsed text against current shell context and produce UI chips/warnings.
- `apps/cli/src/app-shell/browse-filters.ts`: Become a thin browse-local adapter that applies only explicitly local fallback filters to shell options.
- `apps/cli/src/services/search/SearchService.ts`: Move from `search(query: string)` toward `search(intent: SearchIntent)`.
- `apps/cli/src/app/search-routing.ts`: Route `SearchIntent` to TMDB, AniList, or provider-native search based on mode and capabilities.
- `apps/cli/src/app/SearchPhase.ts`: Pass full intent through browse search and diagnostics.
- `apps/cli/src/app-shell/ink-shell.tsx`: Render applied/local/unsupported filter chips and keep the input/editing behavior stable.
- `apps/cli/test/unit/domain/search/*`: Domain parser and intent tests.
- `apps/cli/test/unit/app-shell/browse-filters.test.ts`: Local fallback filtering tests.

## Task 1: Unify Browse Parsing Under `SearchIntent`

**Files:**

- Modify: `apps/cli/src/domain/search/SearchIntent.ts`
- Modify: `apps/cli/src/domain/search/SearchIntentParser.ts`
- Modify: `apps/cli/src/app-shell/browse-filters.ts`
- Test: `apps/cli/test/unit/domain/search/search-intent-parser.test.ts`
- Test: `apps/cli/test/unit/app-shell/browse-filters.test.ts`

- [x] **Step 1: Write failing parser tests**

Add tests showing that `type:series`, `genre:action`, `rating:8`, and `year:2010..2020` are parsed by the domain parser rather than browse-local string splitting.

Run:

```sh
bun run --cwd apps/cli test apps/cli/test/unit/domain/search/search-intent-parser.test.ts
```

Expected: FAIL because `type`, `genre`, and `rating` are not part of `SearchIntentFilters`.

- [x] **Step 2: Implement parser support**

Extend `SearchIntentFilters` with:

```ts
readonly type?: "movie" | "series" | "all";
readonly genres?: readonly string[];
readonly minRating?: number;
```

Update `parseSearchIntentText` so `type`, `genre`, `genres`, `rating`, and `min` produce normalized filters.

- [x] **Step 3: Reduce browse parser duplication**

Change `parseBrowseFilterQuery` to call `parseSearchIntentText(query)` directly and derive local fallback filters from the parsed intent. Keep `applyBrowseResultFilters` limited to known local data: type, year, and rating.

- [x] **Step 4: Run focused tests**

Run:

```sh
bun run --cwd apps/cli test apps/cli/test/unit/domain/search/search-intent-parser.test.ts apps/cli/test/unit/app-shell/browse-filters.test.ts
```

Expected: PASS.

## Task 2: Introduce Search Application Evidence

**Files:**

- Modify: `apps/cli/src/domain/search/SearchIntent.ts`
- Modify: `apps/cli/src/services/search/SearchService.ts`
- Modify: `apps/cli/src/app/search-routing.ts`
- Test: `apps/cli/test/unit/app/search-routing.test.ts`

- [ ] **Step 1: Add failing tests for applied/local/unsupported filters**

Test that a search result bundle can report:

```ts
appliedFilters: ["mode anime", "genre action"];
localFilters: ["downloaded true"];
unsupportedFilters: ["provider vidking"];
```

- [ ] **Step 2: Add evidence types**

Add a search response metadata shape that tracks applied, local, and unsupported filter chips without changing `SearchResult`.

- [ ] **Step 3: Thread evidence through `searchTitles`**

Return evidence alongside `results`, `sourceId`, `sourceName`, and `strategy`.

## Task 3: Capability-Aware Catalog Search

**Files:**

- Modify: `apps/cli/src/services/search/definitions/tmdb.ts`
- Modify: `apps/cli/src/search.ts`
- Create: `apps/cli/src/services/search/definitions/anilist.ts`
- Modify: `apps/cli/src/services/search/definitions/index.ts`
- Test: `apps/cli/test/unit/services/search/search-capabilities.test.ts`

- [ ] **Step 1: Add tests for TMDB discover routing**

Assert that an empty query with `genre`, `year`, or `rating` uses discover-style URL construction instead of `/search/multi`.

- [ ] **Step 2: Add TMDB intent query builder**

Map supported filters to TMDB discover params:

```text
type -> /discover/movie or /discover/tv
year -> primary_release_year or first_air_date_year
rating -> vote_average.gte
genre -> with_genres after genre name/id mapping
sort -> sort_by
```

- [ ] **Step 3: Add AniList search adapter**

Map anime filters to AniList GraphQL variables for `search`, `genre`, `seasonYear`, `averageScore_greater`, and `sort`.

## Task 4: Browse UI Evidence And Guided Chips

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Modify: `apps/cli/src/app/SearchPhase.ts`
- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Test: `apps/cli/test/unit/app/search-phase-commands.test.ts`

- [ ] **Step 1: Show evidence chips**

Render applied filters, local filters, and unsupported filters with distinct tones. Unsupported filters must never look successful.

- [ ] **Step 2: Update `/filters` options**

Offer guided chips for `mode`, `type`, `genre`, `year`, `rating`, `release`, `watched`, `downloaded`, and `sort`.

- [ ] **Step 3: Preserve input semantics**

Keep `/` as command palette, `Esc` as clear/back, and normal text editing behavior intact.

## Task 5: Verification

**Files:**

- All files above.

- [ ] **Step 1: Run focused tests**

```sh
bun run test --filter=apps/cli
```

- [ ] **Step 2: Run required finish checks**

```sh
bun run typecheck
bun run lint
bun run fmt
```

- [ ] **Step 3: Manual smoke**

Run:

```sh
bun run dev
```

Smoke cases:

```text
solo leveling mode:anime genre:action rating:8
breaking bad type:series year:2008 rating:9
genre:comedy year:2024 sort:popular
```

Expected: chips show what was applied, local-only, or unsupported; results are changed only by filters that the evidence claims were applied.
