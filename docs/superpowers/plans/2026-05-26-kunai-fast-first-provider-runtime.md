# Kunai Fast-First Provider Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore prompt AllManga startup, make provider startup patience an explicit cross-provider policy, preserve rich sources without blocking first play, and make the selected path observable.

**Architecture:** Provider packages continue to own extraction and provider-local cycling, while the CLI playback layer carries user startup policy, deduplication identity, persistence, prefetch identity and diagnostic projection. AllManga gets a foreground baseline lane and a separate `Ak` lane; common policy records why a ready candidate was selected without inventing alternate quality evidence.

**Tech Stack:** Bun, TypeScript, `@kunai/types`, `@kunai/core`, direct provider modules, Ink app shell, deterministic Bun tests, `mpv` only in final manual validation.

**Approved design:** `docs/superpowers/specs/2026-05-26-kunai-fast-first-provider-selection-design.md`

---

## Scope Boundary

This plan delivers the runtime repair and provider policy. It does not promote new Cineby routes or require live provider requests during implementation. Cineby intake is isolated in `docs/superpowers/plans/2026-05-26-cineby-source-intake.md`.

Already implemented and retained:

- Miruro data-driven provider keys and stream ordering.
- AllManga `Ak` parsing plus deferred MPD materialization.
- Primary-at-launch plus late subtitle attachment.
- VidKing definitive failure trimming.
- Rivestream service discovery caching.
- Diagnostics ingestion, redaction and support-bundle repair.

## File Map

### Provider Contract And Selection

- `packages/types/src/index.ts`: add `StartupPriority` and selection-decision facts carried by `ProviderResolveInput` and `ProviderResolveResult`.
- `packages/providers/src/shared/startup-selection.ts`: new pure selection helper for ready candidates and decision evidence.
- `packages/providers/test/startup-selection.test.ts`: policy tests for ready candidates and explicit selection.

### AllManga Regression Repair

- `packages/providers/src/allmanga/api-client.ts`: split source fetching into baseline and `Ak` lanes with lane-specific cache identity.
- `packages/providers/src/allmanga/direct.ts`: request the correct lane, require `Ak` only after baseline failure, bound optional quality-first expansion, and attach selection evidence.
- `packages/providers/src/allmanga/manifest.ts`: remove unsupported ordinary-series capability.
- `packages/providers/test/allmanga.test.ts`: request-count, delayed-`Ak`, fallback and explicit/quality-first tests.
- `packages/core/test/core.test.ts`: assert truthful anime-only AllManga manifest behavior.

### Playback, Persistence And Diagnostics

- `apps/cli/src/services/persistence/ConfigService.ts`: persist `startupPriority`.
- `apps/cli/src/services/persistence/ConfigStore.ts`: default `startupPriority` to `balanced`.
- `apps/cli/src/services/persistence/ConfigServiceImpl.ts`: normalize invalid stored priorities.
- `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`: default/update/migration tests.
- `apps/cli/src/services/providers/Provider.ts`: pass policy through legacy module adapter requests.
- `apps/cli/src/services/providers/stream-request-adapter.ts`: map shell request into `ProviderResolveInput`.
- `apps/cli/test/unit/services/providers/stream-request-adapter.test.ts`: mapping test.
- `apps/cli/src/services/playback/PlaybackResolveService.ts`: include policy in resolve input, cache keys, fallback context and events.
- `apps/cli/src/services/playback/ResolveWorkLedger.ts`: make policy part of work identity and retain safe selection facts.
- `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`: carry the work identity field.
- `apps/cli/src/services/playback/SourceInventoryService.ts`: prevent selected-inventory reuse across incompatible startup policies.
- `apps/cli/src/services/cache/stream-resolve-cache.ts`: prevent fast, balanced and quality-first cache collisions.
- `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`: fallback eligibility and event coverage.
- `apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts`: key and selection evidence tests.
- `apps/cli/test/unit/services/playback/source-inventory-service.test.ts`: startup-policy inventory isolation test.
- `apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts`: policy-key isolation test.
- `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`: record selection diagnostics.
- `apps/cli/src/services/diagnostics/operation-taxonomy.ts`: catalog provider selection operation.
- `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`: diagnostic emission test.
- `apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts`: operation registration test.

### UX And Prefetch

- `apps/cli/src/app/PlaybackPhase.ts`: pass configured startup priority into foreground, recovery and next-episode prefetch intents.
- `apps/cli/src/app/episode-prefetch.ts`: make exact-intent matching include startup priority.
- `apps/cli/test/unit/app/episode-prefetch.test.ts`: identity mismatch test.
- `apps/cli/src/app-shell/overlay-panel.tsx`: expose Fast, Balanced and Quality first settings.
- `apps/cli/src/app-shell/root-overlay-shell.tsx`: persist selected policy.
- `apps/cli/test/unit/app-shell/overlay-panel.test.ts`: settings display and choice tests.

