# Search and Playback Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve resolved search/provider identity through playback, bound optional timing/subtitle work, and stop futile provider fallback when reliable offline evidence exists.

**Architecture:** Search results carry immutable lane provenance. Playback keeps configured provider and successful provider separate, with the successful provider driving persisted and user-visible playback state. Timing and subtitle enrichments compose caller cancellation with bounded child deadlines.

**Tech Stack:** Bun, TypeScript, Ink, provider engine packages, native AbortSignal, SQLite history.

## Global Constraints

- Browser providers remain out of scope.
- Optional enrichment never blocks playback indefinitely.
- Configured and successful provider remain distinct.
- English remains the existing automatic subtitle fallback.
- AniList/provider-native IDs are never sent to a TMDB-keyed API.
- Live provider tests remain opt-in.
- Preserve unrelated working-tree paths.

---

### Task 1: Preserve the lane that produced search results

**Files:**

- Modify: `apps/cli/src/domain/types.ts`
- Modify: `apps/cli/src/services/search/SearchRoutingService.ts`
- Modify: `apps/cli/src/app/search/search-selection-routing.ts`
- Modify search-routing tests

**Interfaces:**

```ts
export interface SearchResult {
  // existing fields
  readonly resolvedLane?: ProviderLane;
}

export interface SearchRoutingResult {
  readonly results: SearchResult[];
  readonly resolvedLane: ProviderLane;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly strategy: "provider-native" | "registry";
  readonly evidence: SearchFilterEvidence;
}
```

- [ ] **Step 1: Add cross-mode service and selection tests**

```ts
test("anime results retain the routed anime lane without isAnime", async () => {
  const result = await searchTitles(ANIME_INTENT, SERIES_CONTEXT_WITH_ANILIST_RESULT);
  expect(result.resolvedLane).toBe("anime");
  expect(result.results[0]?.resolvedLane).toBe("anime");
});

test("selection follows resolvedLane over prior shell mode", () => {
  expect(resolveShellModeForSearchResult({ ...ROW, resolvedLane: "anime" }, "series")).toBe(
    "anime",
  );
});
```

Add the inverse series-from-anime case.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/search/search-routing.test.ts \
  test/unit/app/search/search-selection-routing.test.ts
```

- [ ] **Step 3: Stamp every result at the service boundary**

```ts
function withResolvedSearchLane(
  results: readonly SearchResult[],
  resolvedLane: ProviderLane,
): SearchResult[] {
  return results.map((result) => ({ ...result, resolvedLane }));
}
```

Selection prefers `resolvedLane`, then keeps existing YouTube/calendar/legacy fallbacks.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/search/search-routing.test.ts \
  test/unit/app/search/search-selection-routing.test.ts
git add apps/cli/src/domain/types.ts \
  apps/cli/src/services/search/SearchRoutingService.ts \
  apps/cli/src/app/search/search-selection-routing.ts \
  apps/cli/test/unit/services/search/search-routing.test.ts \
  apps/cli/test/unit/app/search/search-selection-routing.test.ts
git commit -m "fix(search): preserve resolved lane through selection"
```

### Task 2: Propagate successful provider identity

**Files:**

- Create: `apps/cli/src/app/playback/playback-provider-handoff.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Modify: `apps/cli/src/app/playback/episode-prefetch.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Add/modify provider handoff and prefetch tests

**Interfaces:**

```ts
export interface PlaybackProviderHandoff {
  readonly configuredProviderId: string;
  readonly successfulProviderId: string;
  readonly historyProviderId: string;
  readonly presenceProviderId: string;
  readonly shareProviderId: string;
  readonly nextEpisodeProviderId: string;
}
```

- [ ] **Step 1: Add pure handoff test**

