# Search Filter UX Repair (Track B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make advertised search filter tokens parse and apply honestly, split `/filters` (guided facets) from Ctrl+F (substring narrow), and keep browse Enter and bootstrap/`-S` on one `FilterState` → `SearchIntent` pipeline.

**Architecture:** Domain owns canonical `FilterState` (Approach 1). Typed tokens and the `/filters` facet sheet both mutate that state; `SearchRoutingService` classifies upstream / local / unsupported evidence; browse Ctrl+F only mutates a separate `resultFilter` string. YouTube content shapes live on the existing `FilterState.type` allowlist (`video|playlist|channel`) alongside TMDB `movie|series|all` — no dedicated `shape:` key.

**Tech Stack:** Bun, TypeScript, Ink browse shell, `SearchIntentParser` / `SearchIntentEngine`, `SearchRoutingService`, unit tests under `apps/cli/test/unit`.

## Global Constraints

- Depends on Track A chrome preferably (slice A6); may start after A3 if parallelized carefully — do not regress focus/overlay ownership fixed in A6.
- Spec: `docs/superpowers/specs/2026-07-21-history-continue-reliability-design.md` §10 Track B (slices B1–B5).
- `type:anime` aliases to `mode:anime` with a calm correction warning — never silent ignore.
- `mode:youtube` must parse (add to `SEARCH_MODES`).
- YouTube content shape tokens are `type:video|playlist|channel` on `FilterState.type` / `SearchIntentTypeFilter` (extend the type allowlist; do not invent `shape:`).
- TMDB lane keeps `type:movie|series|all`; YouTube lane uses `type:video|playlist|channel`.
- `/filters` opens guided facets idle **and** with results; Ctrl+F only narrows loaded results.
- Bootstrap / `-S` must call `searchTitles(intent)`, never string-only drop of filters.
- Library filters (`downloaded` / `watched` / `release`) are real against enrichment/history facts or unavailable in the facet UI — no string-heuristic theater marked as applied.
- Use no live providers for B1–B4 (and B5 unit tests).
- Do not use `bun test` directly — use `bun run --cwd apps/cli test:file -- …` or `bun run --cwd apps/cli test:unit`.
- Do not change provider scrape contracts, relay policy, or calendar type-tab behavior.
- Preserve unrelated working-tree paths (installer reference, release notes, etc.).

## File structure

| File                                                   | Responsibility                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apps/cli/src/domain/search/SearchIntent.ts`           | `SearchIntentTypeFilter` allowlist includes YouTube shapes; chip describe stays honest                          |
| `apps/cli/src/domain/search/SearchIntentParser.ts`     | `SEARCH_MODES` + `type:anime` alias + YouTube type values + corrections                                         |
| `apps/cli/src/domain/search/SearchIntentEngine.ts`     | Surface alias corrections as warnings/chips                                                                     |
| `apps/cli/src/services/search/SearchRoutingService.ts` | Intent apply + evidence; YouTube `contentShape` local filter; library evidence honesty                          |
| `apps/cli/src/app/search/SearchPhase.ts`               | Bootstrap intent parity; `/filters` → `chooseSearchFilterChip`; facet option list                               |
| `apps/cli/src/app-shell/browse-shell.tsx`              | Stop `/filters` hijack; Ctrl+F → narrow only; chip clear UI; Esc ladder; copy                                   |
| `apps/cli/src/app-shell/browse-filters.ts`             | Structured local apply (typed fields / `contentShape`); retire bag-of-words library heuristics                  |
| `apps/cli/src/app/search/browse-option-mappers.ts`     | Stable typed kind + `localFilterFacts` for real library apply                                                   |
| `apps/cli/src/app-shell/types.ts`                      | `ShellAction` split: `filters` vs `narrow-results`                                                              |
| `apps/cli/src/app-shell/keybindings.ts`                | Ctrl+F maps to narrow, not facets                                                                               |
| Copy / truth                                           | README / quickstart / `docs/users/commands-and-shortcuts.mdx` as needed; `.plans/search-filter-state.md` status |

---

### Task 1: Parser vocabulary + YouTube type allowlist (B1)

**Files:**

- Modify: `apps/cli/src/domain/search/SearchIntent.ts`
- Modify: `apps/cli/src/domain/search/SearchIntentParser.ts`
- Modify: `apps/cli/src/domain/search/SearchIntentEngine.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx` (`browseEmptyDetail`, `browseFilterPlaceholder`)
- Modify: `apps/cli/test/unit/domain/search/search-intent-parser.test.ts`
- Modify: `apps/cli/test/unit/domain/search/search-intent-engine.test.ts`
- Modify: `apps/cli/test/unit/domain/search/search-intent.test.ts` (if normalize/chip describe needs updates)

**Interfaces:**

```ts
/** TMDB media types + YouTube content shapes share FilterState.type (locked). */
export type SearchIntentTypeFilter = "movie" | "series" | "all" | "video" | "playlist" | "channel";