### Documentation

- `.docs/provider-dossiers/allmanga.md`: document baseline versus `Ak` lanes and anime-only eligibility.
- `.docs/providers.md`: document startup priority and the AllManga identity guard.
- `.plans/plan-implementation-truth.md`: reconcile the landed runtime work after validation.

---

### Task 1: Repair The AllManga Foreground Lane And Series Eligibility

**Files:**

- Modify: `packages/providers/src/allmanga/api-client.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Modify: `packages/providers/src/allmanga/manifest.ts`
- Test: `packages/providers/test/allmanga.test.ts`
- Test: `packages/core/test/core.test.ts`

- [ ] **Step 1: Write failing AllManga regression tests**

Extend the existing `mockAllMangaFetch()` options type with:

```ts
readonly akDelayMs?: number;
```

Inside its already existing `if (url.includes("/ak-source"))` branch, insert before `return jsonResponse(fixtures.ak);`:

```ts
if (options.akDelayMs) await Bun.sleep(options.akDelayMs);
```

Add these assertions:

```ts
test("normal playback does not request Ak when a baseline stream is playable", async () => {
  using fetchMock = await mockAllMangaFetch({
    subSourceFixture: "sub-source-response",
    akDelayMs: 100,
  });
  const result = await resolveEvidenceEpisode({ intent: "play" });
  expect(result.status).toBe("resolved");
  expect(result.streams[0]?.protocol).toBe("hls");
  expect(fetchMock.calls.some((url) => url.includes("/ak-source"))).toBe(false);
});

test("normal playback requests Ak as required fallback when baseline is empty", async () => {
  using fetchMock = await mockAllMangaFetch({ subSourceFixture: "ak-episode-response" });
  const result = await resolveEvidenceEpisode({ intent: "play" });
  expect(result.streams[0]?.deferredLocator).toStartWith("allmanga-ak:");
  expect(fetchMock.calls.filter((url) => url.includes("/ak-source"))).toHaveLength(1);
});
```

Refactor the repeated resolve input in existing tests into `resolveEvidenceEpisode()` so each test specifies only policy/source overrides.

- [ ] **Step 2: Run focused tests and observe the regression**

Run:

```sh
bun run test -- packages/providers/test/allmanga.test.ts packages/core/test/core.test.ts
```

Expected: the normal-playback no-`Ak` test fails because `resolveEpisodeSources()` currently includes `Ak` in the shared blocking jobs; the manifest assertion fails while `series` remains advertised.

- [ ] **Step 3: Split AllManga source expansion lanes**

In `packages/providers/src/allmanga/api-client.ts`, add:

```ts
export type AllMangaSourceLane = "baseline" | "ak-only";

function acceptsSourceForLane(sourceName: string, lane: AllMangaSourceLane): boolean {
  if (lane === "ak-only") return sourceName === "Ak";
  return sourceName !== "Ak";
}
```

Add `readonly sourceLane?: AllMangaSourceLane` to `resolveEpisodeSources()` options, default it to `"baseline"`, include it in `cacheKey`, and skip extracted sources that fail `acceptsSourceForLane()`. Keep `fetchAkLinks()` unchanged so existing DASH/deferred-locator coverage remains intact.

- [ ] **Step 4: Resolve baseline first and `Ak` only when justified**

In `packages/providers/src/allmanga/direct.ts`, introduce:

```ts
function isExplicitAkSelection(input: ProviderResolveInput): boolean {
  return input.preferredSourceId?.endsWith(":ak") === true;
}
```

The inventory chooser carries the selected source along with a selected stream; do not guess that an opaque hashed stream id belongs to `Ak`.

For this repair slice, resolve with:

```ts
const explicitAk = isExplicitAkSelection(input);
let links = await resolveEpisodeSources({
  apiUrl: ALLANIME_API_URL,
  referer: ALLANIME_REFERER,
  ua: DEFAULT_UA,
  showId,
  epStr,
  mode,
  sourceLane: explicitAk ? "ak-only" : "baseline",
  signal: context.signal,
});

