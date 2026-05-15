# Search, Offline, And Continuation Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared advanced search intent model, a local-only offline library read model, and a continuation decision engine without introducing N+1 provider calls or UX overlap.

**Architecture:** UI surfaces ask small pure decision engines for normalized intent, local offline groups, and continuation options. Engines return read models and action options only; services execute network, provider resolution, downloads, and playback after explicit user choice.

**Tech Stack:** Bun, TypeScript, Ink shell, existing `SearchPhase`, `OfflineLibraryService`, `ResultEnrichmentService`, SQLite stores, `bun test`, `oxlint`, `oxfmt`.

---

## Status

Core implementation completed on `main`.

Implemented:

- Shared `SearchIntent` model with parser and normalization engine.
- Browse input supports advanced `key:value` filters as local chips without stream resolution.
- Bootstrap `-S` search strips supported filter tokens before provider/catalog search.
- `/filters` command is registered so advanced search help is discoverable.
- `OfflineLibraryEngine` groups completed downloads into title-first local shelves.
- `ContinuationEngine` separates local continuation, explicit online continuation, download-more, and browse-offline decisions.
- `/offline` uses the read-model engine and shows continuation guidance from local history/artifact facts.

Follow-up hardening still worth doing:

- Build a guided `/filters` picker that inserts chips into the search box instead of only registering the command.
- Apply cached local filter semantics for `downloaded`, `watched`, and `release` across already-loaded browse results when the data is present.
- Add a richer offline title detail surface with batch actions, pin/protect, and explicit online/download continuation actions.

## Decisions Locked By Grill Session

- Advanced search should be hybrid: plain text still works, `key:value` syntax is supported, and `/filters` provides a guided picker.
- Phase 1 filters must be local/cached only.
- Search must not resolve streams per result.
- Audio, quality, subtitle, and provider inventory filters are deferred until a batch-safe inventory model exists.
- Search results can display local/cached facts immediately but must not imply playable stream/audio/subtitle availability unless provider inventory is already cached or explicitly resolved.
- `/offline` must be strictly local-first and must not do network work on initial load.
- Offline can recommend online continuation only after local downloaded episodes are complete or exhausted, but the user must choose the online action explicitly.
- Offline library should be a local read model grouped by title, not a raw download job screen.
- Use small engines, not one mega-engine:
  - `SearchIntentEngine`
  - `OfflineLibraryEngine`
  - `ContinuationEngine`
  - existing `ResultEnrichmentService`
  - existing `PlaybackResolveService`

## Non-Goals

- Do not implement provider inventory filters such as quality/audio/subtitle in Phase 1.
- Do not make `/random` or `/surprise` autoplay.
- Do not fetch posters or metadata over the network while opening `/offline`.
- Do not make `/offline` silently switch online.
- Do not duplicate command aliases outside `command-registry`.
- Do not move all orchestration into one broad engine.

## Global Contracts

- `/search` and bootstrap `-S` never resolve streams during result listing.
- `/discover`, `/random`, and `/surprise` never autoplay by themselves.
- `/calendar` shows release facts, not playable guarantees.
- `/offline` initial load never calls provider search, provider resolve, catalog release sync, poster fetch, or subtitle fetch.
- Result enrichment failure never blocks base search results.
- Local facts are strong badges: downloaded, watching, completed, local artifact status.
- Catalog facts are honest badges: release today, upcoming, cached recommendation.
- Provider facts are only shown when cached provider inventory exists or the user explicitly resolves details/playback.

## Phase 1 Filter Vocabulary

Supported first:

```text
mode:anime | mode:series | mode:movie | mode:all
provider:vidking | provider:allanime | provider:miruro | provider:rivestream
downloaded:true | downloaded:false
watched:any | watched:unwatched | watched:watching | watched:completed
year:2021
year:2010..2020
release:today | release:this-week | release:upcoming
sort:relevance | sort:progress | sort:recent
```

Deferred:

```text
genre:action
status:airing | completed
audio:sub | dub
subtitle:en
quality:1080p
```