export type SearchIntentParseCorrection = {
  readonly from: string;
  readonly to: string;
  readonly message: string;
};

export type ParsedSearchIntentText = {
  readonly query: string;
  readonly filterState: FilterState;
  readonly filters: SearchIntentFilters;
  readonly sort?: SearchSort;
  readonly mode?: SearchIntentMode;
  readonly errors: readonly SearchIntentParseError[];
  readonly corrections: readonly SearchIntentParseCorrection[];
};
```

Locked parser sets (replace today's incomplete allowlists):

```ts
const SEARCH_MODES = new Set<SearchIntentMode>(["anime", "series", "movie", "youtube", "all"]);
const TYPE_FILTERS = new Set<SearchIntentTypeFilter>([
  "movie",
  "series",
  "all",
  "video",
  "playlist",
  "channel",
]);
```

- Consumes: existing `FilterState` / `parseSearchIntentText`
- Produces: `mode:youtube` parses; `type:anime` → `mode:anime` with correction; `type:video|playlist|channel` parse into `filterState.type`

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, test } from "bun:test";

import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";

describe("SearchIntentParser Track B vocabulary", () => {
  test("parses mode:youtube", () => {
    expect(parseSearchIntentText("lofi mode:youtube")).toMatchObject({
      query: "lofi",
      mode: "youtube",
      errors: [],
      corrections: [],
    });
  });

  test("aliases type:anime to mode:anime with correction", () => {
    const parsed = parseSearchIntentText("mob type:anime year:2024");
    expect(parsed).toMatchObject({
      query: "mob",
      mode: "anime",
      filters: { year: 2024 },
      errors: [],
    });
    expect(parsed.filterState.mode).toBe("anime");
    expect(parsed.filterState.type).toBeUndefined();
    expect(parsed.corrections).toEqual([
      {
        from: "type:anime",
        to: "mode:anime",
        message: "Interpreted type:anime as mode:anime",
      },
    ]);
  });

  test("parses YouTube content shapes on type allowlist", () => {
    expect(parseSearchIntentText("jazz type:playlist mode:youtube")).toMatchObject({
      query: "jazz",
      mode: "youtube",
      filters: { type: "playlist" },
      filterState: { query: "jazz", mode: "youtube", type: "playlist" },
      errors: [],
    });
    expect(parseSearchIntentText("type:video").filters.type).toBe("video");
    expect(parseSearchIntentText("type:channel").filters.type).toBe("channel");
  });

  test("engine surfaces alias correction as a warning", () => {
    const result = createSearchIntentEngine().fromText("dune type:anime", {
      currentMode: "series",
    });
    expect(result.intent.mode).toBe("anime");
    expect(result.warnings.some((w) => w.includes("type:anime"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/search/search-intent-parser.test.ts \
  test/unit/domain/search/search-intent-engine.test.ts
```

Expected: FAIL — `mode:youtube` treated as unsupported-value; `type:anime` unsupported; `type:playlist` unsupported; `corrections` missing.

- [ ] **Step 3: Extend types and parser**

In `SearchIntent.ts`, widen `SearchIntentTypeFilter` as in Interfaces.

In `SearchIntentParser.ts`:

1. Expand `SEARCH_MODES` / `TYPE_FILTERS`.
2. Add `corrections: SearchIntentParseCorrection[]` to the parse loop.
3. On `key === "type"` and `value === "anime"`: set `mode = "anime"`, push correction, do **not** set `filters.type`.
4. On `key === "type"` and YouTube values: set `filters.type` via `isTypeFilter`.
5. Return `corrections` on `ParsedSearchIntentText`.

In `SearchIntentEngine.ts`, map `parsed.corrections` into `warnings` (e.g. `Interpreted type:anime as mode:anime`).

Update chip describe if needed so `type playlist` appears for YouTube shapes (existing `describeFilterStateChips` already prints `type ${state.type}`).

- [ ] **Step 4: Fix advertised copy**

Replace invalid teaching strings:

```ts
// browse-shell.tsx browseEmptyDetail
if (mode === "youtube") {
  return "Use type:playlist|video|channel to narrow · /filters for guided facets";
}
return "Use year:2022 or mode:anime to narrow · /filters for guided facets";
```

Scan and fix the same token lies in README / `.docs/quickstart.md` / `docs/users/commands-and-shortcuts.mdx` if they teach `type:anime` without the alias note.

- [ ] **Step 5: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/search/search-intent-parser.test.ts \
  test/unit/domain/search/search-intent-engine.test.ts \
  test/unit/domain/search/search-intent.test.ts