if (links.length === 0 && !explicitAk) {
  links = await resolveEpisodeSources({
    apiUrl: ALLANIME_API_URL,
    referer: ALLANIME_REFERER,
    ua: DEFAULT_UA,
    showId,
    epStr,
    mode,
    sourceLane: "ak-only",
    signal: context.signal,
  });
}
```

This restores prompt baseline playback before adding the generalized policy in Task 3.

- [ ] **Step 5: Remove the unsupported series capability**

Change the manifest:

```ts
mediaKinds: ["anime"],
```

Replace the contradictory core test with:

```ts
test("anime provider manifests expose only implemented media kinds", () => {
  expect(allanimeManifest.mediaKinds).toEqual(["anime"]);
  expect(miruroManifest.mediaKinds).toContain("anime");
  expect(allanimeManifest.mediaKinds).not.toContain("series");
});
```

- [ ] **Step 6: Run focused tests and commit the repair**

Run:

```sh
bun run test -- packages/providers/test/allmanga.test.ts packages/core/test/core.test.ts
```

Expected: PASS; normal playable fixtures perform no `/ak-source` request and `Ak`-only fixtures still resolve.

Commit:

```sh
git add packages/providers/src/allmanga/api-client.ts packages/providers/src/allmanga/direct.ts packages/providers/src/allmanga/manifest.ts packages/providers/test/allmanga.test.ts packages/core/test/core.test.ts
git commit -m "fix(providers): restore fast AllManga foreground resolution"
```

---

### Task 2: Add Startup Priority To The Shared Request And Work Identity

**Files:**

- Modify: `packages/types/src/index.ts`
- Modify: `apps/cli/src/services/providers/Provider.ts`
- Modify: `apps/cli/src/services/providers/stream-request-adapter.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/ResolveWorkLedger.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Modify: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Modify: `apps/cli/src/services/cache/stream-resolve-cache.ts`
- Modify: `packages/core/src/cache-policy.ts`
- Modify: `packages/providers/src/allmanga/manifest.ts`
- Modify: `packages/providers/src/vidking/manifest.ts`
- Modify: `packages/providers/src/rivestream/manifest.ts`
- Modify: `packages/providers/src/miruro/manifest.ts`
- Test: `apps/cli/test/unit/services/providers/stream-request-adapter.test.ts`
- Test: `apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts`
- Test: `apps/cli/test/unit/services/playback/source-inventory-service.test.ts`
- Test: `apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts`
- Test: `packages/core/test/core.test.ts`

- [ ] **Step 1: Write failing policy identity tests**

Add request mapping expectation:

```ts
const input = streamRequestToResolveInput(
  {
    title,
    episode,
    audioPreference: "original",
    subtitlePreference: "en",
    startupPriority: "fast",
  },
  "series",
);
expect(input.startupPriority).toBe("fast");
```

Add resolve-work key isolation:

```ts
expect(buildResolveWorkKey({ ...identity, startupPriority: "fast" })).not.toBe(
  buildResolveWorkKey({ ...identity, startupPriority: "quality-first" }),
);
```

Add API cache isolation:

```ts
expect(buildApiStreamResolveCacheKey({ ...input, startupPriority: "fast" })).not.toBe(
  buildApiStreamResolveCacheKey({ ...input, startupPriority: "quality-first" }),
);
```

Add source-inventory isolation because stored inventory contains a selected stream:

```ts
expect(buildSourceInventoryCacheKey({ ...base, startupPriority: "fast" })).not.toBe(
  buildSourceInventoryCacheKey({ ...base, startupPriority: "quality-first" }),
);
expect(SOURCE_INVENTORY_SCHEMA_VERSION).toBe("v3");
```

- [ ] **Step 2: Run tests and verify the contract is absent**

Run:

```sh
bun run test -- apps/cli/test/unit/services/providers/stream-request-adapter.test.ts apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/source-inventory-service.test.ts apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts packages/core/test/core.test.ts
```

Expected: FAIL because no startup-priority property participates in request or cache identity.

- [ ] **Step 3: Add shared policy types**

In `packages/types/src/index.ts`, add:

```ts
export type StartupPriority = "fast" | "balanced" | "quality-first";

export type ProviderSelectionReason =
  | "fast-start"
  | "balanced-1080"
  | "balanced-ready"
  | "balanced-budget-expired"
  | "quality-first"
  | "explicit-source"
  | "ak-required"
  | "provider-fallback";

export interface ProviderSelectionDecision {
  readonly startupPriority: StartupPriority;
  readonly reason: ProviderSelectionReason;
  readonly waitBudgetMs: number;
  readonly selectedQualityRank?: number;
  readonly enrichmentLane: "required" | "optional-foreground" | "late";
}
```

Add `readonly startupPriority?: StartupPriority` to `ProviderResolveInput` and `readonly selectionDecision?: ProviderSelectionDecision` to `ProviderResolveResult`.

- [ ] **Step 4: Carry policy through CLI request and identity boundaries**

Add `startupPriority?: StartupPriority` to `StreamRequest`, `StreamRequestLike` and `PlaybackResolveInput`, then map it in `streamRequestToResolveInput()`:

```ts
startupPriority: request.startupPriority ?? "balanced",
```

Add `startupPriority?: StartupPriority` to `ResolveWorkIdentityInput`, serialize `startupPriority: input.startupPriority ?? "balanced"` in `buildResolveWorkKey()`, and include it in the `identity` built by `PlaybackResolveWorkService.resolve()`.

Add `startupPriority?: StartupPriority` to `SourceInventoryCacheInput`, bump `SOURCE_INVENTORY_SCHEMA_VERSION` to `"v3"`, append its normalized value to `buildSourceInventoryCachePreimage()`, and pass it in `PlaybackResolveService`'s `inventoryInput`.

Add a `startup` cache-policy key token to all four active provider manifests and resolve it through both cache builders:

```ts
case "startup":
  return normalizePart(input.startupPriority ?? "balanced");
```

Pass `startupPriority` from `PlaybackResolveService.buildCacheKey()` and the provider cache-policy calls.

- [ ] **Step 5: Run contract tests and commit**

Run:

```sh
bun run test -- apps/cli/test/unit/services/providers/stream-request-adapter.test.ts apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/source-inventory-service.test.ts apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts packages/core/test/core.test.ts
```

Expected: PASS; `fast` and `quality-first` no longer share a work/cache identity.

Commit:

```sh
git add packages/types/src/index.ts packages/core/src/cache-policy.ts packages/providers/src/allmanga/manifest.ts packages/providers/src/vidking/manifest.ts packages/providers/src/rivestream/manifest.ts packages/providers/src/miruro/manifest.ts apps/cli/src/services/providers/Provider.ts apps/cli/src/services/providers/stream-request-adapter.ts apps/cli/src/services/playback/PlaybackResolveService.ts apps/cli/src/services/playback/ResolveWorkLedger.ts apps/cli/src/services/playback/PlaybackResolveWorkService.ts apps/cli/src/services/playback/SourceInventoryService.ts apps/cli/src/services/cache/stream-resolve-cache.ts apps/cli/test/unit/services/providers/stream-request-adapter.test.ts apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/source-inventory-service.test.ts apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts packages/core/test/core.test.ts
git commit -m "feat(playback): carry startup priority through resolve identity"
```

---

### Task 3: Centralize Ready-Candidate Selection And Apply It To AllManga

**Files:**

- Create: `packages/providers/src/shared/startup-selection.ts`
- Test: `packages/providers/test/startup-selection.test.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Test: `packages/providers/test/allmanga.test.ts`

- [ ] **Step 1: Add failing pure policy tests**

Create tests around this contract:

```ts
const candidates = [
  { id: "720", qualityRank: 720 },
  { id: "1080", qualityRank: 1080 },
] as const;

expect(selectReadyStream(candidates, { startupPriority: "balanced" }).selected.id).toBe("1080");
expect(selectReadyStream(candidates, { startupPriority: "fast" }).decision.reason).toBe(
  "fast-start",
);
expect(selectReadyStream(candidates, { startupPriority: "fast" }).selected.id).toBe("720");
expect(
  selectReadyStream(candidates, { startupPriority: "balanced", qualityPreference: "720" }).selected
    .id,
).toBe("720");
expect(
  selectReadyStream(candidates, { startupPriority: "quality-first" }).decision.waitBudgetMs,
).toBe(4_000);
expect(
  selectReadyStream(candidates, { startupPriority: "balanced", preferredStreamId: "720" }).decision
    .reason,
).toBe("explicit-source");
```

Add AllManga tests that `startupPriority: "quality-first"` includes a prompt `Ak` response, returns baseline when optional `Ak` exceeds an injected `5ms` test budget, and aborts that optional request. Keep the assertion that `startupPriority: "balanced"` with baseline playback does not request `Ak`.

- [ ] **Step 2: Run focused tests and confirm policy implementation is missing**

Run:

```sh
bun run test -- packages/providers/test/startup-selection.test.ts packages/providers/test/allmanga.test.ts
```

Expected: FAIL because the shared selector and quality-first route do not exist.

- [ ] **Step 3: Implement a pure selector for already-discovered candidates**

Create `startup-selection.ts`:

```ts
import type { ProviderSelectionDecision, StartupPriority, StreamCandidate } from "@kunai/types";

export const BALANCED_QUALITY_WAIT_BUDGET_MS = 1_000;
export const QUALITY_FIRST_WAIT_BUDGET_MS = 4_000;