```ts
test("successful fallback owns playback-cycle consumers", () => {
  expect(
    resolvePlaybackProviderHandoff({
      configuredProviderId: "vidking",
      successfulProviderId: "rivestream",
    }),
  ).toEqual({
    configuredProviderId: "vidking",
    successfulProviderId: "rivestream",
    historyProviderId: "rivestream",
    presenceProviderId: "rivestream",
    shareProviderId: "rivestream",
    nextEpisodeProviderId: "rivestream",
  });
});
```

- [ ] **Step 2: Add prefetch propagation tests**

`PlaybackResolveWorkService.prefetch()` returns `{ stream, providerId, cacheProvenance }`; `EpisodePrefetchBundle` stores `resolvedProviderId`.

- [ ] **Step 3: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback/playback-provider-handoff.test.ts \
  test/unit/services/playback/playback-resolve-work-service.test.ts \
  test/unit/app/episode-prefetch.test.ts
```

- [ ] **Step 4: Use successful identity throughout PlaybackPhase**

Pass `successfulProviderId` into `playStream`; use the handoff for history ledger, presence, share context, diagnostics, source display, timing context, cache invalidation, and next-episode routing. Do not persist automatic fallback as the configured provider.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback/playback-provider-handoff.test.ts \
  test/unit/services/playback/playback-resolve-work-service.test.ts \
  test/unit/app/episode-prefetch.test.ts \
  test/unit/app/playback-phase-share-bootstrap.test.ts \
  test/unit/services/presence/PresenceServiceImpl.test.ts \
  test/unit/app/share-ref-from-context.test.ts
git add apps/cli/src/app/playback/playback-provider-handoff.ts \
  apps/cli/src/services/playback/PlaybackResolveWorkService.ts \
  apps/cli/src/app/playback/episode-prefetch.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/app/playback/playback-provider-handoff.test.ts \
  apps/cli/test/unit/services/playback/playback-resolve-work-service.test.ts \
  apps/cli/test/unit/app/episode-prefetch.test.ts
git commit -m "fix(playback): propagate successful provider identity"
```

### Task 3: Classify reliable offline provider failures

**Files:**

- Modify: `packages/types/src/index.ts`
- Modify: `packages/core/src/provider-failure-classifier.ts`
- Modify: `packages/core/src/provider-engine.ts`
- Modify: `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts`
- Modify core and CLI classifier tests

**Interfaces:**

Add the new literal `"offline"` to the existing `ProviderFailureClass` and `DiagnosticFailureClass` unions without renaming or removing their current members.

```ts
export function isOfflineNetworkFailure(
  failure: Pick<ProviderFailure, "code" | "message">,
): boolean;
```

- [ ] **Step 1: Add reliable-signature tests**

```ts
test("ENOTFOUND stops cross-provider fallback", async () => {
  const attempted: string[] = [];
  const result = await engine.resolveWithFallback(INPUT, ["vidking", "rivestream"]);
  expect(result.result).toBeNull();
  expect(attempted).toEqual(["vidking"]);
});

test("HTTP 503 remains provider-local network failure", () => {
  expect(classifyProviderFailure(HTTP_503_FAILURE)).toMatchObject({
    failureClass: "network",
    fallbackPolicy: "auto-fallback",
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd packages/core test
bun run --cwd apps/cli test:file -- test/unit/domain/provider/provider-failure-classifier.test.ts
```

- [ ] **Step 3: Centralize bounded patterns**

Use only `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `network is unreachable`, `ERR_INTERNET_DISCONNECTED`, and `ERR_NAME_NOT_RESOLVED`. Do not classify timeout, reset, HTTP, parse, or empty-result failures as global offline.

- [ ] **Step 4: Stop fallback before fallback-started event**

`offline` maps to no-fallback, non-retryable, and diagnostic action `retry`.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd packages/core test
bun run --cwd apps/cli test:file -- \
  test/unit/domain/provider/provider-failure-classifier.test.ts \
  test/unit/services/network/network-status.test.ts \
  test/unit/services/playback/playback-resolve-service.test.ts
git add packages/types/src/index.ts \
  packages/core/src/provider-failure-classifier.ts \
  packages/core/src/provider-engine.ts \
  packages/core/test/provider-failure-classifier.test.ts \
  packages/core/test/provider-cycle-engine.test.ts \
  apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts \
  apps/cli/test/unit/domain/provider/provider-failure-classifier.test.ts
git commit -m "fix(provider): classify and bound offline failures"
```