```

Expected: PASS

```bash
git add apps/cli/src/domain/search/SearchIntent.ts \
  apps/cli/src/domain/search/SearchIntentParser.ts \
  apps/cli/src/domain/search/SearchIntentEngine.ts \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/test/unit/domain/search/search-intent-parser.test.ts \
  apps/cli/test/unit/domain/search/search-intent-engine.test.ts \
  apps/cli/test/unit/domain/search/search-intent.test.ts
git commit -m "$(cat <<'EOF'
fix(search): parse mode:youtube and alias type:anime

EOF
)"
```

---

### Task 2: Split `/filters` facets from Ctrl+F narrow (B2)

**Files:**

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/keybindings.ts` (label for `browse-filter`)
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Modify: `apps/cli/src/app/search/SearchPhase.ts` (`chooseSearchFilterChip` options: add YouTube types; keep `mode:youtube`)
- Create: `apps/cli/src/app-shell/browse-filter-actions.ts`
- Create: `apps/cli/test/unit/app-shell/browse-filter-actions.test.ts`
- Modify: `apps/cli/test/unit/app-shell/browse-search-state.test.ts` if narrow open semantics change

**Interfaces:**

```ts
// apps/cli/src/app-shell/types.ts — extend ShellAction
export type ShellAction =
  | "details"
  | "filters" // palette /filters → guided facets (SearchPhase)
  | "narrow-results" // Ctrl+F → substring resultFilter only
  | /* …existing… */;

export type BrowseFilterActionDecision =
  | { readonly kind: "open-facets" }
  | { readonly kind: "open-narrow" }
  | { readonly kind: "ignore" };

export function decideBrowseFilterAction(input: {
  readonly action: "filters" | "narrow-results";
  readonly searchState: "idle" | "loading" | "ready" | "error";
  readonly optionCount: number;
  readonly isCalendarView: boolean;
}): BrowseFilterActionDecision;
```

Locked behavior:

| Input                                                                | Decision                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `action: "filters"` (idle or ready, non-calendar)                    | `open-facets` — browse must **not** swallow; return false from local handler so SearchPhase runs `chooseSearchFilterChip` |
| `action: "narrow-results"` with `ready` + options > 0 + not calendar | `open-narrow` — set `filterModeOpen`, focus filter zone                                                                   |
| `action: "narrow-results"` idle / empty / calendar                   | `ignore`                                                                                                                  |

- Consumes: Task 1 vocabulary (facet chips include valid tokens only)
- Produces: `/filters` always reaches facets; Ctrl+F never opens facets

- [ ] **Step 1: Write the failing action-routing tests**

```ts
import { describe, expect, test } from "bun:test";

import { decideBrowseFilterAction } from "@/app-shell/browse-filter-actions";

describe("decideBrowseFilterAction", () => {
  test("/filters opens facets when idle", () => {
    expect(
      decideBrowseFilterAction({
        action: "filters",
        searchState: "idle",
        optionCount: 0,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-facets" });
  });

  test("/filters opens facets when results are loaded", () => {
    expect(
      decideBrowseFilterAction({
        action: "filters",
        searchState: "ready",
        optionCount: 12,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-facets" });
  });

  test("Ctrl+F narrows only when results exist", () => {
    expect(
      decideBrowseFilterAction({
        action: "narrow-results",
        searchState: "ready",
        optionCount: 12,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "open-narrow" });

    expect(
      decideBrowseFilterAction({
        action: "narrow-results",
        searchState: "idle",
        optionCount: 0,
        isCalendarView: false,
      }),
    ).toEqual({ kind: "ignore" });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/browse-filter-actions.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement decision helper + wire shell**

1. Create `browse-filter-actions.ts` with `decideBrowseFilterAction` as above.
2. Add `"narrow-results"` to `ShellAction` and `toShellAction` if needed.
3. In `browse-shell.tsx` footer `actions` map:
   - `"browse-filter": "narrow-results"` (was `"filters"`).
4. Update `handleLocalAction`:

```ts
if (action === "filters") {
  // Never hijack — SearchPhase owns guided facets (idle + with results).
  return false;
}
if (action === "narrow-results") {
  const decision = decideBrowseFilterAction({
    action: "narrow-results",
    searchState,
    optionCount: options.length,
    isCalendarView,
  });
  if (decision.kind === "open-narrow") {
    setFilterModeOpen(true);
    setCommandMode(false);
    setCommandInput("");
    setHighlightedCommandIndex(0);
    setFocusZone("filter");
  }
  return true;
}
```

5. Ensure palette command id `"filters"` still resolves to ShellAction `"filters"` and bubbles to SearchPhase (`outcome.action === "filters"` → `chooseSearchFilterChip`).
6. Update keybinding label: `"Narrow loaded results"` (not “filter field” as if it were structured filters).
7. In `chooseSearchFilterChip`, add YouTube shape chips and drop any chip that still advertises invalid tokens:

```ts
{ value: "type:video", label: "YouTube · Videos", detail: "Only videos" },
{ value: "type:playlist", label: "YouTube · Playlists", detail: "Only playlists" },
{ value: "type:channel", label: "YouTube · Channels", detail: "Only channels" },
```

Keep `mode:youtube` / `mode:anime`. Do not offer `type:anime` in the sheet (users who type it still get Task 1 alias).

- [ ] **Step 4: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/browse-filter-actions.test.ts \
  test/unit/app-shell/browse-search-state.test.ts
```