## File Ownership Map

- Create `apps/cli/src/domain/search/SearchIntent.ts`: shared intent and filter types.
- Create `apps/cli/src/domain/search/SearchIntentParser.ts`: parse text query plus `key:value` filters.
- Create `apps/cli/src/domain/search/SearchIntentEngine.ts`: normalize raw text, chips, config, current mode into `SearchIntent`.
- Create `apps/cli/src/domain/offline/OfflineLibraryEngine.ts`: local read model grouping download jobs, history, artifact states, and cached metadata.
- Create `apps/cli/src/domain/continuation/ContinuationEngine.ts`: returns local/online/download continuation options from local state and cached facts.
- Modify `apps/cli/src/services/offline/offline-library.ts`: keep low-level formatting helpers, move policy decisions into `OfflineLibraryEngine`.
- Modify `apps/cli/src/app-shell/workflows.ts`: use `OfflineLibraryEngine` for `/offline` and `ContinuationEngine` for continuation actions.
- Modify `apps/cli/src/app/SearchPhase.ts`: use `SearchIntentEngine` for bootstrap and shell search.
- Modify command registry to add `/filters` if not already present.
- Modify browse/search UI to show filter chips and guided filter picker.
- Test files live under `apps/cli/test/unit/domain/search/`, `apps/cli/test/unit/domain/offline/`, `apps/cli/test/unit/domain/continuation/`, and existing app-shell/search tests.

## Task 1: Search Intent Types

**Files:**

- Create: `apps/cli/src/domain/search/SearchIntent.ts`
- Test: `apps/cli/test/unit/domain/search/search-intent.test.ts`

- [ ] **Step 1: Write failing type behavior tests**

```ts
import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";

describe("SearchIntent", () => {
  test("normalizes empty optional filters without changing query", () => {
    expect(
      normalizeSearchIntent({
        query: "Dune",
        mode: "series",
        filters: {},
      }),
    ).toEqual({
      query: "Dune",
      mode: "series",
      filters: {},
      sort: "relevance",
    });
  });

  test("clamps unsupported year ranges into ordered ranges", () => {
    expect(
      normalizeSearchIntent({
        query: "crime",
        mode: "all",
        filters: { year: { from: 2022, to: 1999 } },
      }).filters.year,
    ).toEqual({ from: 1999, to: 2022 });
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent.test.ts
```

Expected: fail because search intent module does not exist.

- [ ] **Step 3: Implement intent types**

```ts
export type SearchIntentMode = "series" | "anime" | "movie" | "all";
export type WatchFilter = "any" | "unwatched" | "watching" | "completed";
export type ReleaseFilter = "today" | "this-week" | "upcoming";
export type SearchSort = "relevance" | "progress" | "recent";

export type SearchIntentFilters = {
  readonly provider?: string;
  readonly downloaded?: boolean;
  readonly watched?: WatchFilter;
  readonly year?: number | { readonly from?: number; readonly to?: number };
  readonly release?: ReleaseFilter;
};

export type SearchIntent = {
  readonly query: string;
  readonly mode: SearchIntentMode;
  readonly filters: SearchIntentFilters;
  readonly sort: SearchSort;
};

export function normalizeSearchIntent(input: {
  readonly query: string;
  readonly mode: SearchIntentMode;
  readonly filters?: SearchIntentFilters;
  readonly sort?: SearchSort;
}): SearchIntent {
  return {
    query: input.query.trim(),
    mode: input.mode,
    filters: normalizeFilters(input.filters ?? {}),
    sort: input.sort ?? "relevance",
  };
}

function normalizeFilters(filters: SearchIntentFilters): SearchIntentFilters {
  const year = filters.year;
  const normalizedYear =
    typeof year === "object" && year
      ? {
          from:
            typeof year.from === "number" && typeof year.to === "number"
              ? Math.min(year.from, year.to)
              : year.from,
          to:
            typeof year.from === "number" && typeof year.to === "number"
              ? Math.max(year.from, year.to)
              : year.to,
        }
      : year;
  return {
    ...filters,
    year: normalizedYear,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/search/SearchIntent.ts apps/cli/test/unit/domain/search/search-intent.test.ts
git commit -m "Add search intent model"
```