export function selectReadyStream(
  streams: readonly StreamCandidate[],
  input: {
    readonly startupPriority?: StartupPriority;
    readonly qualityPreference?: string;
    readonly preferredStreamId?: string;
    readonly preferredSourceId?: string;
    readonly requiredFallback?: boolean;
  },
): { readonly selected: StreamCandidate; readonly decision: ProviderSelectionDecision } {
  const priority = input.startupPriority ?? "balanced";
  const explicit = streams.find((stream) =>
    input.preferredStreamId
      ? stream.id === input.preferredStreamId
      : input.preferredSourceId
        ? stream.sourceId === input.preferredSourceId
        : false,
  );
  const normalizedQualityPreference = input.qualityPreference?.toLowerCase();
  const preferredQuality = normalizedQualityPreference
    ? streams.find((stream) =>
        stream.qualityLabel?.toLowerCase().includes(normalizedQualityPreference),
      )
    : undefined;
  const ordered = [...streams].sort(
    (left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0),
  );
  const selected = explicit ?? preferredQuality ?? (priority === "fast" ? streams[0] : ordered[0]);
  if (!selected) throw new Error("No ready stream candidates");
  const reason = explicit
    ? "explicit-source"
    : input.requiredFallback
      ? "ak-required"
      : priority === "fast"
        ? "fast-start"
        : priority === "quality-first"
          ? "quality-first"
          : (selected.qualityRank ?? 0) >= 1080
            ? "balanced-1080"
            : "balanced-ready";
  return {
    selected,
    decision: {
      startupPriority: priority,
      reason,
      waitBudgetMs:
        priority === "quality-first"
          ? QUALITY_FIRST_WAIT_BUDGET_MS
          : priority === "balanced"
            ? BALANCED_QUALITY_WAIT_BUDGET_MS
            : 0,
      selectedQualityRank: selected.qualityRank,
      enrichmentLane: priority === "quality-first" ? "optional-foreground" : "required",
    },
  };
}
```

This helper ranks media already discovered by permitted work. It must not initiate new broad network work in Balanced mode. For the currently implemented providers, `waitBudgetMs` records the allowed policy ceiling; Balanced consumes no artificial delay when there is no already-in-flight higher-quality candidate to await.

- [ ] **Step 4: Apply permitted AllManga lanes and selection evidence**

In `allmanga/direct.ts`, extract a testable bounded helper used by `resolve()`:

```ts
export const ALLMANGA_QUALITY_FIRST_WAIT_BUDGET_MS = 4_000;