Expected: PASS

```bash
git add apps/cli/src/app-shell/browse-filter-actions.ts \
  apps/cli/src/app-shell/types.ts \
  apps/cli/src/app-shell/keybindings.ts \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/src/app/search/SearchPhase.ts \
  apps/cli/test/unit/app-shell/browse-filter-actions.test.ts
git commit -m "$(cat <<'EOF'
fix(shell): split /filters facets from Ctrl+F narrow

EOF
)"
```

---

### Task 3: Single apply pipeline + bootstrap parity (B3)

**Files:**

- Modify: `apps/cli/src/app/search/SearchPhase.ts` (bootstrap `searchTitles` call ~line 262)
- Modify: `apps/cli/src/services/search/SearchRoutingService.ts` (`applyLocalSearchFilters` for YouTube `contentShape`)
- Modify: `apps/cli/src/app-shell/browse-filters.ts` (`getOptionType` / type apply for YouTube shapes)
- Modify: `apps/cli/src/app/search/browse-option-mappers.ts` (stable typed meta for Anime/YouTube)
- Modify: `apps/cli/test/unit/services/search/search-routing.test.ts`
- Modify: `apps/cli/test/unit/app-shell/browse-filters.test.ts`
- Create: `apps/cli/test/unit/app/search/search-phase-bootstrap-intent.test.ts` (pure helper extraction if needed)

**Interfaces:**

```ts
/** Local type apply — TMDB uses ContentType; YouTube uses contentShape. */
export function matchesIntentTypeFilter(
  result: Pick<SearchResult, "type" | "contentShape" | "isAnime">,
  type: SearchIntentTypeFilter | undefined,
): boolean;

// Bootstrap must use full intent:
searchTitles(searchIntent.intent, {/* context */});
// NOT: searchTitles(searchIntent.intent.query, { mode only })
```

Evidence honesty stays in `classifySearchEvidence` / `applyLocalSearchFilters`:

- When `evidence.local` includes `type` and filter is `video|playlist|channel`, filter `result.contentShape === type`.
- When filter is `movie|series`, keep `result.type === type`.
- When filter is `all`, no type narrowing.

- Consumes: Task 1 type allowlist; Task 2 command split
- Produces: bootstrap/`-S` token parity with browse Enter; YouTube type filters apply locally with honest badges

- [ ] **Step 1: Write failing routing + bootstrap tests**

```ts
import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import { searchTitles } from "@/services/search/SearchRoutingService";

test("applies type:playlist locally against SearchResult.contentShape", async () => {
  const searchRegistry = {
    getDefault: () => ({
      metadata: { id: "youtube-catalog", name: "YouTube" },
      search: async () => [
        {
          id: "youtube:v1",
          type: "movie",
          title: "Track",
          year: "",
          overview: "",
          posterPath: null,
          contentShape: "video",
        },
        {
          id: "youtube:p1",
          type: "movie",
          title: "Mix",
          year: "",
          overview: "",
          posterPath: null,
          contentShape: "playlist",
        },
      ],
    }),
    getForProvider: () => undefined,
  };

  const providerRegistry: any = {
    get: () => ({
      metadata: {
        id: "youtube",
        name: "YouTube",
        description: "",
        recommended: true,
        isAnimeProvider: false,
        domain: "youtube.com",
      },
      search: async () => searchRegistry.getDefault().search(),
    }),
    getDefault: () => providerRegistry.get(),
    getDefaultForMode: () => providerRegistry.get(),
  };

  const result = await searchTitles(
    normalizeSearchIntent({
      query: "mix",
      mode: "youtube",
      filters: { type: "playlist" },
    }),
    {
      mode: "youtube",
      providerId: "youtube",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
      searchRegistry: searchRegistry as any,
      providerRegistry,
    },
  );

  expect(result.results.map((r) => r.id)).toEqual(["youtube:p1"]);
  expect(result.evidence.local).toContain("type playlist");
  expect(result.evidence.unsupported).not.toContain("type playlist");
});

test("bootstrap helper keeps structured filters on the intent path", () => {
  const engine = createSearchIntentEngine().fromText("mob mode:anime year:2024 rating:7", {
    currentMode: "series",
  });
  expect(engine.intent).toMatchObject({
    query: "mob",
    mode: "anime",
    filters: { year: 2024, minRating: 7 },
  });
});
```

Add the engine import at the top of that test file alongside the routing imports:

```ts
import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
```

Also add a browse-filters regression:

```ts
test("filters YouTube playlist options by typed content shape, not preview bag-of-words", () => {
  const options = [
    {
      value: "v",
      label: "Video",
      previewMeta: ["Video"],
      localFilterFacts: { contentShape: "video" as const },
    },
    {
      value: "p",
      label: "Playlist",
      previewMeta: ["Playlist"],
      localFilterFacts: { contentShape: "playlist" as const },
    },
  ];
  const filtered = applyBrowseResultFilters(
    options as any,
    parseBrowseFilterQuery("type:playlist").filters,
  );
  expect(filtered.map((o) => o.value)).toEqual(["p"]);
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/search/search-routing.test.ts \
  test/unit/app-shell/browse-filters.test.ts
```

Expected: FAIL — `type playlist` unsupported or not applied; browse still uses Movie/Series-only `getOptionType`.

- [ ] **Step 3: Fix bootstrap + local type apply**

1. In `SearchPhase.ts` bootstrap branch (~`searchTitles(searchIntent.intent.query, { mode: searchMode, … })`), change to:

```ts
const search = await observeOnline(container, "search-error", () =>
  searchTitles(searchIntent.intent, {
    mode: stateManager.getState().mode, // session mode; intent.mode routes inside service
    providerId: currentState.provider,
    animeLanguageProfile: container.config.animeLanguageProfile,
    youtubeLanguageProfile: container.config.youtubeLanguageProfile,
    signal: context.signal,
    searchRegistry,
    providerRegistry,
    enrichAnimeMetadata: true,
  }),
);
```

Align with the already-correct browse `onSearch` path that passes `searchIntent.intent`.

2. In `SearchRoutingService.applyLocalSearchFilters`, when local `type` applies:

```ts
if (localKeys.has("type") && intent.filters.type && intent.filters.type !== "all") {
  const type = intent.filters.type;
  filtered = filtered.filter((result) => {
    if (type === "video" || type === "playlist" || type === "channel") {
      return result.contentShape === type;
    }
    return result.type === type;
  });
}
```

Ensure `getLocalFilterKeys` includes `type` for YouTube provider-native and registry paths when `filters.type` is set (so evidence.local gets `type playlist`, not unsupported).

3. In `browse-filters.ts`, stop deriving type solely from `"Movie"|"Series"` strings. Prefer `option.localFilterFacts` (Task 3/5) or `option.value` when it is a `SearchResult`:

```ts
function getOptionTypeFilterMatch<T>(
  option: BrowseShellOption<T>,
  wanted: SearchIntentTypeFilter,
): boolean {
  if (wanted === "all") return true;
  const facts = option.localFilterFacts;
  if (wanted === "video" || wanted === "playlist" || wanted === "channel") {
    return facts?.contentShape === wanted;
  }
  if (wanted === "movie" || wanted === "series") {
    return (facts?.mediaType ?? getLegacyPreviewType(option)) === wanted;
  }
  return true;
}
```

4. In `browse-option-mappers.ts` `toBrowseResultOption`, attach:

```ts
localFilterFacts: {
  mediaType: result.type,
  contentShape: result.contentShape,
  isAnime: result.isAnime === true,
},
```

Extend `BrowseShellOption` in `types.ts` with optional `localFilterFacts`.

- [ ] **Step 4: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/search/search-routing.test.ts \
  test/unit/app-shell/browse-filters.test.ts \
  test/unit/domain/search/search-intent-parser.test.ts
```

Expected: PASS

```bash
git add apps/cli/src/app/search/SearchPhase.ts \
  apps/cli/src/services/search/SearchRoutingService.ts \
  apps/cli/src/app-shell/browse-filters.ts \
  apps/cli/src/app-shell/types.ts \
  apps/cli/src/app/search/browse-option-mappers.ts \
  apps/cli/test/unit/services/search/search-routing.test.ts \
  apps/cli/test/unit/app-shell/browse-filters.test.ts
git commit -m "$(cat <<'EOF'
fix(search): keep bootstrap filters on the intent pipeline

EOF
)"
```

---

### Task 4: Chip clear UX + Esc ladder (B4)

**Files:**

- Modify: `apps/cli/src/domain/search/SearchIntent.ts` (helpers already: `clearFilterStateKey`, `describeFilterStateChips`)
- Modify: `apps/cli/src/app-shell/browse-filters.ts` (`clearBrowseResultFilter`, query rewrite helper)
- Create: `apps/cli/src/app-shell/browse-filter-chips.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx` (render clearable chips; Esc ladder)
- Create: `apps/cli/test/unit/app-shell/browse-filter-chips.test.ts`
- Modify: `apps/cli/test/unit/app-shell/browse-filters.test.ts`

**Interfaces:**

```ts
export type BrowseEscFilterLayer = "narrow" | "chips" | "results" | "query" | "cancel";