### Task 4: Compose timing deadlines and outcomes

**Files:**

- Modify timing source/aggregator/IntroDB/AniSkip files
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Create: `apps/cli/test/unit/infra/timing/playback-timing-aggregator.test.ts`
- Modify timing source tests

**Interfaces:**

```ts
export type PlaybackTimingOutcomeClass =
  | "not-applicable"
  | "identity-missing"
  | "not-found"
  | "timeout"
  | "offline"
  | "http-error"
  | "cancelled";

export interface PlaybackTimingAggregatorOptions {
  readonly sourceDeadlineMs?: number; // default 4_000
  readonly aggregateDeadlineMs?: number; // default 5_000
  readonly now?: () => number;
}
```

- [ ] **Step 1: Add live-parent timeout tests**

```ts
test("source deadline fires while caller signal remains live", async () => {
  const parent = new AbortController();
  const timing = await aggregator.resolve(TITLE, EPISODE, "series", parent.signal, {
    onSourceOutcome: (outcome) => outcomes.push(outcome),
  });
  expect(timing).toBeNull();
  expect(parent.signal.aborted).toBe(false);
  expect(outcomes[0]?.failureClass).toBe("timeout");
});
```

Also test aggregate deadline and caller cancellation.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/timing/playback-timing-aggregator.test.ts \
  test/unit/infra/timing/timing-sources.test.ts
```

- [ ] **Step 3: Compose signals in the aggregator**

Use `withTimeoutSignal(parent, aggregate)` then one child signal per source. Run sources through `Promise.allSettled`; merge successes; classify timeouts/failures without rejecting playback.

- [ ] **Step 4: Add classified source outcomes**

Detailed source functions distinguish identity-missing, not-found, timeout, offline, HTTP, and cancelled. Compatibility wrappers may still return metadata/null.

- [ ] **Step 5: Record redacted diagnostics and provider-aware cache keys**

Include provider context in timing cache keys and pass the successful provider to foreground/background timing requests.

- [ ] **Step 6: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/timing/playback-timing-aggregator.test.ts \
  test/unit/infra/timing/timing-sources.test.ts \
  test/unit/infra/timing/provider-native-timing.test.ts \
  test/unit/app/playback-phase-events.test.ts
git commit -m "fix(timing): compose bounded source deadlines"
```

Stage only the timing, PlaybackPhase, and test files changed.

### Task 5: Attach only configured/fallback subtitle languages

**Files:**

- Modify: `apps/cli/src/subtitle.ts`
- Modify: `apps/cli/src/services/providers/provider-result-adapter.ts`
- Modify: `apps/cli/src/app/playback/subtitle-selection.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify subtitle tests

**Interfaces:**

```ts
export function selectAutomaticSubtitle(
  list: readonly SubtitleEntry[],
  preferredLang: string,
  options?: {
    readonly fallbackLang?: string | null;
    readonly sourcePreference?: SubtitleSourcePreference;
    readonly accessibilityPreference?: SubtitleAccessibilityPreference;
  },
): SubtitleEntry | null;
```

- [ ] **Step 1: Add mismatch tests**

```ts
test("automatic selection rejects unrelated languages", () => {
  expect(selectAutomaticSubtitle([ARABIC], "fr")).toBeNull();
});

test("English fallback remains allowed", () => {
  expect(selectAutomaticSubtitle([ARABIC, ENGLISH], "fr")?.language).toBe("en");
});
```

Ensure unrelated inventory still allows late lookup.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/subtitle.test.ts \
  test/unit/app/subtitle-selection.test.ts
```

- [ ] **Step 3: Filter only automatic candidates**