export async function collectAllMangaLinksForStartup(
  input: ProviderResolveInput,
  request: Omit<Parameters<typeof resolveEpisodeSources>[0], "sourceLane">,
  options: { readonly qualityFirstWaitMs?: number } = {},
): Promise<{ readonly links: readonly StreamLink[]; readonly requiredAkFallback: boolean }> {
  if (isExplicitAkSelection(input)) {
    return {
      links: await resolveEpisodeSources({ ...request, sourceLane: "ak-only" }),
      requiredAkFallback: false,
    };
  }

  const baselinePromise = resolveEpisodeSources({ ...request, sourceLane: "baseline" });
  if ((input.startupPriority ?? "balanced") !== "quality-first") {
    const baseline = await baselinePromise;
    if (baseline.length > 0) return { links: baseline, requiredAkFallback: false };
    return {
      links: await resolveEpisodeSources({ ...request, sourceLane: "ak-only" }),
      requiredAkFallback: true,
    };
  }

  const optionalAkController = new AbortController();
  const abortOptionalAk = () => optionalAkController.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", abortOptionalAk, { once: true });
  const akPromise = resolveEpisodeSources({
    ...request,
    sourceLane: "ak-only",
    signal: optionalAkController.signal,
  }).catch(() => [] as StreamLink[]);
  const baseline = await baselinePromise;
  if (baseline.length === 0) {
    try {
      return { links: await akPromise, requiredAkFallback: true };
    } finally {
      request.signal?.removeEventListener("abort", abortOptionalAk);
    }
  }
  const waitMs = options.qualityFirstWaitMs ?? ALLMANGA_QUALITY_FIRST_WAIT_BUDGET_MS;
  const ak = await Promise.race([akPromise, Bun.sleep(waitMs).then(() => null)]);
  request.signal?.removeEventListener("abort", abortOptionalAk);
  if (ak === null) optionalAkController.abort("quality-first wait budget elapsed");
  return { links: ak ? [...baseline, ...ak] : baseline, requiredAkFallback: false };
}
```

This makes `Ak` optional and cancellable when baseline media already exists; when baseline is empty, waiting for `Ak` is required recovery rather than optional quality delay. After mapping valid `streams`, call `selectReadyStream()`:

```ts
const selection = selectReadyStream(streams, {
  startupPriority,
  qualityPreference: input.qualityPreference,
  preferredSourceId: input.preferredSourceId,
  preferredStreamId: input.preferredStreamId,
  requiredFallback: requiredAkFallback,
});
```

In the existing resolved-result object literal, change `selectedStreamId` to `selection.selected.id` and add `selectionDecision: selection.decision`. Pass `startupPriority` to AllManga's `createProviderCachePolicy()` call so result cache evidence matches the policy-selected inventory.

Keep provider-cycle validation for candidate playability; feed its selected stream into the selection evidence only after a viable candidate exists.

- [ ] **Step 5: Run tests and commit**

Run:

```sh
bun run test -- packages/providers/test/startup-selection.test.ts packages/providers/test/allmanga.test.ts
```

Expected: PASS; Balanced avoids optional `Ak`, Quality First includes it, and fallback records `ak-required`.

Commit:

```sh
git add packages/providers/src/shared/startup-selection.ts packages/providers/src/allmanga/direct.ts packages/providers/test/startup-selection.test.ts packages/providers/test/allmanga.test.ts
git commit -m "feat(providers): select AllManga streams by startup priority"
```

---

### Task 4: Persist Startup Priority And Make It User-Selectable

**Files:**

- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Test: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`
- Test: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`

- [ ] **Step 1: Write failing config and settings tests**

Add:

```ts
expect(service.startupPriority).toBe("balanced");
await service.update({ startupPriority: "fast" });
await service.save();
expect((await store.load()).startupPriority).toBe("fast");
```

And:

```ts
expect(values).toContain("startupPriority");
expect(
  buildSettingsChoiceOverlay({
    config: DEFAULT_CONFIG,
    setting: "startupPriority",
    seriesProviderOptions: [],
    animeProviderOptions: [],
  }).options.map((option) => option.value),
).toEqual(["balanced", "fast", "quality-first"]);
```

- [ ] **Step 2: Run tests and confirm the missing preference**

Run:

```sh
bun run test -- apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts apps/cli/test/unit/app-shell/overlay-panel.test.ts
```

Expected: FAIL because `startupPriority` is not yet stored or displayed.

- [ ] **Step 3: Add persisted setting with safe normalization**

In `ConfigService.ts`:

```ts
import type { StartupPriority } from "@kunai/types";
// KitsuneConfig
startupPriority: StartupPriority;
```

In `ConfigStore.ts`:

```ts
startupPriority: "balanced",
```

In `ConfigServiceImpl.ts`:

```ts
function normalizeStartupPriority(value: unknown): StartupPriority {
  return value === "fast" || value === "quality-first" || value === "balanced" ? value : "balanced";
}
```

Apply normalization on load and `update()`, and expose a `get startupPriority()` accessor.

- [ ] **Step 4: Add the playback setting surface**

Add a `SettingsAction` value `"startupPriority"`, the options:

```ts
const STARTUP_PRIORITY_OPTIONS = [
  {
    value: "balanced",
    label: "Balanced",
    detail: "Prefer ready 1080p playback without a long wait.",
  },
  { value: "fast", label: "Fast", detail: "Start the first healthy playable source." },
  {
    value: "quality-first",
    label: "Quality first",
    detail: "Wait longer for stronger quality choices.",
  },
] as const;
```

Render it alongside recovery settings and apply the selected value in `root-overlay-shell.tsx`:

```ts
} else if (settingsChoice === "startupPriority") {
  next.startupPriority = picked.value as StartupPriority;
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```sh
bun run test -- apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts apps/cli/test/unit/app-shell/overlay-panel.test.ts
```

Expected: PASS.

Commit:

```sh
git add apps/cli/src/services/persistence/ConfigService.ts apps/cli/src/services/persistence/ConfigStore.ts apps/cli/src/services/persistence/ConfigServiceImpl.ts apps/cli/src/app-shell/overlay-panel.tsx apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts apps/cli/test/unit/app-shell/overlay-panel.test.ts
git commit -m "feat(settings): expose provider startup priority"
```

---

### Task 5: Wire Foreground, Recovery And Prefetch Intent Without Cache Collisions

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/episode-prefetch.ts`
- Modify: `apps/cli/src/container.ts`
- Test: `apps/cli/test/unit/app/episode-prefetch.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`

- [ ] **Step 1: Write failing intent-propagation tests**

Extend the prefetch target fixture:

```ts
const target = { ...baseTarget, startupPriority: "balanced" as const };
expect(matchesEpisodePrefetchTarget(target, { ...target, startupPriority: "quality-first" })).toBe(
  false,
);
```

In `playback-resolve-service.test.ts`, capture the engine input and assert:

```ts
expect(observedResolveInput.startupPriority).toBe("fast");
```

- [ ] **Step 2: Run tests and verify policy is not carried by the app flow**

Run:

```sh
bun run test -- apps/cli/test/unit/app/episode-prefetch.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts
```

Expected: FAIL while app intent lacks `startupPriority`.

- [ ] **Step 3: Pass the setting through each playback request**

Add `startupPriority: config.startupPriority` beside every `qualityPreference` supplied to `playbackResolveWork.resolve()` and `playbackResolveWork.prefetch()` in `PlaybackPhase.ts`, and to download resolve requests in `container.ts`.

Update `EpisodePrefetchTarget`:

```ts
readonly startupPriority?: StartupPriority;
```

Match it in `matchesEpisodePrefetchTarget()` so a prefetched Fast stream is not silently used for an explicit Quality First request:

```ts
target.startupPriority === requested.startupPriority;
```

- [ ] **Step 4: Run tests and commit**

Run:

```sh
bun run test -- apps/cli/test/unit/app/episode-prefetch.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts
```

Expected: PASS.

Commit:

```sh
git add apps/cli/src/app/PlaybackPhase.ts apps/cli/src/app/episode-prefetch.ts apps/cli/src/container.ts apps/cli/test/unit/app/episode-prefetch.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts
git commit -m "feat(playback): apply startup policy to play and prefetch"
```

---

### Task 6: Surface Selection Reasons In Diagnostics And Resolve Evidence

**Files:**

- Modify: `apps/cli/src/services/playback/ResolveWorkLedger.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/services/diagnostics/operation-taxonomy.ts`
- Test: `apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts`

- [ ] **Step 1: Write failing redacted evidence tests**

Add ledger expectations:

```ts
recordProviderSelectionDecision(ledger, {
  startupPriority: "balanced",
  reason: "balanced-1080",
  waitBudgetMs: 1_000,
  selectedQualityRank: 1080,
  enrichmentLane: "required",
});
expect(finalizeResolveWorkLedger(ledger).selection).toEqual({
  startupPriority: "balanced",
  reason: "balanced-1080",
  waitBudgetMs: 1_000,
  selectedQualityRank: 1080,
  enrichmentLane: "required",
});
```

Add coordinator expectation:

```ts
expect(diagnostics.events).toContainEqual(
  expect.objectContaining({ operation: "provider.selection.decision" }),
);
```

- [ ] **Step 2: Run tests and verify evidence is absent**

Run:

```sh
bun run test -- apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
```

Expected: FAIL because the decision is not currently recorded.

- [ ] **Step 3: Add a safe decision event and ledger field**

Add to `PlaybackResolveEvent`:

```ts
| {
    readonly type: "selection-decision";
    readonly providerId: string;
    readonly decision: ProviderSelectionDecision;
  }
```

Emit it once a provider result with `selectionDecision` is accepted. Add `selection?: ProviderSelectionDecision` to the ledger snapshot/state and:

```ts
export function recordProviderSelectionDecision(
  ledger: ResolveWorkLedger,
  decision: ProviderSelectionDecision,
): void {
  ledger.state.selection = decision;
}
```

Have `PlaybackResolveWorkService.recordResolveEvent()` capture the event.

- [ ] **Step 4: Project the event through diagnostics**

Register:

```ts
{
  operation: "provider.selection.decision",
  category: "provider",
  summary: "The startup policy selected one ready provider stream.",
  userAction: "Switch startup preference or source manually if a different tradeoff is preferred.",
}
```

In `PlaybackResolveCoordinator.recordEvent()` write a redacted context containing only `startupPriority`, `reason`, `waitBudgetMs`, `selectedQualityRank` and `enrichmentLane`.

- [ ] **Step 5: Run tests and commit**

Run:

```sh
bun run test -- apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
```

Expected: PASS and no media URLs appear in serialized ledger or diagnostic event tests.

Commit:

```sh
git add apps/cli/src/services/playback/ResolveWorkLedger.ts apps/cli/src/services/playback/PlaybackResolveWorkService.ts apps/cli/src/services/playback/PlaybackResolveCoordinator.ts apps/cli/src/services/diagnostics/operation-taxonomy.ts apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
git commit -m "feat(diagnostics): record provider selection decisions"
```

---

### Task 7: Apply The Policy To Providers That Already Expose Ready Inventory

**Files:**

- Modify: `packages/providers/src/vidking/direct.ts`
- Modify: `packages/providers/src/rivestream/direct.ts`
- Modify: `packages/providers/src/miruro/direct.ts`
- Test: `packages/providers/test/providers.test.ts`

- [ ] **Step 1: Write failing provider selection-evidence tests**

For each fixture-backed provider result, resolve with `startupPriority: "balanced"` and assert:

```ts
expect(result.selectionDecision).toMatchObject({
  startupPriority: "balanced",
  reason: "balanced-1080",
  selectedQualityRank: 1080,
});
```

Add Fast tests that retain the provider’s already-healthy first result and report `fast-start`. Do not add tests expecting new extra network discovery.

- [ ] **Step 2: Run tests and confirm existing providers lack evidence**

Run:

```sh
bun run test -- packages/providers/test/providers.test.ts
```

Expected: FAIL because existing selected results do not carry selection decisions.

- [ ] **Step 3: Use the shared selector after allowed provider-local work**

Import `selectReadyStream()` in each provider. Replace local highest-quality selection from already-returned `streams` with:

```ts
const selection = selectReadyStream(streams, {
  startupPriority: input.startupPriority,
  qualityPreference: input.qualityPreference,
  preferredStreamId: input.preferredStreamId,
  preferredSourceId: input.preferredSourceId,
});
```

Return `selectedStreamId: selection.selected.id` and `selectionDecision: selection.decision`.

Pass `startupPriority` into each provider's `createProviderCachePolicy()` call. Do not broaden VidKing server cycling, Rivestream service probing or Miruro provider-key cycles in this task. The selector chooses from already permitted work; Cineby breadth remains separately evidence-gated.

- [ ] **Step 4: Run provider tests and commit**

Run:

```sh
bun run test -- packages/providers/test/providers.test.ts packages/providers/test/startup-selection.test.ts
```

Expected: PASS; existing provider breadth is retained and the reason is now visible.

Commit:

```sh
git add packages/providers/src/vidking/direct.ts packages/providers/src/rivestream/direct.ts packages/providers/src/miruro/direct.ts packages/providers/test/providers.test.ts
git commit -m "feat(providers): report startup selection across active providers"
```

---

### Task 8: Reconcile Documentation And Run The Runtime Validation Tranche

**Files:**

- Modify: `.docs/provider-dossiers/allmanga.md`
- Modify: `.docs/providers.md`
- Modify: `.plans/plan-implementation-truth.md`

- [ ] **Step 1: Document shipped boundaries**

Record these confirmed runtime rules:

```md
- AllManga normal startup resolves baseline ani-cli-compatible sources first.
- `Ak` runs in the foreground only when explicitly requested, in Quality First mode, or when baseline extraction yields no playable candidate.
- AllManga advertises anime playback only until a deterministic catalog identity bridge exists.
- `startupPriority` and `qualityPreference` are separate: Balanced is the default; Fast minimizes optional work; Quality First permits bounded richer discovery.
```

Update the truth index with commit references and mark Cineby intake as a separate unpromoted research path.

- [ ] **Step 2: Run focused implementation tranche tests**

Run:

```sh
bun run test -- packages/providers/test/allmanga.test.ts packages/providers/test/startup-selection.test.ts packages/providers/test/providers.test.ts packages/core/test/core.test.ts apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts apps/cli/test/unit/app-shell/overlay-panel.test.ts apps/cli/test/unit/app/episode-prefetch.test.ts apps/cli/test/unit/services/providers/stream-request-adapter.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts apps/cli/test/unit/services/playback/resolve-work-ledger.test.ts apps/cli/test/unit/services/playback/source-inventory-service.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts apps/cli/test/unit/services/cache/stream-resolve-cache.test.ts apps/cli/test/unit/services/diagnostics/operation-taxonomy.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the repository gate once after all coherent runtime chunks**

Run:

```sh
bun run fmt
bun run lint
bun run typecheck
bun run test
bun run build
```

Expected: all commands PASS. Any existing warning that does not fail the command is reported separately from new errors.

- [ ] **Step 4: Commit documentation reconciliation**

```sh
git add .docs/provider-dossiers/allmanga.md .docs/providers.md .plans/plan-implementation-truth.md
git commit -m "docs: reconcile fast-first provider runtime"
```

- [ ] **Step 5: Leave live validation for the explicit final manual phase**

After deterministic gates and the separate Cineby evidence plan are complete, run or hand the user these checks:

```sh
bun run dev -- -a --debug
bun run dev -- -i 76479 -t series --debug
cd apps/experiments
bun scratchpads/provider-latency-bench.ts --anime --query="solo leveling" --episodes=1 --providers=allanime,miruro --mpv --mpv-play-seconds=5
bun scratchpads/provider-latency-bench.ts --series --episodes=1,2 --providers=vidking,cineby,rivestream --mpv --mpv-play-seconds=5
```

Expected: the user confirms visible playback, quality/source decision, subtitle attachment behavior and next-episode transition timing; live observations tune bounded budgets rather than silently changing them.