export function nextBrowseEscFilterLayer(input: {
  readonly narrowOpenOrFocused: boolean;
  readonly resultFilterNonEmpty: boolean;
  readonly structuredChipCount: number;
  readonly hasResultsOrErrorOrLoading: boolean;
  readonly queryNonEmpty: boolean;
}): BrowseEscFilterLayer;

export function removeFilterTokenFromQuery(query: string, key: FilterStateKey): string;
```

Locked Esc ladder (exact):

1. **narrow** — if result-filter focused / `filterModeOpen` / `resultFilter` non-empty → clear `resultFilter`, close narrow UI, focus query. Do **not** clear structured chips.
2. **chips** — else if `describeFilterStateChips(filterState).length > 0` → clear **all** structured filter tokens from the query bar (keep plain text query); do not clear `resultFilter` (already empty). Optional auto-research when results were loaded.
3. **results** — else if options/error/loading → `clearResults()` (existing).
4. **query** — else if query non-empty → clear query (existing).
5. **cancel** — else `onCancel()` (existing).

Chip clear (clear-one):

- Render chips from `describeFilterStateChips` / engine chips above the query bar when `FilterState` has keys.
- Activating clear on one chip calls `clearBrowseResultFilter` + `removeFilterTokenFromQuery` so siblings remain.
- Backspace on empty query with chips present clears the **last** chip only (not all).

- Consumes: `clearFilterStateKey` / `clearBrowseResultFilter` from domain + browse-filters
- Produces: clear-one keeps others; Esc peels narrow → chips → results → query → cancel

- [ ] **Step 1: Write failing chip + Esc tests**

```ts
import { describe, expect, test } from "bun:test";

import {
  nextBrowseEscFilterLayer,
  removeFilterTokenFromQuery,
} from "@/app-shell/browse-filter-chips";
import {
  clearBrowseResultFilter,
  describeBrowseResultFilters,
  parseBrowseFilterQuery,
} from "@/app-shell/browse-filters";