## Task 2: Search Intent Parser

**Files:**

- Create: `apps/cli/src/domain/search/SearchIntentParser.ts`
- Test: `apps/cli/test/unit/domain/search/search-intent-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, test } from "bun:test";

import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";

describe("SearchIntentParser", () => {
  test("parses query text and key-value filters", () => {
    expect(parseSearchIntentText("Dune year:2021 downloaded:true provider:vidking")).toEqual({
      query: "Dune",
      filters: {
        year: 2021,
        downloaded: true,
        provider: "vidking",
      },
      sort: undefined,
      mode: undefined,
      errors: [],
    });
  });

  test("parses ranges and leaves unknown filters as non-blocking errors", () => {
    expect(parseSearchIntentText("anime year:2010..2020 genre:action")).toEqual({
      query: "anime",
      filters: {
        year: { from: 2010, to: 2020 },
      },
      sort: undefined,
      mode: undefined,
      errors: [{ key: "genre", value: "action", reason: "unsupported-filter" }],
    });
  });
});
```

- [ ] **Step 2: Run failing parser tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent-parser.test.ts
```

Expected: fail because parser does not exist.

- [ ] **Step 3: Implement parser**

Parser requirements:

- Split on whitespace.
- Recognize `key:value` tokens.
- Treat unknown filters as non-blocking parse errors.
- Preserve plain words in `query`.
- Support quoted query text only if existing line editor already preserves quotes; otherwise treat quotes as normal chars in this first pass.
- Return unsupported provider names as parse errors only after engine validation, not parser.

- [ ] **Step 4: Run parser tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent-parser.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/search/SearchIntentParser.ts apps/cli/test/unit/domain/search/search-intent-parser.test.ts
git commit -m "Parse advanced search filters"
```

## Task 3: Search Intent Engine

**Files:**

- Create: `apps/cli/src/domain/search/SearchIntentEngine.ts`
- Test: `apps/cli/test/unit/domain/search/search-intent-engine.test.ts`

- [ ] **Step 1: Write failing engine tests**

Test:

- Current shell mode fills missing `mode`.
- Config default provider validates provider filter.
- Unsupported provider becomes non-blocking warning.
- Filter chips and text filters merge, with explicit chips winning.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent-engine.test.ts
```

- [ ] **Step 3: Implement engine**

Export:

```ts
export type SearchIntentWarning = {
  readonly key: string;
  readonly value: string;
  readonly reason: "unsupported-filter" | "unknown-provider" | "invalid-value";
};

export function buildSearchIntent(input: {
  readonly text: string;
  readonly currentMode: "series" | "anime";
  readonly providers: readonly string[];
  readonly chips?: Partial<SearchIntentFilters>;
}): { readonly intent: SearchIntent; readonly warnings: readonly SearchIntentWarning[] };
```

No network, no provider resolution, no store reads.

- [ ] **Step 4: Run engine tests**

```bash
bun test apps/cli/test/unit/domain/search/search-intent-engine.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/search/SearchIntentEngine.ts apps/cli/test/unit/domain/search/search-intent-engine.test.ts
git commit -m "Normalize search input into intent"
```

## Task 4: Search Phase Integration Without Network Expansion

**Files:**

- Modify: `apps/cli/src/app/SearchPhase.ts`
- Test: `apps/cli/test/unit/app/search-phase-commands.test.ts`
- Test: create `apps/cli/test/unit/app/search-intent-integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

Test:

- `-S "Dune downloaded:true"` builds an intent but does not call provider resolve.
- Unsupported filter warning does not block base search.
- `downloaded:true` filter is applied only after local enrichment, not before provider search.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/app/search-intent-integration.test.ts
```

- [ ] **Step 3: Wire engine into SearchPhase**

At search submission:

```text
raw input -> SearchIntentEngine -> base search query -> provider/catalog search -> local/cached enrichment/filtering
```

Keep base provider search using `intent.query` and current mode/provider. Apply local/cached filters after results return.

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/app/search-intent-integration.test.ts apps/cli/test/unit/app/search-phase-commands.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app/SearchPhase.ts apps/cli/test/unit/app/search-intent-integration.test.ts apps/cli/test/unit/app/search-phase-commands.test.ts
git commit -m "Use search intents in search phase"
```

## Task 5: Guided Filters Command

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/command-router.ts`
- Create or modify filter picker UI in `apps/cli/src/app-shell/`
- Test: command registry tests and filter picker tests.

- [ ] **Step 1: Write failing command tests**

Test:

- `/filters` parses as `filters`.
- Browse/search command context exposes `filters`.
- `/filters` is unavailable in non-search contexts only if no search input can be edited.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/session/command-registry-discovery.test.ts apps/cli/test/unit/domain/session/command-registry-contexts.test.ts
```

- [ ] **Step 3: Add command and shell action**

Add command:

```text
id: filters
aliases: filters, filter, refine
label: Search Filters
```

- [ ] **Step 4: Add filter picker**

First pass picker supports:

- Mode.
- Provider.
- Downloaded.
- Watched.
- Year.
- Release.
- Sort.

Picker edits chips in shell state, not provider config.

- [ ] **Step 5: Run tests**

```bash
bun test apps/cli/test/unit/domain/session apps/cli/test/unit/app-shell
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/domain/session/command-registry.ts apps/cli/src/app-shell apps/cli/test/unit/domain/session apps/cli/test/unit/app-shell
git commit -m "Add guided search filter command"
```

## Task 6: Result Enrichment Contract Tests

**Files:**

- Modify: `apps/cli/src/services/catalog/ResultEnrichmentService.ts`
- Test: `apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts`

- [ ] **Step 1: Add contract tests**

Test:

- Local history is batch-read.
- Offline state is batch-read.
- Enrichment failure returns base results.
- No provider resolve method is available to enrichment.
- Cached provider inventory badges appear only when inventory cache exists.

- [ ] **Step 2: Run tests**

```bash
bun test apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts
```

- [ ] **Step 3: Add badge confidence model**

Add:

```ts
export type BadgeConfidence = "local" | "catalog" | "cached-provider" | "live-provider";
```

Ensure search result UI can distinguish strong local facts from cached/provider facts.

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts apps/cli/test/unit/app/browse-option-mappers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/catalog/ResultEnrichmentService.ts apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts apps/cli/test/unit/app/browse-option-mappers.test.ts
git commit -m "Add result badge confidence contracts"
```

## Task 7: Offline Library Engine Read Model

**Files:**

- Create: `apps/cli/src/domain/offline/OfflineLibraryEngine.ts`
- Modify: `apps/cli/src/services/offline/offline-library.ts`
- Test: `apps/cli/test/unit/domain/offline/offline-library-engine.test.ts`

- [ ] **Step 1: Write failing offline engine tests**

Test:

- Groups by title.
- Sorts titles by latest watched/downloaded time.
- Counts ready/missing/invalid artifacts.
- Includes watched/progress summary.
- Includes next local episode.
- Includes online continuation recommendation only as an action option, not execution.
- Accepts only local inputs and has no network/provider dependencies.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/offline/offline-library-engine.test.ts
```

- [ ] **Step 3: Implement read model**

Export:

```ts
export type OfflineTitleGroup = {
  readonly titleId: string;
  readonly titleName: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly readyCount: number;
  readonly missingCount: number;
  readonly invalidCount: number;
  readonly watchedCount: number;
  readonly totalCount: number;
  readonly totalSizeBytes: number | null;
  readonly latestActivityAt: string | null;
  readonly nextLocalEpisode?: { readonly season: number; readonly episode: number };
  readonly actions: readonly OfflineLibraryAction[];
  readonly entries: readonly OfflineEpisodeEntry[];
};

export type OfflineLibraryAction =
  | "continue-local"
  | "episodes"
  | "watch-next-online"
  | "download-next"
  | "manage-files";
```

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/domain/offline/offline-library-engine.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/offline/OfflineLibraryEngine.ts apps/cli/test/unit/domain/offline/offline-library-engine.test.ts
git commit -m "Add offline library read model"
```

## Task 8: Offline Shell Uses Engine

**Files:**

- Modify: `apps/cli/src/app-shell/workflows.ts`
- Test: existing offline workflow tests or add `apps/cli/test/unit/app-shell/offline-library-workflow.test.ts`

- [ ] **Step 1: Write failing shell tests**

Test:

- First picker shows title groups, not individual files.
- Selecting a group shows episodes/files.
- `Continue local` selects next local episode.
- `Watch next online` returns to online flow only after explicit action.
- Initial `/offline` load never touches network/provider mocks.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/app-shell/offline-library-workflow.test.ts
```

- [ ] **Step 3: Wire engine into `/offline`**

Replace ad-hoc grouping in `workflows.ts` with `OfflineLibraryEngine`. Keep low-level play/reveal/retry/delete actions in workflow.

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/app-shell/offline-library-workflow.test.ts apps/cli/test/unit/services/offline/offline-library.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/workflows.ts apps/cli/test/unit/app-shell/offline-library-workflow.test.ts
git commit -m "Use offline library engine in shell"
```

## Task 9: Continuation Engine

**Files:**

- Create: `apps/cli/src/domain/continuation/ContinuationEngine.ts`
- Test: `apps/cli/test/unit/domain/continuation/continuation-engine.test.ts`

- [ ] **Step 1: Write failing continuation tests**

Test:

- Partial local episode returns `continue-local`.
- All downloaded episodes completed returns `watch-next-online` and `download-next` options.
- Missing next metadata returns `browse-online` but not autoplay.
- Movie returns replay/play-local options only.
- No action executes network.

- [ ] **Step 2: Run failing tests**

```bash
bun test apps/cli/test/unit/domain/continuation/continuation-engine.test.ts
```

- [ ] **Step 3: Implement engine**

Export:

```ts
export type ContinuationOption =
  | { readonly type: "continue-local"; readonly jobId: string; readonly label: string }
  | { readonly type: "replay-local"; readonly jobId: string; readonly label: string }
  | {
      readonly type: "watch-next-online";
      readonly titleId: string;
      readonly season?: number;
      readonly episode?: number;
      readonly label: string;
    }
  | {
      readonly type: "download-next";
      readonly titleId: string;
      readonly season?: number;
      readonly episode?: number;
      readonly label: string;
    }
  | { readonly type: "browse-online"; readonly titleId: string; readonly label: string };

export function buildContinuationOptions(input: {
  readonly group: OfflineTitleGroup;
  readonly history: readonly unknown[];
  readonly cachedEpisodeFacts?: readonly {
    readonly season: number;
    readonly episode: number;
    readonly released: boolean;
  }[];
}): readonly ContinuationOption[];
```

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/domain/continuation/continuation-engine.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/continuation/ContinuationEngine.ts apps/cli/test/unit/domain/continuation/continuation-engine.test.ts
git commit -m "Add continuation decision engine"
```

## Task 10: Online/Download Continuation Actions

**Files:**

- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app/SearchPhase.ts` when online continuation needs to re-enter the existing title search/playback selection flow.
- Modify: `apps/cli/src/app/SessionController.ts` if `SearchPhase` cannot receive continuation input through the current phase boundary.
- Test: `apps/cli/test/unit/app-shell/offline-library-workflow.test.ts`

- [ ] **Step 1: Add failing action tests**

Test:

- `watch-next-online` leaves offline library and starts existing online title flow with selected episode context.
- `download-next` calls download enqueue path after explicit confirmation.
- Failed online continuation returns to offline context with clear feedback.

- [ ] **Step 2: Run tests**

```bash
bun test apps/cli/test/unit/app-shell/offline-library-workflow.test.ts
```

- [ ] **Step 3: Implement explicit actions**

Do not auto-run online/download actions from group render. Only execute after user selects action.

- [ ] **Step 4: Run tests**

```bash
bun test apps/cli/test/unit/app-shell/offline-library-workflow.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/workflows.ts apps/cli/test/unit/app-shell/offline-library-workflow.test.ts
git commit -m "Add explicit offline continuation actions"
```

## Task 11: Regression Contract Test Suite

**Files:**

- Create: `apps/cli/test/unit/contracts/no-hidden-network-contracts.test.ts`

- [ ] **Step 1: Add contract tests**

Test all global invariants:

```text
/offline initial load does not call network/provider ports
search result listing does not call playback resolve
/random never starts playback
/surprise never starts playback
/calendar does not call playback resolve
unsupported search filters do not block base search
result enrichment failure does not block search
command aliases resolve only through command registry
```

- [ ] **Step 2: Run failing/passing tests**

```bash
bun test apps/cli/test/unit/contracts/no-hidden-network-contracts.test.ts
```

Expected during first write: fail for any missing test seams. Add seams instead of weakening the tests.

- [ ] **Step 3: Add missing seams**

If a UI workflow is hard to test without rendering, extract a pure helper instead of testing Ink internals.

- [ ] **Step 4: Run contract suite**

```bash
bun test apps/cli/test/unit/contracts/no-hidden-network-contracts.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/unit/contracts/no-hidden-network-contracts.test.ts apps/cli/src
git commit -m "Add hidden network regression contracts"
```

## Task 12: Documentation And Manual Smoke

**Files:**

- Modify: `.docs/ux-architecture.md`
- Modify: `.docs/download-offline-onboarding.md`
- Modify: `.docs/recommendations-and-discover.md`
- Modify: `README.md`
- Modify: `.plans/roadmap.md`

- [ ] **Step 1: Document search intent UX**

Add examples:

```text
Dune year:2021 downloaded:true
anime release:today sort:recent
Breaking Bad watched:watching
```

Document `/filters` as the guided version of the same intent.

- [ ] **Step 2: Document offline local-first contract**

State:

```text
/offline reads local data only.
Online continuation requires explicit action.
Download continuation requires explicit action.
```

- [ ] **Step 3: Update roadmap**

Add this plan to planned/active tracks.

- [ ] **Step 4: Run verification**

```bash
bun run typecheck
bun run test
bun run release:dry-run
```

- [ ] **Step 5: Commit**

```bash
git add .docs/ux-architecture.md .docs/download-offline-onboarding.md .docs/recommendations-and-discover.md README.md .plans/roadmap.md
git commit -m "Document search and offline engine architecture"
```

## Final Verification

Run:

```bash
bun run typecheck
bun run test
bun run release:dry-run
```

Manual smoke:

```bash
bun run dev -- -S "Dune year:2021"
bun run dev -- -S "Dune downloaded:true"
bun run dev -- --offline
bun run dev -- --discover
bun run dev -- --calendar
bun run dev -- --random
```

Manual UX checks:

- Search without filters behaves like current search.
- Invalid filters show a warning but do not block search.
- `/filters` can add and remove chips.
- `/offline` opens title groups with no network.
- Title group opens local episodes/actions.
- All-local-watched title offers online/download continuation but does not execute automatically.
- `/random` and `/surprise` still stage browse trays and never autoplay.
- `/calendar` still explains provider availability is checked only after selection.

## Self-Review Checklist

- Search has one canonical `SearchIntent` model.
- `/filters` edits the same model as typed syntax.
- Phase 1 filters are local/cached only.
- Offline library has one canonical local read model.
- Continuation engine returns options and executes nothing.
- No hidden provider/network calls exist in search, calendar, random, surprise, or offline initial load.
- Tests protect command alias parity and no-autoplay rules.