Keep all tracks in `subtitleList`; filter preferred/fallback languages before ranking automatic attachment.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/subtitle.test.ts \
  test/unit/app/subtitle-selection.test.ts \
  test/unit/services/providers/provider-result-adapter.test.ts
git add apps/cli/src/subtitle.ts \
  apps/cli/src/services/providers/provider-result-adapter.ts \
  apps/cli/src/app/playback/subtitle-selection.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/subtitle.test.ts \
  apps/cli/test/unit/app/subtitle-selection.test.ts \
  apps/cli/test/unit/services/providers/provider-result-adapter.test.ts
git commit -m "fix(subtitles): attach only configured languages"
```

### Task 6: Require proven TMDB identity for anime late lookup

**Files:**

- Create: `apps/cli/src/domain/catalog/tmdb-identity.ts`
- Modify subtitle/selection/PlaybackPhase files
- Create: `apps/cli/test/unit/domain/catalog/tmdb-identity.test.ts`
- Modify subtitle tests

**Interfaces:**

```ts
export function resolveProvenNumericTmdbId(
  title: Pick<TitleInfo, "id" | "externalIds">,
  mode: ShellMode,
): string | null;
```

- [ ] **Step 1: Add identity tests**

```ts
test("anime uses external TMDB id", () => {
  expect(
    resolveProvenNumericTmdbId(
      {
        id: "154587",
        externalIds: { anilistId: "154587", tmdbId: "209867" },
      },
      "anime",
    ),
  ).toBe("209867");
});

test("bare numeric anime id is not assumed TMDB", () => {
  expect(resolveProvenNumericTmdbId({ id: "154587" }, "anime")).toBeNull();
});
```

- [ ] **Step 2: Add cancellation test**

Abort the playback iteration during Wyzie fetch and assert one attempt, empty result, and `outcome: "cancelled"`.

- [ ] **Step 3: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/catalog/tmdb-identity.test.ts \
  test/unit/subtitle.test.ts \
  test/unit/app/subtitle-selection.test.ts
```

- [ ] **Step 4: Implement identity and cancellation**

Order: numeric external TMDB ID, `tmdb:<id>`, bare numeric only outside anime. Change lookup decision to `hasTmdbId`; pass iteration signal through retry attempts; skip with redacted `tmdb-id-missing` diagnostics.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/catalog/tmdb-identity.test.ts \
  test/unit/subtitle.test.ts \
  test/unit/app/subtitle-selection.test.ts \
  test/unit/infra/player/persistent-subtitle-manager.test.ts
git add apps/cli/src/domain/catalog/tmdb-identity.ts \
  apps/cli/src/subtitle.ts \
  apps/cli/src/app/playback/subtitle-selection.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/domain/catalog/tmdb-identity.test.ts \
  apps/cli/test/unit/subtitle.test.ts \
  apps/cli/test/unit/app/subtitle-selection.test.ts
git commit -m "fix(subtitles): require TMDB identity for anime lookup"
```

### Task 7: Verify the slice at release boundaries

- [ ] **Step 1: Run focused tests**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/search/search-routing.test.ts \
  test/unit/app/search/search-selection-routing.test.ts \
  test/unit/app/playback/playback-provider-handoff.test.ts \
  test/unit/services/playback/playback-resolve-work-service.test.ts \
  test/unit/app/episode-prefetch.test.ts \
  test/unit/infra/timing/playback-timing-aggregator.test.ts \
  test/unit/infra/timing/timing-sources.test.ts \
  test/unit/subtitle.test.ts \
  test/unit/app/subtitle-selection.test.ts \
  test/unit/domain/catalog/tmdb-identity.test.ts
bun run --cwd packages/core test
```

- [ ] **Step 2: Run repository gates**

```bash
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

- [ ] **Step 3: Run opt-in live matrix after deterministic green**

```bash
bun run test:live:matrix
```

Expected: isolated-profile movie/series/anime results with classified failure evidence; live checks remain outside default CI.