describe("browse filter chips", () => {
  test("clearing one chip keeps the others", () => {
    const raw = "isekai mode:anime year:2024 rating:8 genre:action";
    const parsed = parseBrowseFilterQuery(raw);
    const withoutYear = clearBrowseResultFilter(parsed.filters, "year");
    expect(describeBrowseResultFilters(withoutYear)).toEqual([
      "mode anime",
      "genre action",
      "rating >= 8",
    ]);
    expect(removeFilterTokenFromQuery(raw, "year")).toBe("isekai mode:anime rating:8 genre:action");
  });

  test("Esc ladder prefers narrow then chips then results", () => {
    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: true,
        resultFilterNonEmpty: true,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("narrow");

    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 2,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("chips");

    expect(
      nextBrowseEscFilterLayer({
        narrowOpenOrFocused: false,
        resultFilterNonEmpty: false,
        structuredChipCount: 0,
        hasResultsOrErrorOrLoading: true,
        queryNonEmpty: true,
      }),
    ).toBe("results");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/browse-filter-chips.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement helpers + shell UI**

1. Implement `removeFilterTokenFromQuery` by re-parsing with `parseSearchIntentText`, `clearFilterStateKey`, then serializing remaining chips + plain query:

```ts
export function removeFilterTokenFromQuery(query: string, key: FilterStateKey): string {
  const parsed = parseSearchIntentText(query);
  const next = clearFilterStateKey(parsed.filterState, key);
  const chips = describeFilterStateChips(next).map(chipToToken); // "mode anime" → "mode:anime"
  return [next.query, ...chips].filter(Boolean).join(" ");
}
```

Provide `chipToToken` that round-trips describe format back to `key:value` tokens (mode/type/genre/year/rating/downloaded/watched/release/audio/subtitles/provider/sort).

2. Implement `nextBrowseEscFilterLayer` per locked ladder.

3. In `browse-shell.tsx` Esc handler, replace the ad-hoc narrow-only branch with the ladder helper.

4. Render a compact chip row when structured chips exist; each chip has a clear affordance that updates the query draft via `removeFilterTokenFromQuery` and optionally re-runs search when results were showing.

- [ ] **Step 4: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/browse-filter-chips.test.ts \
  test/unit/app-shell/browse-filters.test.ts
```

Expected: PASS

```bash
git add apps/cli/src/app-shell/browse-filter-chips.ts \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/src/app-shell/browse-filters.ts \
  apps/cli/test/unit/app-shell/browse-filter-chips.test.ts \
  apps/cli/test/unit/app-shell/browse-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(shell): clearable filter chips and Esc peel order

EOF
)"
```

---

### Task 5: Library filters real or unavailable (B5)

**Files:**

- Modify: `apps/cli/src/app/search/browse-option-mappers.ts`
- Modify: `apps/cli/src/app-shell/browse-filters.ts`
- Modify: `apps/cli/src/services/search/SearchRoutingService.ts` (`getLocalFilterKeys` / `getUnsupportedFilterKeys`)
- Modify: `apps/cli/src/app/search/SearchPhase.ts` (`chooseSearchFilterChip` — hide library chips when source cannot apply)
- Modify: `apps/cli/test/unit/app-shell/browse-filters.test.ts`
- Modify: `apps/cli/test/unit/services/search/search-routing.test.ts`
- Create: `apps/cli/test/unit/app/search/browse-local-filter-facts.test.ts`

**Interfaces:**

```ts
export type BrowseLocalFilterFacts = {
  readonly mediaType?: "movie" | "series";
  readonly contentShape?: "video" | "playlist" | "channel";
  readonly isAnime?: boolean;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter; // derived: unwatched | watching | completed
  readonly release?: ReleaseFilter; // when calendar/release facts exist
};

// On BrowseShellOption:
readonly localFilterFacts?: BrowseLocalFilterFacts;
```

Locked policy:

| Filter                  | When offered / applied                                                                                  | When unavailable                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `downloaded:true/false` | Local apply via `localFilterFacts.downloaded` from `ResultEnrichment` offline badges / offline statuses | Hide from facet sheet for sources with no offline enrichment; if typed anyway → evidence `unsupported`, do **not** bag-of-words match |
| `watched:*`             | Local apply via history-derived `localFilterFacts.watched`                                              | Same — no `previewMeta` string theater                                                                                                |
| `release:*`             | Local apply only when `result.release` / calendar display facts populate `localFilterFacts.release`     | Hide from facets when browse context has no release facts; typed token → unsupported                                                  |

Retire `matchesDownloadedFilter` / `matchesWatchedFilter` / `matchesReleaseFilter` string heuristics in `browse-filters.ts` (delete or demote to unused).

Routing evidence: when browse/local path can apply library facts, move those keys from `getUnsupportedFilterKeys` into `getLocalFilterKeys` for the post-enrichment browse apply path. Upstream search still marks them unsupported at `searchTitles` time if the catalog cannot filter — that is correct for provider search; browse post-filter then applies locally when facts exist. Do not show green “applied” chrome for unsupported upstream-only paths.

- Consumes: Task 3 `localFilterFacts`; enrichment badges from `ResultEnrichmentService`
- Produces: real library apply or hidden/unavailable chips — no theater

- [ ] **Step 1: Write failing library-fact tests**

```ts
import { describe, expect, test } from "bun:test";

import { applyBrowseResultFilters, parseBrowseFilterQuery } from "@/app-shell/browse-filters";
import { buildLocalFilterFacts } from "@/app/search/browse-option-mappers";

describe("library filter facts", () => {
  test("downloaded filter uses structured facts, not detail substrings", () => {
    const options = [
      {
        value: "a",
        label: "Has word downloaded in overview only",
        detail: "downloaded somewhere in text",
        previewMeta: ["Series"],
        localFilterFacts: { mediaType: "series" as const, downloaded: false },
      },
      {
        value: "b",
        label: "Actually offline",
        previewMeta: ["Series"],
        localFilterFacts: { mediaType: "series" as const, downloaded: true },
      },
    ];

    const filtered = applyBrowseResultFilters(
      options as any,
      parseBrowseFilterQuery("downloaded:true").filters,
    );
    expect(filtered.map((o) => o.value)).toEqual(["b"]);
  });

  test("buildLocalFilterFacts maps history + offline badges", () => {
    const facts = buildLocalFilterFacts({
      result: {
        id: "t1",
        type: "series",
        title: "X",
        year: "2024",
        overview: "",
        posterPath: null,
      },
      historyEntry: {
        // minimal HistoryProgress shape used by mapper tests in-repo
        titleId: "t1",
        positionSeconds: 120,
        durationSeconds: 1400,
        completed: false,
      } as any,
      enrichmentBadges: [{ label: "downloaded", tone: "success" }],
    });
    expect(facts).toMatchObject({
      downloaded: true,
      watched: "watching",
    });
  });
});
```

Update existing browse-filters tests that relied on planting `"downloaded"` inside `previewMeta` — they must set `localFilterFacts` instead.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/search/browse-local-filter-facts.test.ts \
  test/unit/app-shell/browse-filters.test.ts
```

Expected: FAIL — heuristics still match overview text; `buildLocalFilterFacts` missing.

- [ ] **Step 3: Implement structured facts + facet availability**

1. Export `buildLocalFilterFacts` from browse-option-mappers (or a sibling `browse-local-filter-facts.ts` if the mapper file is too large).
2. Wire into `toBrowseResultOption`.
3. Rewrite `applyBrowseResultFilters` library branches to read only `localFilterFacts`.
4. Delete string-heuristic helpers.
5. In `chooseSearchFilterChip`, gate library options:

```ts
// Only include when browse display context can populate facts
// (history repo + offline enrichment available). If offline feature is
// disabled for the build, omit downloaded:* chips entirely.
```

6. Adjust `SearchRoutingService` evidence so library keys are not claimed `local` at catalog search time unless the catalog truly filters them; keep them `unsupported` for TMDB/AniList search responses, and let browse post-filter apply with local facts without lying that upstream applied them. Browse badges should say local when post-filtered.

- [ ] **Step 4: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/search/browse-local-filter-facts.test.ts \
  test/unit/app-shell/browse-filters.test.ts \
  test/unit/services/search/search-routing.test.ts
```

Expected: PASS

```bash
git add apps/cli/src/app/search/browse-option-mappers.ts \
  apps/cli/src/app-shell/browse-filters.ts \
  apps/cli/src/app-shell/types.ts \
  apps/cli/src/services/search/SearchRoutingService.ts \
  apps/cli/src/app/search/SearchPhase.ts \
  apps/cli/test/unit/app/search/browse-local-filter-facts.test.ts \
  apps/cli/test/unit/app-shell/browse-filters.test.ts \
  apps/cli/test/unit/services/search/search-routing.test.ts
git commit -m "$(cat <<'EOF'
fix(search): make library filters real or unavailable

EOF
)"
```

---

### Task 6: Truth index + final verification

**Files:**

- Modify: `.plans/search-filter-state.md`
- Verify: Track B acceptance from spec §10.5

**Interfaces:** none — documentation / status only.

- [ ] **Step 1: Update `.plans/search-filter-state.md` status**

Replace the stale “implemented” header with Track B repair truth, for example:

```text
SLICE_ID: P6
SLICE_STATUS: repaired-by-track-b
SLICE_OWNER: —
SLICE_LAST_UPDATED: 2026-07-21
SLICE_CURRENT_TASK: complete
SLICE_BLOCKERS: none
```

Add a short note at the top:

```markdown
> **Truth (2026-07-21):** P6 domain/`FilterState` landed earlier, but browse wiring was incomplete.
> Track B (`docs/superpowers/plans/2026-07-21-search-filter-ux-repair.md`, spec §10) repairs
> vocabulary, `/filters` vs Ctrl+F, bootstrap intent parity, chip clear, and library-filter honesty.
```

Mark any checkbox claims that `/filters` was fully wired as superseded by Track B.

- [ ] **Step 2: Run the Track B unit gate**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/search/search-intent-parser.test.ts \
  test/unit/domain/search/search-intent-engine.test.ts \
  test/unit/domain/search/search-intent.test.ts \
  test/unit/app-shell/browse-filter-actions.test.ts \
  test/unit/app-shell/browse-filter-chips.test.ts \
  test/unit/app-shell/browse-filters.test.ts \
  test/unit/app/search/browse-local-filter-facts.test.ts \
  test/unit/services/search/search-routing.test.ts
bun run --cwd apps/cli typecheck
```

Expected: PASS

- [ ] **Step 3: Manual acceptance checklist (no live providers required)**

- [ ] Idle browse: `/filters` opens facet sheet; picking `mode:youtube` appends a parsing token.
- [ ] With results: `/filters` still opens facets (does **not** open Ctrl+F narrow bar).
- [ ] Ctrl+F opens substring narrow only; Esc clears narrow before chips.
- [ ] Query `type:anime year:2024` routes anime mode with correction warning; not silent ignore.
- [ ] Query `type:playlist mode:youtube` parses; results narrow to playlists when shapes exist.
- [ ] Clear one chip; siblings remain.
- [ ] `downloaded:true` either filters by offline facts or is absent from facets / marked unsupported — never overview substring theater.
- [ ] `kunai -S "mob mode:anime year:2024"` (or bootstrap equivalent) does not drop filters.

- [ ] **Step 4: Commit status update**

```bash
git add .plans/search-filter-state.md
git commit -m "$(cat <<'EOF'
docs(plans): mark search-filter-state repaired by Track B

EOF
)"
```

---

## Self-review (spec §10 coverage)

| Spec requirement                                                                   | Task                          |
| ---------------------------------------------------------------------------------- | ----------------------------- |
| B1 parser + vocabulary + copy (`mode:youtube`, `type:anime` alias, YouTube shapes) | Task 1                        |
| B2 `/filters` vs Ctrl+F split; idle + with-results facets                          | Task 2                        |
| B3 single apply pipeline + bootstrap/`-S` intent parity + evidence honesty         | Task 3                        |
| B4 clearable chips + Esc ladder narrow → chips → query                             | Task 4                        |
| B5 library filters real or unavailable                                             | Task 5                        |
| Update `.plans/search-filter-state.md`                                             | Task 6                        |
| Locked YouTube shapes on `type:` allowlist (not `shape:`)                          | Task 1 Interfaces + Tasks 3–5 |
| Global constraint Track A timing (after A6 preferred / after A3 OK)                | Global Constraints            |
